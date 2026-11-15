// Live smoke test: real network, nothing written anywhere.
//   pnpm smoke [SYMBOL]     (default DIXON)
// Checks: (1) Yahoo prices give 120+ sessions, (2) an exchange announcement parses into the
// shared filing schema (NSE, or BSE if NSE blocks this connection), (3) Screener tables parse.
import { NormalizedFiling } from "@finn/shared";
import { MemoryStore, MIN_SESSIONS, fetchAnnouncements, fetchPrices, fetchScreener, istDate } from "@finn/core";
import { consoleLogger, fetchHttpClient, nodeHasher, systemClock, yahooChartClient } from "@finn/adapters";
import { seedCompanies } from "../src/deps";

const symbol = (process.argv[2] ?? "DIXON").toUpperCase();
const company = seedCompanies().find((c) => c.symbol === symbol) ?? { symbol, bse_code: null, is_bank: false };
const store = new MemoryStore([company]);
const deps = {
  http: fetchHttpClient(),
  clock: systemClock(),
  hash: nodeHasher(),
  log: consoleLogger({ quiet: true }),
  store,
  runner: "manual" as const,
  chart: yahooChartClient(),
};

const results: [string, boolean, string][] = [];
const check = (name: string, pass: boolean, detail: string) => results.push([name, pass, detail]);

// 1. Prices
const prices = await fetchPrices(deps, [symbol]);
if (prices.ok) {
  const rows = [...store.prices.values()].sort((a, b) => a.date.localeCompare(b.date));
  const last = rows.at(-1);
  const ageDays = last ? (Date.parse(istDate(new Date())) - Date.parse(last.date)) / 86_400_000 : Infinity;
  check(`prices: ≥ ${MIN_SESSIONS} sessions`, rows.length >= MIN_SESSIONS, `${rows.length} sessions, ${rows[0]?.date} → ${last?.date}`);
  check("prices: latest bar within 7 days", ageDays <= 7, `last close ₹${last?.close} on ${last?.date}, volume ${last?.volume}`);
  check("prices: all closes > 0, volumes ≥ 0", rows.every((r) => r.close > 0 && r.volume >= 0), "");
} else {
  check("prices: fetched", false, prices.error);
}

// 2. Announcements (last 30 days)
const now = new Date();
const ann = await fetchAnnouncements(deps, [company], { from: new Date(now.getTime() - 30 * 86_400_000), to: now });
const filings = [...store.filings.values()];
const exchanges = [...new Set(filings.map((f) => f.exchange))];
const via = exchanges.length ? exchanges.join("+") : ann.nse?.ok || ann.bse?.ok ? "an exchange (no filings in window)" : "neither";
const nseNote = ann.nse && !ann.nse.ok ? `; NSE failed: ${ann.nse.error}` : "";
check("announcements: fetched from an exchange", via !== "neither", `via ${via}${nseNote}`);
if (filings.length) {
  const allValid = filings.every(({ raw: _raw, ...f }) => NormalizedFiling.safeParse(f).success);
  check("announcements: every record parses into the shared schema", allValid, `${filings.length} filings`);
  const f = filings.sort((a, b) => b.filed_at.localeCompare(a.filed_at))[0]!;
  console.log("\nLatest announcement, normalised:\n" + JSON.stringify({ ...f, raw: undefined }, null, 2));
} else if (via !== "neither") {
  check("announcements: at least one in 30 days", false, "exchange answered but returned none");
}

// 3. Screener
const scr = await fetchScreener(deps, symbol);
check(
  "screener: tables parsed",
  scr.ok && scr.result.quarters.rows.length > 0 && scr.result.profit_loss.rows.length > 0,
  scr.ok
    ? `${scr.result.basis}; quarters ${scr.result.quarters.periods.at(0)}–${scr.result.quarters.periods.at(-1)}; ` +
      `rows: Q ${scr.result.quarters.rows.length}, P&L ${scr.result.profit_loss.rows.length}, BS ${scr.result.balance_sheet.rows.length}, CF ${scr.result.cash_flow.rows.length}; ${store.actuals.size} actuals`
    : scr.error,
);

console.log("\nIngest runs:", store.runs.map((r) => `${r.source}=${r.status}(${r.rows_ingested})`).join(" "));
console.log(`\nSmoke test for ${symbol}`);
for (const [name, pass, detail] of results) console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
process.exitCode = results.every(([, p]) => p) ? 0 : 1;
