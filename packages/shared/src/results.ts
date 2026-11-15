import { z } from "zod";
import { ties } from "./arith";
import { Crore, FiscalPeriod, IstDateTime, QuarterPeriod, Symbol } from "./primitives";

/**
 * Consolidated vs standalone is set ONCE per card. Every period on the card shares it,
 * so a card can never mix a consolidated quarter with a standalone comparison.
 */
export const Basis = z.enum(["consolidated", "standalone"]);
export type Basis = z.infer<typeof Basis>;

/**
 * One period's P&L, in ₹ crore. Signs follow the statement: income and expenses positive,
 * exceptional losses negative.
 *
 * Non-banks: revenue = revenue from operations; finance_costs, depreciation, ebitda required.
 * Banks/NBFCs: revenue = interest earned; interest_expended, nii, ppop, provisions required;
 * finance_costs, depreciation and ebitda are null.
 */
export const ResultsMetrics = z.strictObject({
  revenue: Crore,
  other_income: Crore,
  finance_costs: Crore.nullable(),
  depreciation: Crore.nullable(),
  /** Share of JV/associate profit included in PBT (equity method); 0 when none. Non-operating. */
  share_of_associates_in_pbt: Crore,
  pbt_before_exceptional: Crore,
  exceptional_items: Crore,
  pbt: Crore,
  tax: Crore,
  /** Share of JV/associate profit reported after tax (some filers); 0 when none. */
  share_of_associates_after_tax: Crore,
  /** Profit for the period, before non-controlling interest. */
  pat: Crore,
  /** Profit attributable to owners of the company, when disclosed. */
  pat_owners: Crore.nullable(),
  /** Derived in code, never by a model. Null for banks. */
  ebitda: Crore.nullable(),
  /** Banks only. nii = revenue (interest earned) − interest_expended, derived in code. */
  interest_expended: Crore.nullable(),
  nii: Crore.nullable(),
  ppop: Crore.nullable(),
  provisions: Crore.nullable(),
});
export type ResultsMetrics = z.infer<typeof ResultsMetrics>;

/**
 * Conservative operating EBITDA: strip other income (treasury gains) and equity-accounted
 * JV/associate profit, neither of which is operating performance.
 */
export const EBITDA_FORMULA =
  "EBITDA = PBT before exceptional items + finance costs + depreciation and amortisation − other income − share of JV/associate profit";

type EbitdaInputs = Pick<ResultsMetrics, "pbt_before_exceptional" | "finance_costs" | "depreciation" | "other_income" | "share_of_associates_in_pbt">;

export function computeEbitda(m: EbitdaInputs): number {
  return round2(m.pbt_before_exceptional + (m.finance_costs ?? 0) + (m.depreciation ?? 0) - m.other_income - m.share_of_associates_in_pbt);
}

export function patTies(m: ResultsMetrics): boolean {
  return ties(m.pbt - m.tax + m.share_of_associates_after_tax, m.pat);
}

export const round2 = (x: number) => {
  const r = Math.round(x * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

export const ResultsCheckId = z.enum([
  "pat_tie", // PBT − tax (+ after-tax associates) = PAT, every period on the card
  "ppop_tie", // banks: PPOP − provisions + exceptional = PBT
  "ebitda", // formula applied, or "not applicable to banks"
  "screener_revenue",
  "screener_pbt",
  "screener_pat",
  "screener_ebitda", // our EBITDA vs Screener's operating profit
  "exceptional_items",
  "comparability",
  "cash_conversion",
  "source_trace", // PDF path: every extracted number found on its cited page
]);
export type ResultsCheckId = z.infer<typeof ResultsCheckId>;

export const ResultsCheck = z.strictObject({
  id: ResultsCheckId,
  status: z.enum(["pass", "fail", "flag", "skipped"]),
  /** Plain language, written for the screen. */
  note: z.string().min(1),
  page: z.number().int().positive().nullable(),
});
export type ResultsCheck = z.infer<typeof ResultsCheck>;

export const ResultsSource = z.strictObject({
  kind: z.enum(["xbrl", "pdf"]),
  url: z.url(),
  page: z.number().int().positive().nullable(),
});

/** Growth is only ever computed when periods are comparable. Percentages, 1 decimal. */
export const ResultsGrowth = z.strictObject({
  revenue_qoq_pct: z.number().nullable(),
  revenue_yoy_pct: z.number().nullable(),
  pat_qoq_pct: z.number().nullable(),
  pat_yoy_pct: z.number().nullable(),
  /** EBITDA margin this quarter (non-banks), %. */
  ebitda_margin_pct: z.number().nullable(),
  /** Change in EBITDA margin vs year-ago quarter, percentage points. */
  ebitda_margin_yoy_pp: z.number().nullable(),
});
export type ResultsGrowth = z.infer<typeof ResultsGrowth>;

/** Q2: half-year cash flow (H1); Q4: full-year cash flow (FY). */
export const CashConversion = z.strictObject({
  period: FiscalPeriod,
  operating_cash_flow: Crore,
  pat: Crore,
  /** operating_cash_flow / pat, 2 decimals. */
  ratio: z.number(),
  note: z.string().min(1),
  page: z.number().int().positive().nullable(),
});
export type CashConversion = z.infer<typeof CashConversion>;

const PERIOD_KEYS = ["current", "prior_quarter", "year_ago"] as const;

export const ResultsCard = z
  .strictObject({
    symbol: Symbol,
    period: QuarterPeriod,
    basis: Basis,
    unit: z.literal("INR_CR"),
    is_bank: z.boolean(),
    current: ResultsMetrics,
    prior_quarter: ResultsMetrics.nullable(),
    year_ago: ResultsMetrics.nullable(),
    /** The formula with this quarter's numbers substituted, for audit. Null for banks. */
    ebitda_formula: z.string().nullable(),
    /** False when the filing discloses a restatement, demerger or similar. */
    comparable: z.boolean(),
    comparability_note: z.string().min(1).nullable(),
    growth: ResultsGrowth.nullable(),
    cash_conversion: CashConversion.nullable(),
    checks: z.array(ResultsCheck).min(1),
    source: ResultsSource,
    filed_at: IstDateTime,
  })
  .superRefine((card, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const periods = PERIOD_KEYS.flatMap((k) => (card[k] ? [[k, card[k]] as const] : []));

    // Derived figures are computed by us, so they must tie exactly or the card is rejected.
    for (const [key, m] of periods) {
      if (!ties(m.pbt_before_exceptional + m.exceptional_items, m.pbt)) {
        issue([key, "pbt"], "PBT ≠ PBT before exceptional + exceptional items");
      }
      if (card.is_bank) {
        for (const f of ["ebitda", "finance_costs", "depreciation"] as const) {
          if (m[f] !== null) issue([key, f], `${f} must be null for banks (EBITDA is not applicable to banks)`);
        }
        if (m.interest_expended === null || m.nii === null || m.ppop === null || m.provisions === null) {
          issue([key], "Banks need interest expended, NII, PPOP and provisions");
        } else if (round2(m.revenue - m.interest_expended) !== m.nii) {
          issue([key, "nii"], "NII must equal interest earned − interest expended");
        }
      } else {
        if (m.finance_costs === null || m.depreciation === null) issue([key], "Non-banks need finance costs and depreciation");
        if (m.ebitda === null) issue([key, "ebitda"], "EBITDA required for non-banks");
        else if (computeEbitda(m) !== m.ebitda) issue([key, "ebitda"], "EBITDA does not match its formula");
        for (const f of ["interest_expended", "nii", "ppop", "provisions"] as const) {
          if (m[f] !== null) issue([key, f], `${f} is bank-only`);
        }
      }
    }

    if (card.is_bank !== (card.ebitda_formula === null)) {
      issue(["ebitda_formula"], "Non-banks must store the EBITDA formula; banks must not");
    }
    if (card.comparable === (card.comparability_note !== null)) {
      issue(["comparability_note"], "A note is required exactly when the card is not comparable");
    }
    if (!card.comparable && card.growth !== null) {
      issue(["growth"], "No growth figures when periods are not comparable");
    }
    if (card.cash_conversion && !/^Q[24]FY/.test(card.period)) {
      issue(["cash_conversion"], "Cash conversion comes from the half-year (Q2) or full-year (Q4) cash flow");
    }

    // Checks must exist once each, and must not contradict the numbers on the card.
    const byId = new Map<string, ResultsCheck>();
    card.checks.forEach((c, i) => {
      if (byId.has(c.id)) issue(["checks", i, "id"], `Duplicate check ${c.id}`);
      byId.set(c.id, c);
    });
    const patTie = byId.get("pat_tie");
    const allTie = periods.every(([, m]) => patTies(m));
    if (!patTie) issue(["checks"], "pat_tie check is required");
    else if ((patTie.status === "pass") !== allTie) {
      issue(["checks"], `pat_tie says ${patTie.status} but the numbers ${allTie ? "tie" : "do not tie"}`);
    }
    if (card.current.exceptional_items !== 0 && byId.get("exceptional_items")?.status !== "flag") {
      issue(["checks"], "Exceptional items present: an exceptional_items flag is required");
    }
    if (!card.comparable && byId.get("comparability")?.status !== "flag") {
      issue(["checks"], "Not comparable: a comparability flag is required");
    }
    if (card.is_bank && byId.get("ebitda")?.status !== "skipped") {
      issue(["checks"], 'Banks need an "ebitda" check marked skipped: EBITDA is not applicable to banks');
    }
  });
export type ResultsCard = z.infer<typeof ResultsCard>;
