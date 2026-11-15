import { round2, type Basis } from "@finn/shared";

/**
 * The common shape both extractors (XBRL, PDF) produce, before the card is built.
 * Every amount is already in ₹ crore.
 */

export const FIELDS = [
  "revenue", // revenue from operations; banks: interest earned
  "other_income",
  "finance_costs",
  "depreciation",
  "share_of_associates_in_pbt",
  "pbt_before_exceptional",
  "exceptional_items",
  "pbt",
  "tax",
  "share_of_associates_after_tax",
  "pat", // profit for the period before non-controlling interest
  "pat_owners",
  "interest_expended", // banks
  "ppop", // banks: operating profit before provisions and contingencies
  "provisions", // banks: provisions (other than tax) and contingencies
  "operating_cash_flow", // net cash from operating activities (cash flow columns only)
] as const;
export type Field = (typeof FIELDS)[number];
export type Values = Partial<Record<Field, number | null>>;

export interface Column {
  /** YYYY-MM-DD */
  start: string;
  end: string;
  values: Values;
  /** Page the numbers came from (PDF path). */
  page: number | null;
  /** Page of the cash flow statement, if operating_cash_flow came from a different page. */
  cash_flow_page?: number | null;
}

export interface Statement {
  basis: Basis;
  columns: Column[];
}

// ─── Units ──────────────────────────────────────────────────────────────────

/** Multiply a figure in this unit by the factor to get ₹ crore. 1 crore = 100 lakh = 10 million = 1e7 rupees. */
export const TO_CRORE = {
  rupees: 1e-7,
  thousands: 1e-4,
  lakhs: 1e-2,
  millions: 1e-1,
  crores: 1,
  billions: 100,
} as const;
export type Unit = keyof typeof TO_CRORE;

export function toCrore(value: number, unit: Unit): number {
  return round2(value * TO_CRORE[unit]);
}

/** Reads the unit line printed above a statement: "(Rupees in Crores unless otherwise stated)", "₹ in lakhs". */
export function unitFromLabel(label: string): Unit | null {
  const s = label.toLowerCase();
  if (/\bcrores?\b|\bcr\b/.test(s)) return "crores";
  if (/\blakhs?\b|\blacs?\b/.test(s)) return "lakhs";
  if (/\bmillions?\b|\bmn\b/.test(s)) return "millions";
  if (/\bbillions?\b|\bbn\b/.test(s)) return "billions";
  if (/\bthousands?\b|'000|\b000s\b/.test(s)) return "thousands";
  if (/\brupees\b|\binr\b|₹|\brs\.?\b/.test(s)) return "rupees";
  return null;
}

// ─── Periods ────────────────────────────────────────────────────────────────

export function monthsBetween(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  // 2026-07-01 → 2026-09-30 is 3 months.
  return (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()) + (e.getUTCDate() >= 28 ? 1 : 0);
}

function shiftMonths(end: string, months: number): string {
  const e = new Date(`${end}T00:00:00Z`);
  // Last day of the month `months` earlier.
  return new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - months + 1, 0)).toISOString().slice(0, 10);
}

export interface PickedPeriods {
  current: Column;
  prior_quarter: Column | null;
  year_ago: Column | null;
  /** Q2: the 6-month column ending with the quarter; Q4: the 12-month column. */
  cash: Column | null;
}

/** Finds the reporting quarter and its comparatives among a statement's columns. */
export function pickPeriods(columns: Column[]): PickedPeriods | null {
  const quarters = columns.filter((c) => monthsBetween(c.start, c.end) === 3).sort((a, b) => b.end.localeCompare(a.end));
  const current = quarters[0];
  if (!current) return null;
  const find = (months: number) => quarters.find((c) => c.end === shiftMonths(current.end, months)) ?? null;
  const cashMonths = current.end.slice(5) === "09-30" ? 6 : current.end.slice(5) === "03-31" ? 12 : null;
  const cash = cashMonths
    ? (columns.find((c) => c.end === current.end && monthsBetween(c.start, c.end) === cashMonths && c.values.operating_cash_flow != null) ?? null)
    : null;
  return { current, prior_quarter: find(3), year_ago: find(12), cash };
}
