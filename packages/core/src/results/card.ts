import {
  computeEbitda,
  patTies,
  ResultsCard,
  round2,
  ties,
  type Basis,
  type CashConversion,
  type IstDateTime,
  type ResultsCheck,
  type ResultsGrowth,
  type ResultsMetrics,
} from "@finn/shared";
import { fiscalQuarter } from "../time";
import type { ComparabilityFinding } from "./comparability";
import type { TraceResult } from "./pdf";
import { pickPeriods, type Column, type Statement } from "./statement";

export class ResultsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResultsError";
  }
}

/** Screener's figures for the card's quarter, already in crore. */
export interface ScreenerQuarter {
  basis: Basis;
  /** Screener "Sales" (non-banks) or "Revenue" (banks: interest earned). */
  revenue: number | null;
  pbt: number | null;
  /** Screener "Net Profit": profit before non-controlling interest. */
  pat: number | null;
  /** Screener "Operating Profit" = sales − expenses (non-banks). */
  operating_profit: number | null;
}

export interface BuildInput {
  symbol: string;
  is_bank: boolean;
  statement: Statement;
  source: { kind: "xbrl" | "pdf"; url: string; page: number | null };
  filed_at: IstDateTime;
  /** Null when the notes were not available (e.g. XBRL with no PDF). */
  comparability: ComparabilityFinding | null;
  screener: ScreenerQuarter | null;
  /** PDF path only. */
  trace?: TraceResult;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const quarterOf = (end: string) => fiscalQuarter(`${MONTHS[Number(end.slice(5, 7)) - 1]} ${end.slice(0, 4)}`);
const label = (q: string) => `${q.slice(0, 2)} ${q.slice(2)}`;

/** "₹1,129 cr", "−₹280 cr" — whole crore for notes; the card itself keeps 2 decimals. */
export function fmtCr(x: number): string {
  const s = `₹${Math.abs(Math.round(x)).toLocaleString("en-IN")} cr`;
  return x < -0.5 ? `−${s}` : s;
}
const fmt2 = (x: number) => x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (cur: number, prev: number | undefined | null) => (prev && prev > 0 ? Math.round((cur / prev - 1) * 1000) / 10 : null);

/** Screener shows whole crores, so allow its rounding on top of the 1% tolerance. */
const screenerTies = (ours: number, theirs: number) => Math.abs(ours - theirs) <= Math.max(Math.abs(theirs) * 0.01, 0.51);

function metricsOf(col: Column, isBank: boolean, periodLabel: string): ResultsMetrics {
  const v = col.values;
  const need = (f: keyof typeof v): number => {
    const x = v[f];
    if (x === null || x === undefined) throw new ResultsError(`${periodLabel}: ${f.replaceAll("_", " ")} missing`);
    return x;
  };
  const exceptional = v.exceptional_items ?? 0;
  const pbt = v.pbt ?? (v.pbt_before_exceptional != null ? round2(v.pbt_before_exceptional + exceptional) : null);
  if (pbt === null) throw new ResultsError(`${periodLabel}: PBT missing`);
  const pbtBefore = v.pbt_before_exceptional ?? round2(pbt - exceptional);
  const base = {
    revenue: need("revenue"),
    other_income: v.other_income ?? 0,
    share_of_associates_in_pbt: v.share_of_associates_in_pbt ?? 0,
    pbt_before_exceptional: pbtBefore,
    exceptional_items: exceptional,
    pbt,
    tax: need("tax"),
    share_of_associates_after_tax: v.share_of_associates_after_tax ?? 0,
    pat: need("pat"),
    pat_owners: v.pat_owners ?? null,
  };
  if (isBank) {
    const interest_expended = need("interest_expended");
    return {
      ...base,
      finance_costs: null,
      depreciation: null,
      ebitda: null,
      interest_expended,
      nii: round2(base.revenue - interest_expended),
      ppop: need("ppop"),
      provisions: need("provisions"),
    };
  }
  const m = { ...base, finance_costs: need("finance_costs"), depreciation: need("depreciation") };
  return { ...m, ebitda: computeEbitda(m), interest_expended: null, nii: null, ppop: null, provisions: null };
}

export function ebitdaFormula(m: ResultsMetrics): string {
  const terms = [
    `PBT before exceptional items ₹${fmt2(m.pbt_before_exceptional)} cr`,
    `+ finance costs ₹${fmt2(m.finance_costs ?? 0)} cr`,
    `+ depreciation and amortisation ₹${fmt2(m.depreciation ?? 0)} cr`,
    `− other income ₹${fmt2(m.other_income)} cr`,
    ...(m.share_of_associates_in_pbt !== 0 ? [`− share of JV/associate profit ₹${fmt2(m.share_of_associates_in_pbt)} cr`] : []),
  ];
  return `EBITDA = ${terms.join(" ")} = ₹${fmt2(m.ebitda!)} cr`;
}

/**
 * Builds and validates a results card. All arithmetic happens here, in code. Throws
 * ResultsError (or the schema's ZodError) rather than publish a card that doesn't add up.
 */
export function buildResultsCard(input: BuildInput): ResultsCard {
  const picked = pickPeriods(input.statement.columns);
  if (!picked) throw new ResultsError("no quarterly column found in the statement");
  const period = quarterOf(picked.current.end);
  if (!period) throw new ResultsError(`cannot map period ending ${picked.current.end} to a fiscal quarter`);

  const cols = [
    ["current", picked.current],
    ["prior_quarter", picked.prior_quarter],
    ["year_ago", picked.year_ago],
  ] as const;
  const m: Record<string, ResultsMetrics | null> = {};
  for (const [k, c] of cols) m[k] = c ? metricsOf(c, input.is_bank, label(quarterOf(c.end) ?? c.end)) : null;
  const cur = m.current!;
  const present = cols.filter(([k]) => m[k]).map(([k, c]) => ({ k, m: m[k]!, q: label(quarterOf(c!.end)!) }));

  const checks: ResultsCheck[] = [];
  const page = input.source.page;

  // PBT − tax = PAT, every quarter on the card.
  const bad = present.filter((p) => !patTies(p.m));
  checks.push(
    bad.length === 0
      ? { id: "pat_tie", status: "pass", note: `PBT − tax = PAT in all ${present.length} quarters`, page }
      : {
          id: "pat_tie",
          status: "fail",
          note: bad
            .map((p) => `${p.q}: ${fmt2(p.m.pbt)} − ${fmt2(p.m.tax)}${p.m.share_of_associates_after_tax ? ` + ${fmt2(p.m.share_of_associates_after_tax)}` : ""} = ${fmt2(round2(p.m.pbt - p.m.tax + p.m.share_of_associates_after_tax))}, filing says PAT ${fmt2(p.m.pat)}`)
            .join("; "),
          page,
        },
  );

  if (input.is_bank) {
    const badPpop = present.filter((p) => !ties(p.m.ppop! - p.m.provisions! + p.m.exceptional_items, p.m.pbt));
    checks.push(
      badPpop.length === 0
        ? { id: "ppop_tie", status: "pass", note: `Operating profit − provisions = PBT in all ${present.length} quarters`, page }
        : { id: "ppop_tie", status: "fail", note: badPpop.map((p) => `${p.q}: ${fmt2(p.m.ppop!)} − ${fmt2(p.m.provisions!)} ≠ PBT ${fmt2(p.m.pbt)}`).join("; "), page },
    );
    checks.push({ id: "ebitda", status: "skipped", note: "EBITDA is not applicable to banks; showing net interest income, provisions and PAT instead", page: null });
  } else {
    checks.push({ id: "ebitda", status: "pass", note: ebitdaFormula(cur), page });
  }

  // Screener cross-check: same quarter, same basis, or not at all.
  const s = input.screener;
  const screenerSkip = !s
    ? `Screener figures for ${label(period)} not available`
    : s.basis !== input.statement.basis
      ? `Screener has only ${s.basis} figures; not compared with ${input.statement.basis}`
      : null;
  const cross = (id: ResultsCheck["id"], what: string, ours: number | null, theirs: number | null | undefined): void => {
    if (screenerSkip) {
      checks.push({ id, status: "skipped", note: screenerSkip, page: null });
    } else if (ours === null || theirs === null || theirs === undefined) {
      checks.push({ id, status: "skipped", note: `Screener shows no ${what} for ${label(period)}`, page: null });
    } else {
      const ok = screenerTies(ours, theirs);
      checks.push({ id, status: ok ? "pass" : "fail", note: `${what}: ₹${fmt2(ours)} cr vs Screener ₹${fmt2(theirs)} cr${ok ? "" : " — does not tie"}`, page: null });
    }
  };
  cross("screener_revenue", input.is_bank ? "Interest earned" : "Revenue", cur.revenue, s?.revenue);
  cross("screener_pbt", "PBT", cur.pbt, s?.pbt);
  cross("screener_pat", "PAT", cur.pat, s?.pat);
  if (!input.is_bank) cross("screener_ebitda", "EBITDA", cur.ebitda, s?.operating_profit);

  // Exceptional items distort operating profit: say so plainly.
  const ex = cur.exceptional_items;
  checks.push(
    ex === 0
      ? { id: "exceptional_items", status: "pass", note: "No exceptional items this quarter", page }
      : { id: "exceptional_items", status: "flag", note: `One-off ${ex < 0 ? "charge" : "gain"} of ${fmtCr(Math.abs(ex))} in PBT`, page },
  );

  // Comparability: never a growth number across a restatement or demerger.
  const comp = input.comparability;
  const comparable = comp ? comp.comparable : true;
  checks.push(
    !comp
      ? { id: "comparability", status: "skipped", note: "Notes to the results were not read; restatements not checked", page: null }
      : comp.comparable
        ? { id: "comparability", status: "pass", note: "No restatement, demerger or business transfer disclosed", page: null }
        : { id: "comparability", status: "flag", note: `Not comparable with earlier periods: ${comp.note}`, page: comp.page },
  );

  // Cash quality: Q2 has the half-year cash flow, Q4 the full-year one.
  let cash_conversion: CashConversion | null = null;
  const isCashQuarter = /^Q[24]/.test(period);
  if (input.is_bank) {
    checks.push({ id: "cash_conversion", status: "skipped", note: "Cash conversion is not meaningful for banks: operating cash flow is driven by deposits and loans", page: null });
  } else if (!isCashQuarter) {
    checks.push({ id: "cash_conversion", status: "skipped", note: "Q1 and Q3 filings carry no cash flow statement", page: null });
  } else if (
    picked.cash &&
    input.trace?.missing.some((x) => x.period_start === picked.cash!.start && x.period_end === picked.cash!.end && (x.field === "operating_cash_flow" || x.field === "pat"))
  ) {
    checks.push({ id: "cash_conversion", status: "skipped", note: "Operating cash or PAT for the cash period could not be traced to the filing", page: null });
  } else if (!picked.cash || picked.cash.values.operating_cash_flow == null) {
    checks.push({ id: "cash_conversion", status: "skipped", note: "Cash flow statement not found in this filing", page: null });
  } else {
    const ocf = picked.cash.values.operating_cash_flow;
    const patH = picked.cash.values.pat ?? (period.startsWith("Q2") && m.prior_quarter ? round2(cur.pat + m.prior_quarter.pat) : null);
    const cashPeriod = `${period.startsWith("Q2") ? "H1" : ""}${period.slice(2)}`;
    if (patH === null || patH <= 0) {
      checks.push({ id: "cash_conversion", status: "skipped", note: `No positive ${cashPeriod} PAT to compare operating cash against`, page: null });
    } else {
      const ratio = Math.round((ocf / patH) * 100) / 100;
      const r1 = (Math.round(ratio * 10) / 10).toFixed(1).replace("-", "−");
      const note = `${period.startsWith("Q2") ? "H1" : "Full-year"} operating cash ${fmtCr(ocf)} vs PAT ${fmtCr(patH)} (${r1}x)`;
      const cfPage = picked.cash.cash_flow_page ?? picked.cash.page;
      cash_conversion = { period: cashPeriod, operating_cash_flow: ocf, pat: patH, ratio, note, page: cfPage };
      checks.push({ id: "cash_conversion", status: ratio >= 0.8 ? "pass" : "flag", note, page: cfPage });
    }
  }

  // PDF path: was every number really on its page?
  if (input.trace) {
    const t = input.trace;
    checks.push(
      t.missing.length === 0
        ? { id: "source_trace", status: "pass", note: `All ${t.checked} extracted figures found on their cited pages`, page }
        : { id: "source_trace", status: "flag", note: `Not found on the cited page: ${t.missing.map((x) => `${x.field.replaceAll("_", " ")} ${fmt2(x.value)} (p.${x.page})`).join(", ")}`, page },
    );
  }

  const growth: ResultsGrowth | null = comparable
    ? {
        revenue_qoq_pct: pct(cur.revenue, m.prior_quarter?.revenue),
        revenue_yoy_pct: pct(cur.revenue, m.year_ago?.revenue),
        pat_qoq_pct: pct(cur.pat, m.prior_quarter?.pat),
        pat_yoy_pct: pct(cur.pat, m.year_ago?.pat),
        ebitda_margin_pct: cur.ebitda !== null && cur.revenue > 0 ? Math.round((cur.ebitda / cur.revenue) * 1000) / 10 : null,
        ebitda_margin_yoy_pp:
          cur.ebitda !== null && m.year_ago?.ebitda != null && cur.revenue > 0 && m.year_ago.revenue > 0
            ? Math.round((cur.ebitda / cur.revenue - m.year_ago.ebitda / m.year_ago.revenue) * 1000) / 10
            : null,
      }
    : null;

  return ResultsCard.parse({
    symbol: input.symbol,
    period,
    basis: input.statement.basis,
    unit: "INR_CR",
    is_bank: input.is_bank,
    current: cur,
    prior_quarter: m.prior_quarter,
    year_ago: m.year_ago,
    ebitda_formula: input.is_bank ? null : ebitdaFormula(cur),
    comparable,
    comparability_note: comparable ? null : comp!.note,
    growth,
    cash_conversion,
    checks,
    source: input.source,
    filed_at: input.filed_at,
  });
}

/** Prefer consolidated; fall back to standalone only when there is no usable consolidated statement. */
export function preferConsolidated(statements: Statement[]): Statement | null {
  const usable = statements.filter((s) => pickPeriods(s.columns));
  return usable.find((s) => s.basis === "consolidated") ?? usable.find((s) => s.basis === "standalone") ?? null;
}
