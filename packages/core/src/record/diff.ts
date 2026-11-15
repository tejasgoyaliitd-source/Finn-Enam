import type { GuidanceStatement, GuidanceTarget } from "@finn/shared";
import { metricName } from "./metrics";
import { lastQuarter, periodLabel, quarterOrdinal } from "./periods";
import { fmtTarget, threadKey } from "./verdict";

export type DiffStatus = "new" | "unchanged" | "raised" | "lowered" | "changed" | "dropped";

export interface DiffItem {
  key: string;
  metric: string;
  metric_label: string;
  period_target: string | null;
  scope: "company" | "segment";
  segment: string | null;
  status: DiffStatus;
  from: string | null;
  to: string | null;
  /** The statement on the new call (or, for "dropped", the old one). */
  quote: string;
  page: number;
  call_period: string;
}

export interface ConcallCard {
  symbol: string;
  call_period: string;
  previous_call: string | null;
  items: DiffItem[];
  credibility: string;
}

const mid = (t: GuidanceTarget) => (t.kind === "range" ? (t.low + t.high) / 2 : t.kind === "point" ? t.value : null);
const bounds = (t: GuidanceTarget) => (t.kind === "range" ? [t.low, t.high] : t.kind === "point" ? [t.value, t.value] : null);

export function compareTargets(a: GuidanceTarget, b: GuidanceTarget): Exclude<DiffStatus, "new" | "dropped"> {
  if (JSON.stringify(a) === JSON.stringify(b)) return "unchanged";
  const [ba, bb] = [bounds(a), bounds(b)];
  if (ba && bb) {
    if (bb[0]! >= ba[0]! && bb[1]! >= ba[1]!) return "raised";
    if (bb[0]! <= ba[0]! && bb[1]! <= ba[1]!) return "lowered";
    const d = mid(b)! - mid(a)!;
    return d > 0 ? "raised" : d < 0 ? "lowered" : "changed"; // narrowed or widened around the same midpoint
  }
  return "changed";
}

/**
 * Statement-by-statement diff of a new call against the previous one. A target missing from the
 * new call is "dropped" only while its period is still open; one whose period has ended is simply
 * no longer discussed.
 */
export function diffCalls(prev: GuidanceStatement[], curr: GuidanceStatement[], currCall: string): DiffItem[] {
  const latestBy = (xs: GuidanceStatement[]) => {
    const m = new Map<string, GuidanceStatement>();
    for (const s of [...xs].sort((a, b) => a.page - b.page)) if (!m.has(threadKey(s))) m.set(threadKey(s), s);
    return m;
  };
  const p = latestBy(prev);
  const c = latestBy(curr);
  const item = (s: GuidanceStatement, status: DiffStatus, from: GuidanceStatement | null, to: GuidanceStatement | null): DiffItem => ({
    key: threadKey(s),
    metric: s.metric,
    metric_label: metricName(s.metric, s.metric_label),
    period_target: s.period_target,
    scope: s.scope,
    segment: s.segment,
    status,
    from: from ? fmtTarget(from.target, from.unit) : null,
    to: to ? fmtTarget(to.target, to.unit) : null,
    quote: s.quote,
    page: s.page,
    call_period: s.call_period,
  });

  const out: DiffItem[] = [];
  for (const [k, s] of c) {
    const before = p.get(k);
    out.push(before ? item(s, compareTargets(before.target, s.target), before, s) : item(s, "new", null, s));
  }
  for (const [k, s] of p) {
    if (c.has(k)) continue;
    const open = s.period_target === null || quarterOrdinal(lastQuarter(s.period_target)) >= quarterOrdinal(currCall);
    if (open) out.push(item(s, "dropped", s, null));
  }
  const order: Record<DiffStatus, number> = { lowered: 0, dropped: 1, raised: 2, changed: 3, new: 4, unchanged: 5 };
  return out.sort((a, b) => order[a.status] - order[b.status]);
}

export const describeItem = (i: DiffItem) =>
  ({
    new: `New: ${i.metric_label}${i.period_target ? ` ${periodLabel(i.period_target)}` : ""} ${i.to}`,
    unchanged: `Unchanged: ${i.metric_label} ${i.to}`,
    raised: `Raised: ${i.metric_label} ${i.from} → ${i.to}`,
    lowered: `Lowered: ${i.metric_label} ${i.from} → ${i.to}`,
    changed: `Changed: ${i.metric_label} ${i.from} → ${i.to}`,
    dropped: `Dropped: ${i.metric_label}${i.period_target ? ` ${periodLabel(i.period_target)}` : ""} (was ${i.from})`,
  })[i.status];
