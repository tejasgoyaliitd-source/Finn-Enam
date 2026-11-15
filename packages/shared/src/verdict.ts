import { z } from "zod";
import { IstDateTime, QuarterPeriod } from "./primitives";

/** Machine codes. Use VERDICT_LABEL for anything shown on screen. */
export const VerdictCode = z.enum([
  "met",
  "missed",
  "behind",
  "revised",
  "too_early",
  "not_measurable",
  "not_mentioned_since",
]);
export type VerdictCode = z.infer<typeof VerdictCode>;

export const VERDICT_LABEL = {
  met: "Met",
  missed: "Missed",
  behind: "Behind",
  revised: "Revised",
  too_early: "Too early",
  not_measurable: "Not measurable",
  not_mentioned_since: "Not mentioned since",
} as const satisfies Record<VerdictCode, string>;

/** The credibility line ("Met X of Y targets that are due") counts only these. */
export const CREDIBILITY_VERDICTS = ["met", "missed"] as const satisfies readonly VerdictCode[];

export const Verdict = z
  .strictObject({
    statement_id: z.uuid(),
    verdict: VerdictCode,
    /** Factual sentence citing the numbers, e.g. "Guided 18–20%, delivered 19.1%". */
    reason: z.string().min(1).max(500),
    /** Progress so far against a target whose period hasn't finished. */
    pace_note: z.string().min(1).nullable(),
    /** The last call that mentioned this target (for not_mentioned_since). */
    last_mentioned_in: QuarterPeriod.nullable(),
    /** For "revised": the later statement that replaced this one. */
    superseded_by_statement_id: z.uuid().nullable(),
    as_of: IstDateTime,
    /** Version of the deterministic rule set that produced this verdict. */
    rule_version: z.string().min(1),
  })
  .superRefine((v, ctx) => {
    const paced = v.verdict === "too_early" || v.verdict === "behind";
    if (v.pace_note !== null && !paced) {
      ctx.addIssue({ code: "custom", path: ["pace_note"], message: "Pace notes only apply to too_early or behind" });
    }
    if ((v.verdict === "not_mentioned_since") !== (v.last_mentioned_in !== null)) {
      ctx.addIssue({ code: "custom", path: ["last_mentioned_in"], message: "Required exactly when the verdict is not_mentioned_since" });
    }
    if ((v.verdict === "revised") !== (v.superseded_by_statement_id !== null)) {
      ctx.addIssue({ code: "custom", path: ["superseded_by_statement_id"], message: "Required exactly when the verdict is revised" });
    }
  });
export type Verdict = z.infer<typeof Verdict>;
