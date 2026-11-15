import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchScreener, parseScreenerPage, toActuals } from "../src/index";
import { makeDeps } from "./fakes";

const section = (id: string, periods: string[], rows: [string, ...string[]][]) => `
<section id="${id}" class="card">
  <table class="data-table responsive-text-nowrap">
    <thead><tr><th class="text"></th>${periods.map((p) => `<th>${p}</th>`).join("")}</tr></thead>
    <tbody>
      ${rows
        .map(
          ([label, ...vals]) =>
            `<tr><td class="text"><button class="button-plain" onclick="x">${label}&nbsp;<span class="blue-icon">+</span></button></td>${vals.map((v) => `<td>${v}</td>`).join("")}</tr>`,
        )
        .join("\n")}
      <tr class="font-size-14"><td class="text">Raw PDF</td><td><a href="#">PDF</a></td><td></td></tr>
    </tbody>
  </table>
</section>`;

const PAGE = `<html><body>
${section("quarters", ["Jun 2026", "Sep 2026"], [["Sales", "12,836", "14,855"], ["OPM %", "4%", "4%"], ["Net Profit", "280", "412"], ["EPS in Rs", "46.2", "68.1"]])}
${section("profit-loss", ["Mar 2025", "Mar 2026", "TTM"], [["Sales", "38,860", "48,113", "51,950"], ["Net Profit", "1,233", "1,469", "1,620"]])}
${section("balance-sheet", ["Mar 2026", "Sep 2026"], [["Borrowings", "580", "612"], ["Total Assets", "16,210", "17,900"]])}
${section("cash-flow", ["Mar 2025", "Mar 2026"], [["Cash from Operating Activity", "1,150", "-210"]])}
</body></html>`;

test("parses all four tables: labels cleaned, commas and % stripped, link-only rows dropped", () => {
  const p = parseScreenerPage(PAGE);
  assert.deepEqual(p.quarters.periods, ["Jun 2026", "Sep 2026"]);
  assert.deepEqual(p.quarters.rows.map((r) => r.label), ["Sales", "OPM %", "Net Profit", "EPS in Rs"]);
  assert.deepEqual(p.quarters.rows[0]!.values, [12836, 14855]);
  assert.deepEqual(p.quarters.rows[1]!.values, [4, 4]);
  assert.deepEqual(p.cash_flow.rows[0]!.values, [1150, -210]);
  assert.equal(p.profit_loss.periods.at(-1), "TTM");
});

test("toActuals: fiscal periods, units, TTM and half-year columns skipped, bs_/cf_ prefixes", () => {
  const p = parseScreenerPage(PAGE);
  const rows = toActuals({ symbol: "DIXON", basis: "consolidated", url: "u", ...p });
  const get = (period: string, metric: string) => rows.find((r) => r.period === period && r.metric === metric);
  assert.equal(get("Q2FY27", "sales")?.value, 14855);
  assert.equal(get("Q1FY27", "opm_pct")?.unit, "pct");
  assert.equal(get("Q2FY27", "eps_in_rs")?.unit, "other");
  assert.equal(get("FY26", "net_profit")?.value, 1469);
  assert.equal(get("FY26", "bs_total_assets")?.value, 16210);
  assert.equal(get("FY26", "cf_cash_from_operating_activity")?.value, -210);
  assert.ok(!rows.some((r) => r.period.startsWith("H") || r.period === "TTM"), "TTM and Sep balance sheet skipped");
  assert.ok(rows.every((r) => r.basis === "consolidated" && r.source === "screener"));
});

test("consolidated first; 404 falls back to standalone and the basis says so", async () => {
  const { deps, http, store } = makeDeps((req) =>
    req.url.endsWith("/consolidated/") ? { status: 404 } : { body: PAGE },
  );
  const out = await fetchScreener(deps, "DIXON");
  assert.deepEqual(http.requests.map((r) => r.url), [
    "https://www.screener.in/company/DIXON/consolidated/",
    "https://www.screener.in/company/DIXON/",
  ]);
  assert.ok(out.ok);
  assert.equal(out.result.basis, "standalone");
  assert.ok([...store.actuals.values()].every((a) => a.basis === "standalone"));
  assert.deepEqual(store.runs.map((r) => [r.source, r.status]), [["screener", "ok"]]);
});

test("a consolidated page with figures is used as-is", async () => {
  const { deps, http } = makeDeps(() => ({ body: PAGE }));
  const out = await fetchScreener(deps, "DIXON");
  assert.ok(out.ok);
  assert.equal(out.result.basis, "consolidated");
  assert.equal(http.requests.length, 1);
});

test("a page with no tables (layout change) fails the run loudly", async () => {
  const { deps, store } = makeDeps(() => ({ body: "<html><body>Login required</body></html>" }));
  const out = await fetchScreener(deps, "DIXON");
  assert.equal(out.ok, false);
  assert.match(store.runs[0]!.error!, /no financial tables/);
});
