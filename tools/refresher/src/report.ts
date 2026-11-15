import { foldFeed, type DocumentResult, type FeedCard, type MemoryStore, type RefreshReport, type RunOutcome } from "@finn/core";

const status = (o: RunOutcome<unknown> | null | undefined) =>
  !o ? "-" : o.ok ? `${o.status.toUpperCase()} (${o.rows} rows)${o.note ? ` — ${o.note}` : ""}` : `FAILED — ${o.error}`;

/** Prints a summary and returns the process exit code: 1 if any source failed outright. */
export function printReport(r: RefreshReport, memory?: MemoryStore): number {
  console.log("\n── Refresh summary " + "─".repeat(40));
  console.log(`companies: ${r.companies.join(", ") || "(none)"}`);
  if (r.unknown.length) console.log(`not in companies table: ${r.unknown.join(", ")}`);

  let failed = r.companies.length === 0;
  if (r.prices) {
    console.log(`prices (yahoo): ${status(r.prices)}`);
    if (r.prices.ok) {
      const s = Object.entries(r.prices.result.sessions).map(([k, n]) => `${k} ${n}`).join(", ");
      console.log(`  sessions: ${s}`);
    }
    failed ||= !r.prices.ok;
  }
  if (r.filings) {
    console.log(`filings (nse): ${status(r.filings.nse)}`);
    if (r.filings.bse) console.log(`filings (bse fallback): ${status(r.filings.bse)}`);
    if (r.filings.missed.length) console.log(`  no filings from either exchange: ${r.filings.missed.join(", ")}`);
    failed ||= r.filings.missed.length === r.companies.length;
  }
  if (r.screener) {
    for (const [sym, o] of Object.entries(r.screener)) {
      const basis = o.ok ? ` [${o.result.basis}, ${o.result.quarters.periods.length} quarters]` : "";
      console.log(`screener ${sym}: ${status(o)}${basis}`);
      failed ||= !o.ok;
    }
  }
  if (memory) {
    const dups = [...memory.filings.values()].filter((f) => f.duplicate_of !== null).length;
    console.log(`dry run held: ${memory.prices.size} price rows, ${memory.filings.size} filings (${dups} linked duplicates), ${memory.actuals.size} actuals`);
    if (memory.analyses.size) printFeed(memory);
  }
  return failed ? 1 : 0;
}

function printFeed(memory: MemoryStore): void {
  const items = [...memory.analyses.values()].map((a) => {
    const f = memory.filings.get(a.filing_id)!;
    return { filing_id: a.filing_id, event_id: a.event_id!, symbol: f.symbol, tier: a.tier, score: a.score, headline: a.headline, reasons: a.reasons, filed_at: f.filed_at };
  });
  const feed = foldFeed(items, (id) => memory.events.get(id)!.primary_filing_id);
  const methods = [...memory.analyses.values()].reduce<Record<string, number>>((m, a) => ((m[a.method] = (m[a.method] ?? 0) + 1), m), {});
  console.log(`\n── Feed (${items.length} analysed; ${Object.entries(methods).map(([k, v]) => `${k} ${v}`).join(", ")}) ──`);
  const card = (c: FeedCard) =>
    `  ${c.symbol.padEnd(10)} ${c.primary.headline}${c.related.length ? `  (+${c.related.length} related)` : ""}\n             ↳ ${c.primary.reasons.join("; ")}`;
  console.log(`ACT (${feed.act.length})`);
  for (const c of feed.act) console.log(card(c));
  console.log(`READ (${feed.read.length})`);
  for (const c of feed.read) console.log(card(c));
  console.log(`ROUTINE: ${feed.routine.count} filings folded`);
  const kinds = feed.routine.cards.reduce<Record<string, number>>((m, c) => ((m[c.primary.headline] = (m[c.primary.headline] ?? 0) + 1), m), {});
  console.log(`  ${Object.entries(kinds).map(([k, v]) => `${k} ×${v}`).join(" · ")}`);
}

export function printDocument(o: RunOutcome<DocumentResult>): void {
  if (!o.ok) return void console.log(`document: FAILED — ${o.error}`);
  const r = o.result;
  console.log(
    `document: ${r.outcome === "already_have" ? "already stored, skipped" : `${r.pages} pages, ${r.readable ? "readable" : "NOT readable (scan?)"}`} sha256=${r.sha256}`,
  );
}
