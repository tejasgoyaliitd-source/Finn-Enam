import { toIst } from "@finn/core";
import type { SourceHealth } from "@finn/shared";
import type { ApiCtx } from "./ctx";
import type { Freshness } from "./http";

/** How old a source's last success may be before it counts as degraded. */
const MAX_AGE_H: Record<"yahoo" | "nse" | "bse" | "screener", number> = {
  yahoo: 96, // prices land after the close; covers a weekend
  nse: 30,
  bse: 30,
  screener: 24 * 10,
};
const LABEL = { yahoo: "Prices", nse: "NSE announcements", bse: "BSE announcements", screener: "Screener financials" } as const;
type Source = keyof typeof MAX_AGE_H;

export interface SourceStatus extends SourceHealth {
  last_run_at: string | null;
  last_status: string | null;
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/** Latest run and latest success per source, from ingest_runs. */
export async function sourceStatus(ctx: ApiCtx): Promise<SourceStatus[]> {
  const { data, error } = await ctx.db
    .from("ingest_runs")
    .select("source, status, started_at, finished_at, error")
    .in("source", Object.keys(MAX_AGE_H))
    .order("started_at", { ascending: false })
    .limit(400);
  if (error) throw new Error(`ingest_runs: ${error.message}`);
  const now = ctx.deps.clock.now().getTime();
  return (Object.keys(MAX_AGE_H) as Source[]).map((source) => {
    const runs = (data ?? []).filter((r) => r.source === source);
    const last = runs[0];
    const okRun = runs.find((r) => r.status === "ok" || r.status === "partial");
    const lastOk = okRun?.finished_at ?? null;
    const ageH = lastOk ? (now - Date.parse(lastOk)) / 3.6e6 : Infinity;
    const failing = last?.status === "failed";
    const degraded = !lastOk || ageH > MAX_AGE_H[source] || failing;
    const note = !last
      ? `${LABEL[source]}: never run`
      : failing
        ? `${LABEL[source]}: last run failed ${fmtWhen(last.started_at)}${lastOk ? `; last good data ${fmtWhen(lastOk)}` : ""}`
        : ageH > MAX_AGE_H[source]
          ? `${LABEL[source]}: no fresh data since ${fmtWhen(lastOk!)}`
          : `${LABEL[source]}: updated ${fmtWhen(lastOk!)}`;
    return {
      source,
      last_success_at: lastOk ? toIst(new Date(lastOk)) : null,
      degraded,
      note,
      last_run_at: last ? toIst(new Date(last.started_at)) : null,
      last_status: last?.status ?? null,
    };
  });
}

/**
 * as_of = when the data behind a response was last refreshed. "filings" is fresh if either
 * exchange delivered (BSE is the designed fallback when NSE blocks us).
 */
export function freshness(status: SourceStatus[], need: ("yahoo" | "filings" | "screener")[], now: Date): Freshness {
  const get = (s: string) => status.find((x) => x.source === s);
  const picks = need.map((n) => {
    if (n !== "filings") return { name: n, s: get(n) };
    const nse = get("nse");
    const bse = get("bse");
    const best = [nse, bse].filter((x) => x?.last_success_at).sort((a, b) => b!.last_success_at!.localeCompare(a!.last_success_at!))[0];
    return { name: n, s: best ?? nse };
  });
  const times = picks.map((p) => p.s?.last_success_at).filter((t): t is string => Boolean(t));
  const asOf = times.length === picks.length ? times.sort()[0]! : toIst(now);
  // Stale = the newest good data is older than the source allows. A recent failure with good
  // earlier data shows in /health as degraded, but the data itself is not stale yet.
  const stale = picks.filter((p) => !p.s || isOld(p.s, now));
  return {
    as_of: asOf as Freshness["as_of"],
    stale: stale.length > 0,
    stale_reason: stale.length ? stale.map((p) => p.s?.note ?? `${p.name}: no data yet`).join("; ") : null,
  };
}

function isOld(s: SourceStatus, now: Date): boolean {
  if (!s.last_success_at) return true;
  return (now.getTime() - Date.parse(s.last_success_at)) / 3.6e6 > MAX_AGE_H[s.source as Source];
}
