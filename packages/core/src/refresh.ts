import type { ResultsCard } from "@finn/shared";
import type { RunOutcome } from "./ingest/run";
import type { ChartClient, CompanyRef, CoreDeps } from "./ports";
import { extractResults } from "./results/index";
import { fetchAnnouncements, type AnnouncementsSummary } from "./sources/announcements";
import { fetchPrices, type PricesSummary } from "./sources/prices";
import { fetchScreener, type ScreenerFinancials } from "./sources/screener";

export type RefreshPart = "prices" | "filings" | "screener";

export interface RefreshRequest {
  /** Explicit symbols, or all holdings of a portfolio (undefined id = the demo portfolio). */
  target: { symbols: string[] } | { portfolio: string | undefined };
  parts: RefreshPart[];
  since: Date;
}

export interface RefreshReport {
  companies: string[];
  unknown: string[];
  prices?: RunOutcome<PricesSummary>;
  filings?: AnnouncementsSummary;
  screener?: Record<string, RunOutcome<ScreenerFinancials>>;
  /** Results cards built from results filings found in this refresh. */
  results?: Record<string, RunOutcome<ResultsCard>>;
  /** Results filings left for later, and why. */
  results_pending?: { symbol: string; reason: string }[];
}

/** The same entry point serves the refresher CLI and the API cron handlers. */
export async function refresh(deps: CoreDeps & { chart: ChartClient }, req: RefreshRequest): Promise<RefreshReport> {
  let companies: CompanyRef[];
  const unknown: string[] = [];
  if ("symbols" in req.target) {
    companies = [];
    for (const s of req.target.symbols) {
      const c = await deps.store.getCompany(s);
      if (c) companies.push(c);
      else unknown.push(s);
    }
    if (unknown.length) deps.log.warn("not in companies table, skipping", { symbols: unknown });
  } else {
    companies = await deps.store.listHoldings(req.target.portfolio);
  }

  const report: RefreshReport = { companies: companies.map((c) => c.symbol), unknown };
  if (companies.length === 0) return report;

  if (req.parts.includes("prices")) {
    report.prices = await fetchPrices(deps, report.companies);
  }
  if (req.parts.includes("filings")) {
    report.filings = await fetchAnnouncements(deps, companies, { from: req.since, to: deps.clock.now() });
    await resultsFromFilings(deps, companies, report);
  }
  if (req.parts.includes("screener")) {
    report.screener = {};
    for (const c of companies) report.screener[c.symbol] = await fetchScreener(deps, c.symbol);
  }
  return report;
}

/**
 * Results filings that just arrived become results cards. NSE's XBRL index is behind the
 * same API that blocks us from outside India, so today the source is the results PDF, read by
 * the mid-tier model; without a model configured these wait (and are reported as pending).
 */
async function resultsFromFilings(deps: CoreDeps, companies: CompanyRef[], report: RefreshReport): Promise<void> {
  const found = [report.filings?.nse, report.filings?.bse].flatMap((r) => (r?.ok ? (r.result.pipeline?.results_filings ?? []) : []));
  if (found.length === 0) return;
  report.results = {};
  report.results_pending = [];
  for (const f of found) {
    const company = companies.find((c) => c.symbol === f.symbol);
    if (!company) continue;
    if (!f.attachment_url) {
      report.results_pending.push({ symbol: f.symbol, reason: "results filing has no attachment" });
      continue;
    }
    if (!deps.llm) {
      report.results_pending.push({ symbol: f.symbol, reason: "needs the mid-tier model to read the PDF (not configured)" });
      continue;
    }
    report.results[f.symbol] = await extractResults(deps, {
      company,
      filing_id: f.filing_id,
      filed_at: f.filed_at as ResultsCard["filed_at"],
      pdf_url: f.attachment_url,
    });
  }
}
