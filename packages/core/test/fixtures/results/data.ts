/**
 * Real Q2 FY27 consolidated figures (₹ crore) read from the filed results:
 *   Dixon Technologies: statement p.11, cash flow p.14 of the BSE attachment in dixon-q2fy27.pages.json
 *   HDFC Bank:          statement p.9 of the BSE attachment in hdfcbank-q2fy27.pages.json
 * Screener figures are as shown on screener.in (whole crore) for the same quarters.
 *
 * NSE's own XBRL files sit behind an API that refuses requests from outside India, so the
 * XBRL documents here are built by `xbrl()` in the Ind AS results taxonomy layout
 * (contexts, iso4217:INR unit, values in rupees) carrying these real numbers.
 */
import { readFileSync } from "node:fs";
import type { Field } from "../../../src/index";

type Cols = { start: string; end: string; values: Partial<Record<Field, number>> }[];

export const DIXON: Cols = [
  { start: "2026-07-01", end: "2026-09-30", values: { revenue: 21793.64, other_income: 68.73, finance_costs: 25.95, depreciation: 110.06, share_of_associates_in_pbt: 2.81, pbt_before_exceptional: 532.35, exceptional_items: 0, pbt: 532.35, tax: 121.48, pat: 410.87, pat_owners: 343.66 } },
  { start: "2026-04-01", end: "2026-06-30", values: { revenue: 15547.66, other_income: 528.29, finance_costs: 24.12, depreciation: 106.95, share_of_associates_in_pbt: 8.64, pbt_before_exceptional: 868.98, exceptional_items: 0, pbt: 868.98, tax: 151.15, pat: 717.83, pat_owners: 663.42 } },
  { start: "2025-07-01", end: "2025-09-30", values: { revenue: 14855.04, other_income: 495.74, finance_costs: 38.35, depreciation: 96.28, share_of_associates_in_pbt: 1.15, pbt_before_exceptional: 923.59, exceptional_items: 0, pbt: 923.59, tax: 177.89, pat: 745.7, pat_owners: 670.0 } },
  { start: "2026-04-01", end: "2026-09-30", values: { revenue: 37341.3, other_income: 597.02, finance_costs: 50.07, depreciation: 217.01, share_of_associates_in_pbt: 11.45, pbt_before_exceptional: 1401.33, exceptional_items: 0, pbt: 1401.33, tax: 272.63, pat: 1128.7, operating_cash_flow: -280.02 } },
];

export const HDFCBANK: Cols = [
  { start: "2026-07-01", end: "2026-09-30", values: { revenue: 95131.63, other_income: 34227.06, interest_expended: 50667.43, ppop: 32871.54, provisions: 4209.0, exceptional_items: 0, pbt: 28662.54, tax: 7125.45, pat: 21537.09, pat_owners: 20700.03 } },
  { start: "2026-04-01", end: "2026-06-30", values: { revenue: 90575.33, other_income: 42535.03, interest_expended: 47625.63, ppop: 30996.0, provisions: 3802.84, exceptional_items: 0, pbt: 27193.16, tax: 6810.47, pat: 20382.69, pat_owners: 19244.71 } },
  { start: "2025-07-01", end: "2025-09-30", values: { revenue: 86993.84, other_income: 31566.79, interest_expended: 46740.86, ppop: 30940.72, provisions: 4281.83, exceptional_items: 0, pbt: 26658.89, tax: 6295.12, pat: 20363.77, pat_owners: 19610.67 } },
  { start: "2026-04-01", end: "2026-09-30", values: { revenue: 185706.96, other_income: 76762.09, interest_expended: 98293.06, ppop: 63867.54, provisions: 8011.84, exceptional_items: 0, pbt: 55855.7, tax: 13935.92, pat: 41919.78, pat_owners: 39944.74 } },
];

/** Screener, consolidated, Sep 2026 quarter. */
export const SCREENER = {
  DIXON: { basis: "consolidated" as const, revenue: 21794, pbt: 532, pat: 411, operating_profit: 597 },
  HDFCBANK: { basis: "consolidated" as const, revenue: 95132, pbt: 28663, pat: 21537, operating_profit: null },
};

// ─── Real page text ──────────────────────────────────────────────────────────

const here = (f: string) => new URL(f, import.meta.url);
function loadPages(file: string): string[] {
  const j = JSON.parse(readFileSync(here(file), "utf8")) as { total_pages: number; pages: Record<string, string> };
  return Array.from({ length: j.total_pages }, (_, i) => j.pages[String(i + 1)] ?? "");
}
export const DIXON_PAGES = loadPages("./dixon-q2fy27.pages.json");
export const HDFCBANK_PAGES = loadPages("./hdfcbank-q2fy27.pages.json");

// ─── XBRL in the Ind AS results taxonomy layout ─────────────────────────────

const NON_BANK_TAGS: Partial<Record<Field, string>> = {
  revenue: "RevenueFromOperations",
  other_income: "OtherIncome",
  finance_costs: "FinanceCosts",
  depreciation: "DepreciationDepletionAndAmortisationExpense",
  share_of_associates_in_pbt: "ShareOfProfitLossOfAssociatesAndJointVenturesAccountedForUsingEquityMethod",
  pbt_before_exceptional: "ProfitBeforeExceptionalItemsAndTax",
  exceptional_items: "ExceptionalItemsBeforeTax",
  pbt: "ProfitBeforeTax",
  tax: "TaxExpense",
  pat: "ProfitLossForPeriod",
  pat_owners: "ProfitOrLossAttributableToOwnersOfParent",
  operating_cash_flow: "CashFlowsFromUsedInOperatingActivities",
};
const BANK_TAGS: Partial<Record<Field, string>> = {
  revenue: "InterestEarned",
  other_income: "OtherIncome",
  interest_expended: "InterestExpended",
  ppop: "OperatingProfitBeforeProvisionAndContingencies",
  provisions: "ProvisionsOtherThanTaxAndContingencies",
  exceptional_items: "ExceptionalItems",
  pbt: "ProfitLossFromOrdinaryActivitiesBeforeTax",
  tax: "TaxExpense",
  pat: "NetProfitLossFromOrdinaryActivitiesAfterTax",
  pat_owners: "NetProfitLossForThePeriod",
};

export function xbrl(opts: { scrip: string; basis: "Consolidated" | "Standalone" | null; cols: Cols; bank?: boolean; extra?: string }): string {
  const tags = opts.bank ? BANK_TAGS : NON_BANK_TAGS;
  const ids = ["OneD", "TwoD", "ThreeD", "FourD", "FiveD", "SixD"];
  const contexts = opts.cols
    .map(
      (c, i) => `  <xbrli:context id="${ids[i]}">
    <xbrli:entity><xbrli:identifier scheme="http://www.bseindia.com">${opts.scrip}</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:startDate>${c.start}</xbrli:startDate><xbrli:endDate>${c.end}</xbrli:endDate></xbrli:period>
  </xbrli:context>`,
    )
    .join("\n");
  const facts = opts.cols
    .flatMap((c, i) =>
      Object.entries(c.values).flatMap(([f, v]) => {
        const tag = tags[f as Field];
        // Values in rupees, as XBRL reports them (₹ crore × 1e7).
        return tag && v !== undefined ? [`  <in-bse-fin:${tag} contextRef="${ids[i]}" unitRef="INR" decimals="-5">${Math.round(v * 1e7)}</in-bse-fin:${tag}>`] : [];
      }),
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:in-bse-fin="http://www.bseindia.com/xbrl/fin/2020-03-31/in-bse-fin" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
${contexts}
  <xbrli:context id="OneD_Segment1">
    <xbrli:entity><xbrli:identifier scheme="http://www.bseindia.com">${opts.scrip}</xbrli:identifier>
      <xbrli:segment><xbrldi:explicitMember dimension="in-bse-fin:SegmentsAxis">in-bse-fin:Segment1Member</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
    <xbrli:period><xbrli:startDate>${opts.cols[0]!.start}</xbrli:startDate><xbrli:endDate>${opts.cols[0]!.end}</xbrli:endDate></xbrli:period>
  </xbrli:context>
  <xbrli:unit id="INR"><xbrli:measure>iso4217:INR</xbrli:measure></xbrli:unit>
  <xbrli:unit id="shares"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit>
${opts.basis ? `  <in-bse-fin:NatureOfReportStandaloneConsolidated contextRef="OneD">${opts.basis}</in-bse-fin:NatureOfReportStandaloneConsolidated>` : ""}
  <in-bse-fin:LevelOfRoundingUsedInFinancialStatements contextRef="OneD">Crores</in-bse-fin:LevelOfRoundingUsedInFinancialStatements>
${facts}
  <in-bse-fin:RevenueFromOperations contextRef="OneD_Segment1" unitRef="INR" decimals="-5">99999990000000</in-bse-fin:RevenueFromOperations>
${opts.extra ?? ""}
</xbrli:xbrl>
`;
}

/** What a model reading the real pages would return (numbers as printed, crores, page refs). */
export function dixonModelOutput(override?: (v: Record<string, number | null>, colIndex: number) => void) {
  const blank = Object.fromEntries(
    ["revenue", "other_income", "finance_costs", "depreciation", "share_of_associates_in_pbt", "pbt_before_exceptional", "exceptional_items", "pbt", "tax", "share_of_associates_after_tax", "pat", "pat_owners", "interest_expended", "ppop", "provisions", "operating_cash_flow"].map((k) => [k, null]),
  ) as Record<string, number | null>;
  return {
    statements: [
      {
        basis: "consolidated",
        unit: "crores",
        page: 11,
        columns: DIXON.map((c, i) => {
          const values = { ...blank, ...c.values };
          override?.(values, i);
          return { period_start: c.start, period_end: c.end, values, cash_flow_page: c.values.operating_cash_flow !== undefined ? 14 : null };
        }),
      },
    ],
  };
}
