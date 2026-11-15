import { z } from "zod";
import { GuidanceStatement, GuidanceUnit, MetricKind, ReportedActual, type GuidanceTarget } from "@finn/shared";
import type { Hasher, LlmClient } from "../ports";
import { canonicalMetric } from "./metrics";
import { normalizePeriod } from "./periods";
import { findHedges, verifyQuote } from "./quotes";

/**
 * Guidance extraction. The mid-tier model only finds and transcribes management's
 * forward-looking statements (and figures they reported for finished periods). Code then
 * verifies every quote against its cited page, canonicalises the metric, finds hedge words,
 * and builds validated statements. Nothing about whether a target was met comes from the model.
 */

export const GUIDANCE_PROMPT_VERSION = "guidance-extract-v1";
export const GUIDANCE_SYSTEM = [
  "You read an Indian listed company's earnings call transcript. Pages are marked '=== Page N ==='.",
  "1) guidance: every forward-looking commitment made by MANAGEMENT (never an analyst's question or paraphrase).",
  "   For each: metric_label as management said it; metric_kind (margin, growth, absolute, ratio, other);",
  "   scope company or segment (segment = a business line, product, subsidiary, geography or client group; give its name);",
  "   target_kind: range (low, high), point (value), direction (up/down/flat), or none if there is no number or direction;",
  "   unit: pct for percentages, inr_cr for rupee amounts converted to crore, x, count, days, other;",
  "   period_target as FY27, H2FY27, Q3FY27 etc. ONLY if management stated or clearly implied the period",
  "   ('this year' on a FY26 call = FY26, 'next year' = FY27); null for 'medium term', 'next few years' etc.;",
  "   hedges: words that make it conditional or aspirational, copied exactly ('we aspire to', 'subject to ...', 'hopefully');",
  "   quote: the exact words from the transcript, copied character for character, one or two sentences; page: where the quote is.",
  "2) reported: figures management stated for a FINISHED period ('EBITDA margin for the year was 20.8%'),",
  "   same fields: metric_label, metric_kind, period, value, unit, quote, page.",
  "Do not compute, infer numbers, or judge anything. Return JSON matching the schema exactly.",
].join("\n");

const n = z.number().nullable();
export const GuidanceExtraction = z.strictObject({
  guidance: z.array(
    z.strictObject({
      speaker_role: z.enum(["management", "analyst", "moderator"]),
      metric_label: z.string().min(1).max(80),
      metric_kind: MetricKind,
      scope: z.enum(["company", "segment"]),
      segment: z.string().min(1).max(80).nullable(),
      target_kind: z.enum(["range", "point", "direction", "none"]),
      low: n,
      high: n,
      value: n,
      direction: z.enum(["up", "down", "flat"]).nullable(),
      unit: GuidanceUnit.nullable(),
      period_target: z.string().max(12).nullable(),
      hedges: z.array(z.string().min(1).max(80)),
      quote: z.string().min(5).max(1200),
      page: z.number().int().positive(),
    }),
  ),
  reported: z.array(
    z.strictObject({
      metric_label: z.string().min(1).max(80),
      metric_kind: MetricKind,
      period: z.string().max(12),
      value: z.number(),
      unit: GuidanceUnit,
      quote: z.string().min(5).max(600),
      page: z.number().int().positive(),
    }),
  ),
});
export type GuidanceExtraction = z.infer<typeof GuidanceExtraction>;

export async function extractGuidance(llm: LlmClient, pages: string[]) {
  return llm.run({
    task: "extract_guidance",
    tier: "mid",
    promptVersion: GUIDANCE_PROMPT_VERSION,
    system: GUIDANCE_SYSTEM,
    input: pages.map((t, i) => `=== Page ${i + 1} ===\n${t}`).join("\n\n"),
    schema: GuidanceExtraction,
  });
}

/** A deterministic UUID from a hash: re-processing the same transcript yields the same ids. */
export async function stableUuid(hash: Hasher, seed: string): Promise<string> {
  const h = await hash.sha256(seed);
  const v = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface Dropped {
  quote: string;
  page: number;
  reason: string;
}

export interface Processed {
  statements: GuidanceStatement[];
  reported: ReportedActual[];
  dropped: Dropped[];
}

function targetOf(g: GuidanceExtraction["guidance"][number]): GuidanceTarget | string {
  switch (g.target_kind) {
    case "range":
      if (g.low === null || g.high === null) return "range without both ends";
      if (g.low === g.high) return { kind: "point", value: g.low };
      return g.low < g.high ? { kind: "range", low: g.low, high: g.high } : { kind: "range", low: g.high, high: g.low };
    case "point":
      return g.value === null ? "point target without a value" : { kind: "point", value: g.value };
    case "direction":
      return g.direction === null ? "direction target without a direction" : { kind: "direction", direction: g.direction };
    case "none":
      return { kind: "none" };
  }
}

/** Verify, canonicalise and validate. Anything that fails is dropped with a reason, never "fixed" by guessing. */
export async function processExtraction(
  x: GuidanceExtraction,
  pages: string[],
  ctx: { symbol: string; doc_id: string; call_period: string; hash: Hasher },
): Promise<Processed> {
  const out: Processed = { statements: [], reported: [], dropped: [] };
  const seen = new Set<string>();

  for (const g of x.guidance) {
    const drop = (reason: string) => out.dropped.push({ quote: g.quote, page: g.page, reason });
    if (g.speaker_role !== "management") { drop(`spoken by ${g.speaker_role}, not management`); continue; }
    const q = verifyQuote(g.quote, pages, g.page);
    if (!q.ok) { drop(`quote not found on p.${g.page} (match ${q.ratio})`); continue; }
    const target = targetOf(g);
    if (typeof target === "string") { drop(target); continue; }
    const id = await stableUuid(ctx.hash, `${ctx.doc_id}|${g.page}|${g.quote}`);
    if (seen.has(id)) continue;
    seen.add(id);
    const metric = canonicalMetric(g.metric_label, g.metric_kind, g.unit);
    const parsed = GuidanceStatement.safeParse({
      id,
      symbol: ctx.symbol,
      doc_id: ctx.doc_id,
      call_period: ctx.call_period,
      metric,
      metric_label: g.metric_label,
      metric_kind: metric.endsWith("_margin") ? "margin" : metric.endsWith("_growth") ? "growth" : g.metric_kind,
      scope: g.scope,
      segment: g.scope === "segment" ? (g.segment ?? "unnamed segment") : null,
      target,
      unit: target.kind === "range" || target.kind === "point" ? (g.unit ?? null) : g.unit,
      period_target: normalizePeriod(g.period_target),
      hedges: findHedges(g.quote, g.hedges),
      quote: g.quote,
      page: g.page,
      quote_match: q.ratio,
    });
    if (parsed.success) out.statements.push(parsed.data);
    else drop(parsed.error.issues.map((i) => i.message).join("; "));
  }

  for (const r of x.reported) {
    const period = normalizePeriod(r.period);
    const q = verifyQuote(r.quote, pages, r.page);
    const drop = (reason: string) => out.dropped.push({ quote: r.quote, page: r.page, reason });
    if (!q.ok) { drop(`quote not found on p.${r.page} (match ${q.ratio})`); continue; }
    if (!period) { drop(`unrecognised period "${r.period}"`); continue; }
    if (!r.quote.includes(String(r.value)) && !r.quote.replace(/,/g, "").includes(String(r.value))) {
      drop(`reported value ${r.value} is not in the quote`);
      continue;
    }
    out.reported.push(ReportedActual.parse({
      symbol: ctx.symbol,
      metric: canonicalMetric(r.metric_label, r.metric_kind, r.unit),
      period,
      value: r.value,
      unit: r.unit,
      quote: r.quote,
      page: r.page,
      quote_match: q.ratio,
    }));
  }
  return out;
}
