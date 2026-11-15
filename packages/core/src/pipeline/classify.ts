import { z } from "zod";
import { AnalysisMethod, FilingCategory } from "@finn/shared";
import type { LlmClient, Logger } from "../ports";
import { classifyByRules, RULES, type Rule } from "./rules";

export const CLASSIFY_PROMPT_VERSION = "classify-v1";
export const CLASSIFY_SYSTEM = [
  "You classify one Indian stock exchange filing (NSE/BSE, SEBI LODR) for a fund manager.",
  `Pick exactly one category from: ${FilingCategory.options.join(", ")}.`,
  "Set routine=true only for pure compliance boilerplate that a fund manager never needs to read",
  "(trading window closures, newspaper copies, certificates, meeting schedules).",
  "sub_kind: a short snake_case label such as resignation, order_win, penalty; or null.",
  "Use only the text given. If unsure between categories, pick the more serious one.",
  'Return JSON: {"category": "...", "sub_kind": "..." | null, "routine": true | false}',
].join("\n");

export const ClassifyOutput = z.object({
  category: FilingCategory,
  sub_kind: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).nullable(),
  routine: z.boolean(),
});

export interface Classification {
  category: FilingCategory;
  sub_kind: string | null;
  routine: boolean;
  method: AnalysisMethod;
  model: string | null;
  /** Why the rules didn't settle it, when they didn't. */
  note: string | null;
}

const fromRule = (r: Rule, method: AnalysisMethod, note: string | null = null): Classification => ({
  category: r.category,
  sub_kind: r.sub_kind,
  routine: r.routine ?? false,
  method,
  model: null,
  note,
});

/**
 * Rules first. The tier-1 model is called only when no rule matched or the top rules
 * disagree. If the model is absent or fails: an ambiguous filing takes the first matching
 * rule in table order, an unmatched one becomes "unclassified"; both are marked "fallback".
 */
export async function classify(
  f: { exch_category: string; subject: string; symbol: string },
  llm: LlmClient | undefined,
  log: Logger,
): Promise<Classification> {
  const r = classifyByRules(f.exch_category, f.subject);
  if (r.kind === "match") return fromRule(r.rule, "rule");

  const note =
    r.kind === "none"
      ? "No rule matched"
      : `Rules disagree: ${[...new Set(r.candidates.map((c) => c.category))].join(" vs ")}`;

  if (llm) {
    try {
      const { data, model } = await llm.run({
        task: "classify_filing",
        tier: "cheap",
        promptVersion: CLASSIFY_PROMPT_VERSION,
        system: CLASSIFY_SYSTEM,
        input: `Company: ${f.symbol}\nExchange category: ${f.exch_category}\nSubject: ${f.subject}`,
        schema: ClassifyOutput,
      });
      return { ...data, method: "model", model, note };
    } catch (err) {
      log.warn("classify: model failed, using fallback", { symbol: f.symbol, error: String(err) });
    }
  }

  if (r.kind === "ambiguous") {
    const first = RULES.find((rule) => r.candidates.includes(rule))!;
    return fromRule(first, "fallback", note);
  }
  return { category: "unclassified", sub_kind: null, routine: false, method: "fallback", model: null, note };
}
