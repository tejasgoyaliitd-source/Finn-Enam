import { z } from "zod";

/** NSE trading symbol, e.g. "RELIANCE", "M&M", "BAJAJ-AUTO". */
export const Symbol = z.string().regex(/^[A-Z0-9&-]{1,20}$/, "NSE symbol: A-Z, 0-9, & or -");
export type Symbol = z.infer<typeof Symbol>;

export const Isin = z.string().regex(/^IN[A-Z0-9]{9}[0-9]$/, "Indian ISIN, e.g. INE002A01018");

/** BSE scrip code, six digits. */
export const BseCode = z.string().regex(/^\d{6}$/, "BSE scrip code is six digits");

export const Exchange = z.enum(["NSE", "BSE"]);
export type Exchange = z.infer<typeof Exchange>;

/**
 * Absolute timestamp in IST. Must carry an explicit +05:30 offset so it is never
 * ambiguous (no naive local times, no silent UTC). Example: 2026-11-14T16:42:05+05:30
 */
export const IstDateTime = z.iso
  .datetime({ offset: true })
  .refine((s) => s.endsWith("+05:30"), "Timestamp must be in IST with an explicit +05:30 offset");
export type IstDateTime = z.infer<typeof IstDateTime>;

/** Lowercase hex SHA-256. */
export const Sha256 = z.string().regex(/^[a-f0-9]{64}$/, "Lowercase hex SHA-256");

/** Indian fiscal quarter, e.g. Q2FY27 (Jul–Sep 2026). */
export const QuarterPeriod = z.string().regex(/^Q[1-4]FY\d{2}$/, "Quarter like Q2FY27");
export type QuarterPeriod = z.infer<typeof QuarterPeriod>;

/** Any fiscal period a target can refer to: FY27, H1FY27, 9MFY27, Q3FY27. */
export const FiscalPeriod = z
  .string()
  .regex(/^(Q[1-4]|H[12]|9M)?FY\d{2}$/, "Period like FY27, H1FY27, 9MFY27 or Q3FY27");
export type FiscalPeriod = z.infer<typeof FiscalPeriod>;

/** Rupee amounts are always stored in crore. Lakh figures are converted at ingestion. */
export const Crore = z.number();

/** Percentage on a 0–100 scale (not 0–1). */
export const Percent = z.number().min(0).max(100);
