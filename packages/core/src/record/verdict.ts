import { CREDIBILITY_VERDICTS, Verdict, type GuidanceStatement, type GuidanceTarget, type IstDateTime, type VerdictCode } from "@finn/shared";
import type { ActualsBook } from "./actuals";
import { higherIsBetter, MEASURABLE, metricName, tolerance, unmeasurableReason } from "./metrics";
import { lastQuarter, partialLabel, periodLabel, periodQuarters, priorYear, quarterOrdinal } from "./periods";

/**
 * The verdict engine. Pure code, no model. Rules, in the order they are applied to the latest
 * statement of each target ("thread": same metric, period, scope and segment):
 *
 *   Not measurable  no number or direction · no period · segment target · no actual exists for the metric
 *   Met / Missed    period finished: actual within range or at/above the threshold → Met;
 *                   below by more than the tolerance (0.5 pp margins, 2% relative otherwise) → Missed
 *   Not mentioned since  period not finished, and absent from 2+ later calls held before it ends
 *   Too early       period not finished; pace note with the run rate so far
 *
 * Earlier statements in a thread take the latest one's verdict when they said the same thing,
 * or Revised when a later call gave a different target. Hedges never change the maths; they
 * are appended to the reason.
 */
export const RULE_VERSION = "verdict-v1";

export interface VerdictContext {
  /** Every call held for the company (quarter of the results discussed), whether or not it had guidance. */
  calls: string[];
  actuals: ActualsBook;
  as_of: IstDateTime;
}

export const threadKey = (s: Pick<GuidanceStatement, "metric" | "period_target" | "scope" | "segment">) =>
  `${s.metric}|${s.period_target ?? "-"}|${s.scope}|${(s.segment ?? "").toLowerCase().trim()}`;

// ─── Formatting ──────────────────────────────────────────────────────────────

const num = (x: number) => Number(x.toFixed(2)).toString();
const pct1 = (x: number) => `${Number(x.toFixed(1))}%`;
export function fmtValue(v: number, unit: string | null): string {
  if (unit === "pct") return pct1(v);
  if (unit === "inr_cr") return `₹${Math.round(v).toLocaleString("en-IN")} cr`;
  return num(v);
}
export function fmtTarget(t: GuidanceTarget, unit: string | null): string {
  switch (t.kind) {
    case "point": return fmtValue(t.value, unit);
    case "range":
      return unit === "pct" ? `${num(t.low)}–${num(t.high)}%` : unit === "inr_cr"
        ? `₹${Math.round(t.low).toLocaleString("en-IN")}–${Math.round(t.high).toLocaleString("en-IN")} cr`
        : `${num(t.low)}–${num(t.high)}`;
    case "direction": return t.direction === "up" ? "an increase" : t.direction === "down" ? "a decrease" : "no change";
    case "none": return "no number";
  }
}
const sameTarget = (a: GuidanceTarget, b: GuidanceTarget) => JSON.stringify(a) === JSON.stringify(b);
const withHedge = (reason: string, s: GuidanceStatement) =>
  s.hedges.length ? `${reason} · Hedged: ${s.hedges.map((h) => `"${h}"`).join(", ")}` : reason;

// ─── Rules ───────────────────────────────────────────────────────────────────

type Outcome = { verdict: VerdictCode; reason: string; pace_note?: string | null; last_mentioned_in?: string | null };

function notMeasurable(s: GuidanceStatement): string | null {
  if (s.target.kind === "none") return "Not a measurable target: no number or direction";
  if (s.period_target === null) return "Not a measurable target: no period given";
  if (s.scope === "segment") return `Segment target (${s.segment}); FINN has company-level figures only`;
  if (!MEASURABLE.has(s.metric)) return unmeasurableReason(s.metric, s.metric_label);
  if (s.metric.endsWith("_margin") && s.target.kind !== "direction" && s.unit !== "pct") return "Margin target not stated in percent";
  return null;
}

/** The comparison for a finished period. */
function judge(s: GuidanceStatement, ctx: VerdictContext): Outcome {
  const p = s.period_target!;
  const name = metricName(s.metric, s.metric_label);
  const reported = ctx.actuals.reported(s.metric, p);
  const standard = ctx.actuals.standard(s.metric, p);
  const actual = reported ?? standard;
  if (actual === null) return { verdict: "not_measurable", reason: `No ${name} figure for ${periodLabel(p)} in FINN's data yet` };

  const unit = s.metric.endsWith("_margin") || s.metric.endsWith("_growth") ? "pct" : s.unit;
  const up = higherIsBetter(s.metric);
  let threshold: number;
  let met: boolean;
  let detail = "";
  if (s.target.kind === "range" || s.target.kind === "point") {
    const low = s.target.kind === "range" ? s.target.low : s.target.value;
    const high = s.target.kind === "range" ? s.target.high : s.target.value;
    threshold = up ? low : high;
    const tol = tolerance(s.metric, threshold);
    const short = up ? threshold - actual : actual - threshold;
    met = short <= tol.value + 1e-9;
    if (met && short > 1e-9) detail = ` (within ${tol.text} of the target)`;
    else if (s.target.kind === "range" && (up ? actual > high : actual < low)) detail = up ? " (above the range)" : " (below the range)";
  } else {
    if (s.target.kind !== "direction") return { verdict: "not_measurable", reason: "Not a measurable target: no number or direction" };
    // Direction: compared with the same period a year earlier.
    const base = ctx.actuals.reported(s.metric, priorYear(p)) ?? ctx.actuals.standard(s.metric, priorYear(p));
    if (base === null) return { verdict: "not_measurable", reason: `No ${name} figure for ${periodLabel(priorYear(p))} to compare with` };
    threshold = base;
    const tol = tolerance(s.metric, base);
    const d = s.target.direction;
    met = d === "up" ? actual >= base - tol.value : d === "down" ? actual <= base + tol.value : Math.abs(actual - base) <= tol.value;
    detail = ` (vs ${fmtValue(base, unit)} in ${periodLabel(priorYear(p))})`;
  }

  let reason = `Guided ${fmtTarget(s.target, unit)}, delivered ${fmtValue(actual, unit)}${detail}`;
  if (reported !== null) {
    reason += " as reported by the company";
    if (standard !== null && Math.abs(standard - reported) > tolerance(s.metric, reported).value) {
      reason += `; ${fmtValue(standard, unit)} on FINN's standard ${name}`;
    }
  }
  return { verdict: met ? "met" : "missed", reason };
}

function pace(s: GuidanceStatement, ctx: VerdictContext): Outcome {
  const p = s.period_target!;
  const latest = ctx.actuals.latestQuarter();
  const all = periodQuarters(p);
  const done = latest ? all.filter((q) => quarterOrdinal(q) <= quarterOrdinal(latest)) : [];
  const unit = s.metric.endsWith("_margin") || s.metric.endsWith("_growth") ? "pct" : s.unit;
  const name = metricName(s.metric, s.metric_label);
  const reason = `${periodLabel(p)} not over: ${done.length} of ${all.length} quarter${all.length > 1 ? "s" : ""} reported`;

  if (done.length === 0) {
    const last = latest ? ctx.actuals.standard(s.metric, latest, [latest]) : null;
    return {
      verdict: "too_early",
      reason,
      pace_note: last !== null
        ? `No quarter of ${periodLabel(p)} reported yet; ${periodLabel(latest!)} ${name} ${fmtValue(last, unit)}`
        : `No quarter of ${periodLabel(p)} reported yet`,
    };
  }
  const soFar = ctx.actuals.standard(s.metric, p, done);
  if (soFar === null) return { verdict: "too_early", reason, pace_note: `No ${name} figure yet for ${partialLabel(done)}` };
  let note = `${partialLabel(done)} ${name} ${fmtValue(soFar, unit)} vs ${periodLabel(p)} target ${fmtTarget(s.target, unit)}`;
  if (unit === "inr_cr" && (s.target.kind === "point" || s.target.kind === "range")) {
    const t = s.target.kind === "point" ? s.target.value : s.target.low;
    note = `${partialLabel(done)} ${name} ${fmtValue(soFar, unit)}, ${Math.round((soFar / t) * 100)}% of the ${periodLabel(p)} target of ${fmtTarget(s.target, unit)} with ${done.length} of ${all.length} quarters reported`;
  }
  return { verdict: "too_early", reason, pace_note: note };
}

function evaluate(latest: GuidanceStatement, ctx: VerdictContext): Outcome {
  const nm = notMeasurable(latest);
  if (nm) return { verdict: "not_measurable", reason: nm };

  const p = latest.period_target!;
  const latestQ = ctx.actuals.latestQuarter();
  const finished = latestQ !== null && quarterOrdinal(latestQ) >= quarterOrdinal(lastQuarter(p));
  if (finished) return judge(latest, ctx);

  // Later calls held before the period ends, none of which mentioned this target again.
  const end = quarterOrdinal(lastQuarter(p));
  const made = quarterOrdinal(latest.call_period);
  const silent = [...new Set(ctx.calls)].filter((c) => quarterOrdinal(c) > made && quarterOrdinal(c) < end);
  if (silent.length >= 2) {
    return {
      verdict: "not_mentioned_since",
      reason: `Not mentioned since the ${periodLabel(latest.call_period)} call (${silent.length} calls since)`,
      last_mentioned_in: latest.call_period,
    };
  }
  return pace(latest, ctx);
}

/** One verdict per statement. */
export function computeVerdicts(statements: GuidanceStatement[], ctx: VerdictContext): Verdict[] {
  const threads = new Map<string, GuidanceStatement[]>();
  for (const s of statements) threads.set(threadKey(s), [...(threads.get(threadKey(s)) ?? []), s]);

  const out: Verdict[] = [];
  for (const thread of threads.values()) {
    thread.sort((a, b) => quarterOrdinal(a.call_period) - quarterOrdinal(b.call_period) || a.page - b.page);
    const latest = thread.at(-1)!;
    const o = evaluate(latest, ctx);
    for (const s of thread) {
      const laterDifferent = thread.find((n) => quarterOrdinal(n.call_period) > quarterOrdinal(s.call_period) && !sameTarget(n.target, s.target));
      const v = laterDifferent
        ? {
            verdict: "revised" as const,
            reason: `Target revised from ${fmtTarget(s.target, s.unit)} to ${fmtTarget(laterDifferent.target, laterDifferent.unit)} (${periodLabel(laterDifferent.call_period)} call)`,
            superseded_by_statement_id: laterDifferent.id,
          }
        : { ...o, superseded_by_statement_id: null };
      out.push(
        Verdict.parse({
          statement_id: s.id,
          verdict: v.verdict,
          reason: withHedge(v.reason, s).slice(0, 500),
          pace_note: "pace_note" in v ? (v.pace_note ?? null) : null,
          last_mentioned_in: "last_mentioned_in" in v ? (v.last_mentioned_in ?? null) : null,
          superseded_by_statement_id: v.superseded_by_statement_id,
          as_of: ctx.as_of,
          rule_version: RULE_VERSION,
        }),
      );
    }
  }
  return out;
}

/** "Met X of Y targets that are due": one count per target (latest statement), Met and Missed only. */
export function credibilityLine(statements: GuidanceStatement[], verdicts: Verdict[]): { met: number; due: number; line: string } {
  const byId = new Map(verdicts.map((v) => [v.statement_id, v]));
  const latest = new Map<string, GuidanceStatement>();
  for (const s of statements) {
    const k = threadKey(s);
    const cur = latest.get(k);
    if (!cur || quarterOrdinal(s.call_period) > quarterOrdinal(cur.call_period)) latest.set(k, s);
  }
  let met = 0;
  let due = 0;
  for (const s of latest.values()) {
    const v = byId.get(s.id)?.verdict;
    if (!v || !(CREDIBILITY_VERDICTS as readonly string[]).includes(v)) continue;
    due++;
    if (v === "met") met++;
  }
  return { met, due, line: due === 0 ? "No targets due yet" : `Met ${met} of ${due} target${due === 1 ? "" : "s"} that ${due === 1 ? "is" : "are"} due` };
}
