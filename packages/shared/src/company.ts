import { z } from "zod";
import { BseCode, IstDateTime, Isin, Symbol } from "./primitives";

export const Company = z.strictObject({
  symbol: Symbol,
  name: z.string().min(1),
  isin: Isin,
  bse_code: BseCode.nullable(),
  sector: z.string().min(1).nullable(),
  /** Banks and NBFCs get a different results card (no EBITDA). */
  is_bank: z.boolean(),
});
export type Company = z.infer<typeof Company>;

export const Holding = z.strictObject({
  portfolio_id: z.uuid(),
  symbol: Symbol,
  /** Share of the portfolio, 0–100 scale. */
  weight_pct: z.number().gt(0).max(100),
  added_at: IstDateTime,
});
export type Holding = z.infer<typeof Holding>;

export const MandateActivity = z.enum(["alcohol", "tobacco", "gambling", "real_money_gaming", "animal_harm"]);
export type MandateActivity = z.infer<typeof MandateActivity>;

/** portfolios.settings: the fund's house view. */
export const HouseView = z.strictObject({
  mandate: z.strictObject({
    excluded_activities: z.array(MandateActivity),
    excluded_symbols: z.array(Symbol),
  }),
  push: z.strictObject({
    channel: z.literal("telegram"),
    max_per_day: z.number().int().min(0).max(10),
    digest_time_ist: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM, 24-hour IST"),
  }),
  muted_sub_kinds: z.array(z.string().min(1)),
});
export type HouseView = z.infer<typeof HouseView>;

/** Weights may leave room for cash but can never exceed 100% in total. */
export const WEIGHT_SUM_TOLERANCE_PCT = 0.01;

export const Portfolio = z
  .strictObject({
    id: z.uuid(),
    name: z.string().min(1),
    holdings: z.array(Holding),
  })
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    let total = 0;
    p.holdings.forEach((h, i) => {
      if (h.portfolio_id !== p.id) {
        ctx.addIssue({ code: "custom", path: ["holdings", i, "portfolio_id"], message: "Holding belongs to a different portfolio" });
      }
      if (seen.has(h.symbol)) {
        ctx.addIssue({ code: "custom", path: ["holdings", i, "symbol"], message: `Duplicate holding ${h.symbol}` });
      }
      seen.add(h.symbol);
      total += h.weight_pct;
    });
    if (total > 100 + WEIGHT_SUM_TOLERANCE_PCT) {
      ctx.addIssue({ code: "custom", path: ["holdings"], message: `Weights sum to ${total.toFixed(2)}%, above 100%` });
    }
  });
export type Portfolio = z.infer<typeof Portfolio>;
