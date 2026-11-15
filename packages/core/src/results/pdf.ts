import { z } from "zod";
import { Basis } from "@finn/shared";
import type { LlmClient } from "../ports";
import { FIELDS, toCrore, type Column, type Field, type Statement, type Unit } from "./statement";

/**
 * PDF fallback. The mid-tier model only READS numbers off the statement pages, as printed,
 * with the page it read them from. Code then converts units, checks every number is really
 * on its page, and does all the arithmetic. The schema has no EBITDA, margin or growth field
 * on purpose, and is strict: a model that adds one fails validation.
 */

export const RESULTS_PROMPT_VERSION = "results-extract-v1";
export const RESULTS_SYSTEM = [
  "You read Indian listed-company quarterly results (SEBI LODR Regulation 33) from page text.",
  "Return every column of the standalone and/or consolidated statement of profit and loss you find,",
  "plus net cash from operating activities from the half-year or full-year cash flow statement if present.",
  "Copy numbers exactly as printed, in the unit printed above the table. Parentheses mean negative.",
  "Do not convert units. Do not compute anything (no EBITDA, margins, totals or growth).",
  "Use null for a line that is not in the statement. Use 0 only where the statement prints 0 or '-'.",
  "Banks: revenue = interest earned; interest_expended, ppop (operating profit before provisions",
  "and contingencies) and provisions (other than tax) as printed; finance_costs and depreciation null.",
  "pat = profit for the period BEFORE non-controlling / minority interest; pat_owners = attributable to owners.",
  "page = the page number (from the '=== Page N ===' markers) the P&L numbers are on.",
  "Return JSON matching the schema exactly.",
].join("\n");

const num = z.number().nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ExtractedValues = z.strictObject(Object.fromEntries(FIELDS.map((f) => [f, num])) as Record<Field, typeof num>);

export const ResultsExtraction = z.strictObject({
  statements: z
    .array(
      z.strictObject({
        basis: Basis,
        unit: z.enum(["rupees", "thousands", "lakhs", "millions", "crores"]),
        page: z.number().int().positive(),
        columns: z
          .array(
            z.strictObject({
              period_start: date,
              period_end: date,
              values: ExtractedValues,
              cash_flow_page: z.number().int().positive().nullable(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});
export type ResultsExtraction = z.infer<typeof ResultsExtraction>;

const STATEMENT_PAGE = /(?:statement of|unaudited|audited)\s+(?:the\s+)?(?:consolidated|standalone)|(?:consolidated|standalone)\s+(?:financial\s+)?results|cash\s+flows?\s+(?:statement|for the)|statement of cash flows?/i;

/** The pages worth sending: statements and cash flows, consolidated first, at most `max`. */
export function statementPages(pages: string[], max = 8): number[] {
  const hits = pages
    .map((t, i) => ({ i, t }))
    .filter(({ t }) => STATEMENT_PAGE.test(t) && (t.match(/\d[\d,]*\.\d{2}/g)?.length ?? 0) >= 10);
  const consolidated = hits.filter(({ t }) => /consolidated/i.test(t));
  const rest = hits.filter(({ t }) => !/consolidated/i.test(t));
  return [...consolidated, ...rest].slice(0, max).map(({ i }) => i).sort((a, b) => a - b);
}

export async function extractWithModel(llm: LlmClient, pages: string[], pageIdx: number[]): Promise<{ data: ResultsExtraction; model: string }> {
  const input = pageIdx.map((i) => `=== Page ${i + 1} ===\n${pages[i]}`).join("\n\n");
  return llm.run({
    task: "extract_results",
    tier: "mid",
    promptVersion: RESULTS_PROMPT_VERSION,
    system: RESULTS_SYSTEM,
    input,
    schema: ResultsExtraction,
  });
}

// ─── Is the number really on the page? ──────────────────────────────────────

/**
 * Normalises PDF text noise seen in real filings: letter O for zero ("3O.O9.2O26"),
 * comma as the decimal point ("894,97"), Indian and Western digit grouping, stray spaces.
 */
export function normalizeNumbers(page: string): string {
  let s = page;
  for (let i = 0; i < 3; i++) s = s.replace(/(\d|\.|,)[Oo]|[Oo](?=[\d.,]\d)/g, (m) => m.replace(/[Oo]/, "0"));
  s = s.replace(/(\d),(\d{2})(?![\d,])/g, "$1.$2"); // "894,97" → "894.97"
  s = s.replace(/(\d),(?=\d)/g, "$1"); // "21,793.64", "1,23,456.78" → digits only
  // "1 033.02" → "1033.02", but never fuse neighbouring values like "95131.63 90575.33".
  s = s.replace(/(?<![\d.])(\d{1,2}) (?=\d{3}\.\d)/g, "$1");
  return s;
}

export function onPage(value: number, normalizedPage: string): boolean {
  if (value === 0) return true; // printed as "-" or blank
  const abs = Math.abs(value);
  const forms = new Set([abs.toFixed(2)]);
  if (Number.isInteger(abs * 10)) forms.add(abs.toFixed(1));
  if (Number.isInteger(abs)) forms.add(abs.toFixed(0));
  for (const f of forms) {
    const re = new RegExp(`(?<![\\d.])${f.replace(".", "\\.")}(?![\\d])`);
    if (re.test(normalizedPage)) return true;
  }
  return false;
}

/** Revenue, PBT, tax and PAT must be traceable or the card is not built. */
export const CORE_FIELDS: Field[] = ["revenue", "pbt", "tax", "pat"];

export interface TraceResult {
  checked: number;
  missing: { field: Field; value: number; page: number; period_start: string; period_end: string }[];
}

/** Converts the chosen statement to crore and checks each number against its cited page. */
export function toStatement(x: ResultsExtraction["statements"][number], pages: string[]): { statement: Statement; trace: TraceResult } {
  const norm = new Map<number, string>();
  const pageText = (p: number) => {
    if (!norm.has(p)) norm.set(p, normalizeNumbers(pages[p - 1] ?? ""));
    return norm.get(p)!;
  };
  const trace: TraceResult = { checked: 0, missing: [] };
  const columns: Column[] = x.columns.map((c) => {
    const values: Partial<Record<Field, number | null>> = {};
    for (const f of FIELDS) {
      const v = c.values[f];
      if (v === null || v === undefined) continue;
      const page = f === "operating_cash_flow" ? (c.cash_flow_page ?? x.page) : x.page;
      trace.checked++;
      if (!onPage(v, pageText(page))) trace.missing.push({ field: f, value: v, page, period_start: c.period_start, period_end: c.period_end });
      values[f] = toCrore(v, x.unit as Unit);
    }
    return { start: c.period_start, end: c.period_end, values, page: x.page, cash_flow_page: c.cash_flow_page };
  });
  return { statement: { basis: x.basis, columns }, trace };
}
