import { z } from "zod";
import { Exchange, IstDateTime, Sha256, Symbol } from "./primitives";

/**
 * One exchange announcement after normalisation, before classification.
 * Immutable once stored: filings never change after they are filed.
 */
export const NormalizedFiling = z.strictObject({
  symbol: Symbol,
  exchange: Exchange,
  /** The exchange's own category string, kept verbatim for the classifier. */
  exch_category: z.string().min(1),
  /** The exchange's raw subject line. Never shown to users as a headline. */
  subject: z.string().min(1),
  /** Some announcements have no attachment. */
  attachment_url: z.url({ protocol: /^https?$/ }).nullable(),
  filed_at: IstDateTime,
  /**
   * Identity of this exchange record: SHA-256 of exchange + symbol + canonical subject +
   * filed_at. Re-polling the same record is a no-op.
   */
  dedupe_key: Sha256,
  /**
   * SHA-256 of symbol + canonical subject (boilerplate stripped). The pipeline links a filing
   * as a duplicate when another filing with the same hash landed within ±10 minutes.
   */
  subject_hash: Sha256,
});
export type NormalizedFiling = z.infer<typeof NormalizedFiling>;

export const FilingCategory = z.enum([
  "results",
  "m_and_a",
  "fund_raise",
  "management_change",
  "auditor_change",
  "regulatory_order",
  "litigation",
  "insider_trading",
  "earnings_call",
  "investor_meetings",
  "credit_rating",
  "dividend",
  "bonus_split",
  "capex",
  "press_release",
  "postal_ballot",
  "agm_egm",
  "pledging",
  /** Operational disruption: strikes, lockouts, fire, accidents, cyber incidents, plant shutdowns. */
  "disruption",
  /** LODR boilerplate: trading window, newspaper copies, lost certificates, meet schedules. */
  "routine",
  "unclassified",
]);
export type FilingCategory = z.infer<typeof FilingCategory>;

export const FilingTier = z.enum(["act", "read", "routine"]);
export type FilingTier = z.infer<typeof FilingTier>;

/** rule = a deterministic rule matched; model = tier-1 model decided; fallback = neither was possible. */
export const AnalysisMethod = z.enum(["rule", "model", "fallback"]);
export type AnalysisMethod = z.infer<typeof AnalysisMethod>;

/** Reasons are for people: plain sentences, never "+80" or score arithmetic. */
const Reason = z
  .string()
  .min(3)
  .max(160)
  .refine((r) => !/(^|\s)[+−-]\s?\d+\b/.test(r) && !/\bscore\b/i.test(r) && !/\bpoints?\b/i.test(r), {
    message: "Reasons must be plain language, with no score arithmetic",
  });

export const FilingAnalysis = z.strictObject({
  filing_id: z.number().int().positive(),
  category: FilingCategory,
  sub_kind: z.string().min(1).nullable(),
  tier: FilingTier,
  /** Internal ranking only. Never shown and never written into reasons. */
  score: z.number().int().min(0),
  reasons: z.array(Reason).min(1),
  headline: z.string().min(3).max(120).refine((h) => !h.includes("\n"), "One line"),
  method: AnalysisMethod,
  model: z.string().min(1).nullable(),
  event_id: z.number().int().positive().nullable(),
});
export type FilingAnalysis = z.infer<typeof FilingAnalysis>;
