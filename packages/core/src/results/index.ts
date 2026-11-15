import type { IstDateTime, ResultsCard } from "@finn/shared";
import { BROWSER_HEADERS, HttpError, PoliteHttp } from "../http/polite";
import { describeError, runIngest, type RunOutcome } from "../ingest/run";
import type { CompanyRef, CoreDeps } from "../ports";
import { fetchScreener } from "../sources/screener";
import { extractPdfPages, fetchAttachment, isPdf } from "../sources/documents";
import { buildResultsCard, preferConsolidated, ResultsError, type ScreenerQuarter } from "./card";
import { detectComparability, type ComparabilityFinding } from "./comparability";
import { CORE_FIELDS, extractWithModel, statementPages, toStatement } from "./pdf";
import { pickPeriods, type Statement } from "./statement";
import { parseResultsXbrl } from "./xbrl";
import { fiscalQuarter } from "../time";

export interface ResultsJob {
  company: CompanyRef;
  filing_id: number | null;
  filed_at: IstDateTime;
  /** NSE "Integrated Filing – Financials" XBRL, when known. Tried first. */
  xbrl_url?: string | null;
  /** The results PDF (the filing's attachment). Used for notes, and as the fallback source. */
  pdf_url?: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * XBRL first; the PDF read by the mid-tier model only if XBRL is missing or unusable.
 * Every card is cross-checked against Screener for the same quarter and basis, validated by
 * the shared schema, then stored. Logged to ingest_runs as source "results".
 */
export async function extractResults(deps: CoreDeps, job: ResultsJob): Promise<RunOutcome<ResultsCard>> {
  return runIngest<ResultsCard>(deps, "results", async () => {
    const http = new PoliteHttp(deps.http, deps.clock, deps.log, { timeoutMs: 60_000 }, deps.random);
    const notes: string[] = [];
    const sym = job.company.symbol;

    let pages: string[] | null | undefined;
    const pdfPages = async (): Promise<string[] | null> => {
      if (pages !== undefined) return pages;
      pages = null;
      if (!job.pdf_url) return null;
      const res = await fetchAttachment(http, job.pdf_url);
      if (res.status !== 200) throw new HttpError(res.status, job.pdf_url);
      const bytes = await res.bytes();
      if (!isPdf(bytes)) throw new ResultsError(`${job.pdf_url} is not a PDF`);
      const t = await extractPdfPages(bytes);
      if (!t.ok || !t.readable) {
        notes.push("results PDF has no readable text (scan?)");
        return null;
      }
      pages = t.pages;
      return pages;
    };
    const comparability = async (): Promise<ComparabilityFinding | null> => {
      const p = await pdfPages().catch(() => null);
      return p ? detectComparability(p.map((text, i) => ({ text, page: i + 1 }))) : null;
    };

    const build = async (statement: Statement, source: { kind: "xbrl" | "pdf"; url: string; page: number | null }, trace?: Parameters<typeof buildResultsCard>[0]["trace"]) => {
      const current = pickPeriods(statement.columns)?.current;
      if (!current) throw new ResultsError("no quarterly column in the statement");
      const period = fiscalQuarter(`${MONTHS[Number(current.end.slice(5, 7)) - 1]} ${current.end.slice(0, 4)}`)!;
      return buildResultsCard({
        symbol: sym,
        is_bank: job.company.is_bank,
        statement,
        source,
        filed_at: job.filed_at,
        comparability: await comparability(),
        screener: await screenerQuarter(deps, sym, period, statement.basis),
        ...(trace ? { trace } : {}),
      });
    };

    let card: ResultsCard | null = null;

    // 1. XBRL
    if (job.xbrl_url) {
      try {
        const res = await http.request({ url: job.xbrl_url, headers: { ...BROWSER_HEADERS, accept: "application/xml,text/xml,*/*" } });
        if (res.status !== 200) throw new HttpError(res.status, job.xbrl_url);
        card = await build(parseResultsXbrl(await res.text()), { kind: "xbrl", url: job.xbrl_url, page: null });
      } catch (err) {
        notes.push(`XBRL unusable, used the PDF instead (${describeError(err).slice(0, 160)})`);
        deps.log.warn(`results: ${sym} XBRL unusable, falling back to PDF`, { error: describeError(err) });
      }
    }

    // 2. PDF, read by the mid-tier model
    if (!card) {
      if (!job.pdf_url) throw new ResultsError("no XBRL and no results PDF to read");
      const p = await pdfPages();
      if (!p) throw new ResultsError("results PDF has no readable text");
      if (!deps.llm) throw new ResultsError("PDF fallback needs the mid-tier model, which is not configured");
      const idx = statementPages(p);
      if (idx.length === 0) throw new ResultsError("no results statement found in the PDF");
      const { data } = await extractWithModel(deps.llm, p, idx);
      const converted = data.statements.map((s) => ({ raw: s, ...toStatement(s, p) }));
      const chosen = preferConsolidated(converted.map((c) => c.statement));
      if (!chosen) throw new ResultsError("model output has no usable quarterly column");
      const c = converted.find((x) => x.statement === chosen)!;
      const current = pickPeriods(chosen.columns)!.current;
      const coreMissing = c.trace.missing.filter((m) => CORE_FIELDS.includes(m.field) && m.period_start === current.start && m.period_end === current.end);
      if (coreMissing.length) {
        throw new ResultsError(
          `model reported figures not found on the cited page: ${coreMissing.map((m) => `${m.field} ${m.value} (p.${m.page})`).join(", ")}`,
        );
      }
      card = await build(chosen, { kind: "pdf", url: job.pdf_url, page: c.raw.page }, c.trace);
    }

    await deps.store.upsertResultsCard(card, job.filing_id);
    const flagged = card.checks.filter((x) => x.status === "fail" || x.status === "flag").map((x) => x.id);
    if (flagged.length) notes.push(`${sym} ${card.period}: ${flagged.join(", ")}`);
    return { rows: 1, partial: notes.length ? notes.join("; ") : null, result: card };
  });
}

/** Screener's figures for one quarter, from stored actuals; fetched once if missing. */
export async function screenerQuarter(deps: CoreDeps, symbol: string, period: string, basis: "consolidated" | "standalone"): Promise<ScreenerQuarter | null> {
  let rows = await deps.store.getActuals(symbol, period);
  if (rows.length === 0) {
    const r = await fetchScreener(deps, symbol);
    if (!r.ok) return null;
    rows = await deps.store.getActuals(symbol, period);
  }
  if (rows.length === 0) return null;
  const useBasis = rows.some((r) => r.basis === basis) ? basis : rows[0]!.basis;
  const get = (...metrics: string[]) => rows.find((r) => r.basis === useBasis && metrics.includes(r.metric))?.value ?? null;
  return {
    basis: useBasis,
    revenue: get("sales", "revenue"),
    pbt: get("profit_before_tax"),
    pat: get("net_profit"),
    operating_profit: get("operating_profit"),
  };
}
