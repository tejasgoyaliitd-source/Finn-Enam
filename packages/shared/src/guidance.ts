import { z } from "zod";
import { FiscalPeriod, QuarterPeriod, Symbol } from "./primitives";

/** Drives the verdict tolerance: 0.5 pp for margins, 2% relative for growth and amounts. */
export const MetricKind = z.enum(["margin", "growth", "absolute", "ratio", "other"]);
export type MetricKind = z.infer<typeof MetricKind>;

export const GuidanceUnit = z.enum(["pct", "inr_cr", "x", "count", "days", "other"]);
export type GuidanceUnit = z.infer<typeof GuidanceUnit>;

export const GuidanceTarget = z.discriminatedUnion("kind", [
  z
    .strictObject({ kind: z.literal("range"), low: z.number(), high: z.number() })
    .refine((t) => t.low < t.high, { message: "Range low must be below high (use a point target if equal)" }),
  z.strictObject({ kind: z.literal("point"), value: z.number() }),
  z.strictObject({ kind: z.literal("direction"), direction: z.enum(["up", "down", "flat"]) }),
  /** "Meaningful growth", "strong year": nothing checkable. */
  z.strictObject({ kind: z.literal("none") }),
]);
export type GuidanceTarget = z.infer<typeof GuidanceTarget>;

/** Quotes below this fuzzy-match ratio against their cited page are never stored. */
export const MIN_QUOTE_MATCH = 0.85;

export const GuidanceStatement = z
  .strictObject({
    id: z.uuid(),
    symbol: Symbol,
    doc_id: z.uuid(),
    /** The call the statement was made on. */
    call_period: QuarterPeriod,
    /**
     * Canonical key used to match statements across calls and to actuals:
     * revenue, revenue_growth, revenue_growth_cc, ebitda, ebitda_margin, pat, pat_growth,
     * pat_margin, capex, or "other:<slug>".
     */
    metric: z.string().regex(/^(?:[a-z_]+|other:[a-z0-9_]+)$/),
    /** The metric as management named it, e.g. "EBITDA margin". */
    metric_label: z.string().min(1),
    metric_kind: MetricKind,
    scope: z.enum(["company", "segment"]),
    segment: z.string().min(1).nullable(),
    target: GuidanceTarget,
    unit: GuidanceUnit.nullable(),
    /** The period the target is for, e.g. FY27. Null when management gave none ("medium term"). */
    period_target: FiscalPeriod.nullable(),
    /** Hedge words exactly as spoken ("aspire", "subject to"). Each must appear in the quote. */
    hedges: z.array(z.string().min(1)),
    /** Verbatim quote from the transcript. */
    quote: z.string().min(1).max(2000),
    page: z.number().int().positive(),
    /** Fuzzy-match ratio of the quote against the cited page, 0–1. Below MIN_QUOTE_MATCH is dropped. */
    quote_match: z.number().min(MIN_QUOTE_MATCH).max(1),
  })
  .superRefine((s, ctx) => {
    if ((s.scope === "segment") !== (s.segment !== null)) {
      ctx.addIssue({ code: "custom", path: ["segment"], message: "Segment name is required exactly when scope is segment" });
    }
    const quote = s.quote.toLowerCase();
    s.hedges.forEach((h, i) => {
      if (!quote.includes(h.toLowerCase())) {
        ctx.addIssue({ code: "custom", path: ["hedges", i], message: `Hedge "${h}" is not in the quote` });
      }
    });
    const numeric = s.target.kind === "range" || s.target.kind === "point";
    if (numeric && s.unit === null) {
      ctx.addIssue({ code: "custom", path: ["unit"], message: "Numeric targets need a unit" });
    }
    if (numeric && s.metric_kind === "margin" && s.unit !== "pct") {
      ctx.addIssue({ code: "custom", path: ["unit"], message: "Margin targets must be in pct" });
    }
  });
export type GuidanceStatement = z.infer<typeof GuidanceStatement>;

/** A figure management reported for a finished period ("EBITDA margin for the year was 20.8%"). */
export const ReportedActual = z.strictObject({
  symbol: Symbol,
  metric: z.string().regex(/^(?:[a-z_]+|other:[a-z0-9_]+)$/),
  period: FiscalPeriod,
  value: z.number(),
  unit: GuidanceUnit,
  quote: z.string().min(1).max(2000),
  page: z.number().int().positive(),
  quote_match: z.number().min(MIN_QUOTE_MATCH).max(1),
});
export type ReportedActual = z.infer<typeof ReportedActual>;
