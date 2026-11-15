import { z } from "zod";
import { MandateActivity } from "@finn/shared";
import { PoliteHttp } from "../http/polite";
import { runIngest, type RunOutcome } from "../ingest/run";
import type { CoreDeps, PeopleEventRow } from "../ports";
import { extractDocument, extractPdfPages, fetchAttachment, isPdf } from "../sources/documents";
import { normalizeNumbers, onPage } from "../results/pdf";
import { toCrore } from "../results/statement";
import { checkSegmentMandate, type MandateCheckResult } from "./mandate";
import { countSeniorExits, extractPeopleFromText, PEOPLE_PROMPT_VERSION, PEOPLE_SYSTEM_PROMPT, PeopleExtractionSchema, type ExtractedPerson } from "./people";
import { computeGovernanceStrip, type GovernanceStrip } from "./strip";

const YEAR_MS = 365 * 24 * 3600 * 1000;

// ─── Governance strip from stored filings ────────────────────────────────────

/** 12-month lookback over the company's stored filings (duplicates excluded); flags are saved. */
export async function governanceStrip(deps: CoreDeps, symbol: string): Promise<GovernanceStrip> {
  const asOf = deps.clock.now();
  const filings = (await deps.store.recentFilings([symbol], new Date(asOf.getTime() - YEAR_MS))).filter((f) => f.duplicate_of === null);
  const strip = computeGovernanceStrip(symbol, filings, { as_of: asOf });
  if (strip.flags.length && deps.store.upsertGovernanceFlags) {
    await deps.store.upsertGovernanceFlags(strip.flags.map(({ date_formatted: _d, ...f }) => f));
  }
  return strip;
}

// ─── Mandate: segment note of the annual report ──────────────────────────────

export const SEGMENTS_PROMPT_VERSION = "segments-v1";
const SEGMENTS_SYSTEM = [
  "You read the operating segment note (Ind AS 108) of an Indian company's annual report. Pages are marked '=== Page N ==='.",
  "Return the segment revenue table for the latest financial year: each reportable segment's external revenue exactly as printed,",
  "the total revenue from operations as printed, the unit printed above the table, and the page.",
  `For each segment, activity = one of ${MandateActivity.options.join(", ")} if the segment's business is in that activity, else null.`,
  "Do not compute percentages. Return JSON matching the schema exactly.",
].join("\n");

export const SegmentExtraction = z.strictObject({
  unit: z.enum(["rupees", "thousands", "lakhs", "millions", "crores"]),
  total_revenue: z.number().positive(),
  total_page: z.number().int().positive(),
  segments: z.array(z.strictObject({ name: z.string().min(1).max(120), revenue: z.number(), page: z.number().int().positive(), activity: MandateActivity.nullable() })),
});

const SEGMENT_PAGE = /\bsegment (?:information|reporting|revenue|results)|operating segments?|ind ?as ?108/i;

/**
 * Annual report → segment note pages → segment table read by the tier-1 model → every figure
 * traced to its page → exclusion percentages computed in code with a page citation.
 */
export async function checkAnnualReportMandate(
  deps: CoreDeps,
  job: { symbol: string; url: string; period: string },
): Promise<RunOutcome<MandateCheckResult>> {
  return runIngest<MandateCheckResult>(deps, "documents", async () => {
    const doc = await extractDocument(deps, { symbol: job.symbol, type: "annual_report", period: job.period, url: job.url });
    if (!doc.ok) throw new Error(`annual report download failed: ${(doc as any).error}`);
    const pages = await deps.store.getDocumentText(doc.result.sha256);
    if (!pages) throw new Error("annual report has no readable text");
    const idx = pages.map((t, i) => (SEGMENT_PAGE.test(t) && (t.match(/\d[\d,]*\.\d{2}/g)?.length ?? 0) >= 6 ? i : -1)).filter((i) => i >= 0).slice(0, 6);
    if (idx.length === 0) {
      return { rows: 0, partial: "no segment note found; single-segment company assumed", result: checkSegmentMandate({ symbol: job.symbol, period: job.period, segments: [] }) };
    }
    if (!deps.llm) throw new Error("segment tagging needs the tier-1 model, which is not configured");
    const { data } = await deps.llm.run({
      task: "tag_segments",
      tier: "cheap",
      promptVersion: SEGMENTS_PROMPT_VERSION,
      system: SEGMENTS_SYSTEM,
      input: idx.map((i) => `=== Page ${i + 1} ===\n${pages[i]}`).join("\n\n"),
      schema: SegmentExtraction,
    });
    // Never compute a percentage from a number that isn't in the report.
    const missing = [
      ...data.segments.filter((s) => !onPage(s.revenue, normalizeNumbers(pages[s.page - 1] ?? ""))).map((s) => `${s.name} ${s.revenue} (p.${s.page})`),
      ...(onPage(data.total_revenue, normalizeNumbers(pages[data.total_page - 1] ?? "")) ? [] : [`total ${data.total_revenue} (p.${data.total_page})`]),
    ];
    if (missing.length) throw new Error(`segment figures not found on the cited page: ${missing.join(", ")}`);
    const result = checkSegmentMandate({
      symbol: job.symbol,
      period: job.period,
      total_revenue: toCrore(data.total_revenue, data.unit),
      segments: data.segments.map((s) => ({ name: s.name, revenue: toCrore(s.revenue, data.unit), page: s.page, activity: s.activity })),
    });
    return { rows: data.segments.length, partial: result.clean ? null : result.line, result };
  });
}

// ─── People: Regulation 30 change in KMP / directors ─────────────────────────

export interface PeopleReport {
  events: PeopleEventRow[];
  /** "Second senior exit this year". */
  senior_exit_note: string;
  method: "model" | "rules";
}

/**
 * Change-in-management filing → its PDF → the mid-tier model reads the people details (rules
 * fallback without a model) → every name must appear on its cited page → saved → senior exits
 * counted over the trailing 12 months.
 */
export async function extractPeopleChange(
  deps: CoreDeps,
  job: { symbol: string; filing_id: number; pdf_url: string },
): Promise<RunOutcome<PeopleReport>> {
  return runIngest<PeopleReport>(deps, "documents", async () => {
    const http = new PoliteHttp(deps.http, deps.clock, deps.log, { timeoutMs: 60_000 }, deps.random);
    const res = await fetchAttachment(http, job.pdf_url);
    if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${job.pdf_url}`);
    const bytes = await res.bytes();
    if (!isPdf(bytes)) throw new Error("filing attachment is not a PDF");
    const text = await extractPdfPages(bytes);
    if (!text.ok || !text.readable) throw new Error("filing has no readable text");
    const pages = text.pages;

    let people: ExtractedPerson[];
    let method: PeopleReport["method"];
    if (deps.llm) {
      const { data } = await deps.llm.run({
        task: "extract_people",
        tier: "mid",
        promptVersion: PEOPLE_PROMPT_VERSION,
        system: PEOPLE_SYSTEM_PROMPT,
        input: pages.map((t, i) => `=== Page ${i + 1} ===\n${t}`).join("\n\n"),
        schema: PeopleExtractionSchema,
      });
      people = data.events;
      method = "model";
    } else {
      people = pages.flatMap((t, i) => extractPeopleFromText(t, i + 1));
      method = "rules";
    }

    // A name the model gives must be in the filing, on the page it cites.
    const onItsPage = (p: ExtractedPerson) => {
      const where = p.source_page ? (pages[p.source_page - 1] ?? "") : pages.join(" ");
      const hay = where.toLowerCase().replace(/\s+/g, " ");
      return p.name.toLowerCase().split(/\s+/).filter((w) => w.length > 1).every((w) => hay.includes(w));
    };
    const kept = people.filter(onItsPage);
    const dropped = people.length - kept.length;
    // One row per person and action: a name repeated on the annexure page is the same event.
    const seen = new Set<string>();
    const events: PeopleEventRow[] = kept
      .filter((p) => { const k = `${p.name.toLowerCase()}|${p.action}`; return seen.has(k) ? false : (seen.add(k), true); })
      .map((p) => ({ ...p, filing_id: job.filing_id, symbol: job.symbol, effective_date: p.effective_date ?? null }));
    if (events.length && deps.store.upsertPeopleEvents) await deps.store.upsertPeopleEvents(events);

    const asOf = deps.clock.now();
    const history = deps.store.listPeopleEvents ? await deps.store.listPeopleEvents(job.symbol, new Date(asOf.getTime() - YEAR_MS)) : events;
    const { note } = countSeniorExits(history, asOf);
    return {
      rows: events.length,
      partial: dropped ? `${dropped} name(s) not found in the filing were dropped` : null,
      result: { events, senior_exit_note: note, method },
    };
  });
}
