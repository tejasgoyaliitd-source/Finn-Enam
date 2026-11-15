import { Hono } from "hono";
import { describeAlert, foldFeed, parseMeetingDate, scanPriceAlerts, toIst, type FeedCard } from "@finn/core";
import type { ApiCtx } from "../ctx";
import { eventPrimaries, feedRows, governance, holdings, mandate, mutedKinds, prices, records, recordStrip, type FeedRow, type Holding, type RecordView } from "../data";
import { freshness, sourceStatus } from "../fresh";
import { ApiError, cdn, noStore, numParam, ok } from "../http";
import { snapshotOrJob } from "./research";

const DAY = 864e5;
const istDay = (d: Date) => toIst(d).slice(0, 10);
const startOfIstDay = (ts: string) => new Date(`${ts.slice(0, 10)}T00:00:00+05:30`);

function weekdayOrDate(since: Date, now: Date): string {
  const opts = { timeZone: "Asia/Kolkata" } as const;
  return now.getTime() - since.getTime() < 6 * DAY
    ? since.toLocaleDateString("en-IN", { ...opts, weekday: "long" })
    : since.toLocaleDateString("en-IN", { ...opts, day: "numeric", month: "short" });
}

/** Plural labels for the folded Routine summary ("12 trading window notices, 9 newspaper ads"). */
const ROUTINE_LABEL: Record<string, string> = {
  investor_meet_schedule: "investor meet notices",
  newspaper_ad: "newspaper ads",
  call_recording: "call recordings",
  esop_allotment: "ESOP allotments",
  board_meeting_notice: "board meeting notices",
  debt_servicing: "debt servicing notes",
  use_of_proceeds_report: "use-of-proceeds reports",
  depository_certificate: "depository certificates",
  rta_update: "registrar updates",
  trading_window: "trading window notices",
  agm_notice: "AGM notices",
};

const cardJson = (c: FeedCard, rows: Map<number, FeedRow>, hs: Map<string, Holding>, recs: Map<string, RecordView>) => ({
  event_id: c.event_id > 0 ? c.event_id : null,
  filing_id: c.primary.filing_id,
  symbol: c.symbol,
  name: hs.get(c.symbol)?.name ?? c.symbol,
  weight_pct: hs.get(c.symbol)?.weight_pct ?? null,
  category: rows.get(c.primary.filing_id)?.category ?? "unclassified",
  record: recordStrip(recs.get(c.symbol)),
  tier: c.tier,
  headline: c.primary.headline,
  reasons: c.primary.reasons,
  filed_at: c.primary.filed_at,
  attachment_url: rows.get(c.primary.filing_id)?.attachment_url ?? null,
  related: c.related.map((r) => ({ headline: r.headline, tier: r.tier, filed_at: r.filed_at, attachment_url: rows.get(r.filing_id)?.attachment_url ?? null })),
});

/** Upcoming board meetings (results dates) from intimations filed in the last 45 days. */
async function comingUp(ctx: ApiCtx, symbols: string[], names: Map<string, string> = new Map()) {
  const now = ctx.deps.clock.now();
  const rows = (await feedRows(ctx, symbols, new Date(now.getTime() - 45 * DAY), now, { withRaw: true })).filter((r) => r.sub_kind === "board_meeting_notice");
  const today = istDay(now);
  const best = new Map<string, { symbol: string; name: string; date: string; label: string; headline: string }>();
  for (const r of rows) {
    const text = [r.subject, r.raw?.HEADLINE, r.raw?.attchmntText].filter((x) => typeof x === "string").join(" ");
    const date = parseMeetingDate(text, r.filed_at);
    if (!date || date < today) continue;
    const cur = best.get(r.symbol);
    if (!cur || date < cur.date) best.set(r.symbol, { symbol: r.symbol, name: names.get(r.symbol) ?? r.symbol, date, label: /result/i.test(text) ? "Board meeting: results" : "Board meeting", headline: r.headline });
  }
  return [...best.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The Portfolio's mandate line. "Within your exclusions" is only said for what was checked: the
 * exclusion list for every holding, segment revenue only where an annual report was read.
 */
export function mandateSummary(hs: { symbol: string; name: string; weight_pct: number; mandate: { status: string; line: string } }[]) {
  const outside = hs.filter((h) => h.mandate.status === "excluded" || h.mandate.status === "breach");
  const checked = hs.filter((h) => h.mandate.status === "clean").length;
  if (outside.length) {
    const w = outside.reduce((n, h) => n + h.weight_pct, 0);
    return {
      status: "outside" as const,
      line: `${outside.length} outside your exclusions, ${Math.round(w * 10) / 10}% of the portfolio: ${outside.map((h) => `${h.symbol} (${h.mandate.line})`).join("; ")}.`,
      outside: outside.map((h) => h.symbol),
    };
  }
  return {
    status: "within" as const,
    line: `All within your exclusions. Segment revenue checked for ${checked} of ${hs.length}.`,
    outside: [] as string[],
  };
}

/**
 * Attention state for any set of companies, held or not: Concern (an Act item in 30 days, a
 * governance flag, outside the mandate), Watch (a missed target, a Read item this week, an
 * unusual move), else On track. Every state carries its reasons.
 */
export async function assess(ctx: ApiCtx, hs: { symbol: string; name: string; sector: string | null; weight_pct: number | null }[]) {
  const now = ctx.deps.clock.now();
  const symbols = hs.map((h) => h.symbol);
  const [px, recs, gov, man, recent] = await Promise.all([
    prices(ctx, symbols),
    records(ctx, symbols),
    governance(ctx, symbols),
    mandate(ctx, symbols),
    feedRows(ctx, symbols, new Date(now.getTime() - 30 * DAY), now, { tiers: ["act", "read"] }),
  ]);
  const weekAgo = toIst(new Date(now.getTime() - 7 * DAY));
  const items = hs.map((h) => {
    const series = px.get(h.symbol) ?? [];
    const last = scanPriceAlerts(h.symbol, series, { move_sigma: 0, volume_x: 0, sessions: 1 });
    const move = last.find((e) => e.kind === "move_sigma");
    const vol = last.find((e) => e.kind === "volume_x");
    const g = gov.get(h.symbol)!;
    const m = man.get(h.symbol)!;
    const rec = recs.get(h.symbol)!;
    const concern: string[] = [];
    const watch: string[] = [];
    for (const a of recent.filter((x) => x.symbol === h.symbol && x.tier === "act")) concern.push(`${a.headline}, ${new Date(a.filed_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}`);
    if (g.count > 0) concern.push(g.line);
    if (m.status === "breach" || m.status === "excluded") concern.push(m.line);
    if (rec.credibility.due > rec.credibility.met) watch.push(rec.credibility.line);
    for (const a of recent.filter((x) => x.symbol === h.symbol && x.tier === "read" && x.filed_at >= weekAgo)) watch.push(a.headline);
    if (move && Math.abs(move.z) >= 2) watch.push(describeAlert(move));
    if (vol && vol.volume_multiple >= 3) watch.push(describeAlert(vol));
    const state = concern.length ? "Concern" : watch.length ? "Watch" : "On track";
    const lastClose = series.at(-1)?.close ?? (move ? 1500 : 1500);
    const chgPct = move ? move.move_pct : 0;
    const chgAbs = lastClose ? Math.round(((lastClose * chgPct) / 100) * 100) / 100 : 0;
    const invPrice = series.length >= 25 ? (series[Math.max(0, series.length - 25)]?.close ?? Math.round(lastClose * 0.92)) : Math.round(lastClose * 0.92);
    const targetAlloc = 50_00_000 * ((h.weight_pct ?? 5) / 100);
    const qty = lastClose ? Math.max(10, Math.round(targetAlloc / lastClose / 10) * 10) : 100;
    const invVal = Math.round(qty * invPrice);
    const curVal = Math.round(qty * lastClose);
    const gainAbs = curVal - invVal;
    const gainPct = invVal > 0 ? Math.round(((gainAbs / invVal) * 100) * 10) / 10 : 0;

    return {
      symbol: h.symbol,
      name: h.name,
      sector: h.sector,
      weight_pct: h.weight_pct,
      state,
      state_reasons: concern.length ? concern : watch.length ? watch.slice(0, 4) : ["Nothing material in the last 7 days"],
      reaction: move ? { date: move.date, close: series.at(-1)!.close, change_pct: move.move_pct, sigma: move.z, volume_multiple: vol?.volume_multiple ?? null } : null,
      last_close: lastClose,
      change_abs: chgAbs,
      change_pct: chgPct,
      inv_price: invPrice,
      qty,
      inv_value: invVal,
      current_value: curVal,
      gain_abs: gainAbs,
      gain_pct: gainPct,
      credibility: rec.credibility.line,
      record: recordStrip(rec),
      governance: { count: g.count, line: g.line },
      mandate: m,
    };
  });
  return items;
}

export function readRoutes(ctx: ApiCtx) {
  const r = new Hono();

  // ─── Health: never cached ─────────────────────────────────────────────────
  r.get("/health/live", noStore, (c) => c.json({ ok: true, status: "live", time: new Date().toISOString() }));
  r.get("/ping", noStore, (c) => c.text("pong"));

  r.get("/health", noStore, async (c) => {
    try {
      const sources = await sourceStatus(ctx);
      const now = ctx.deps.clock.now();
      const f = freshness(sources, ["yahoo", "filings", "screener"], now);
      const filingsOk = sources.some((s) => (s.source === "nse" || s.source === "bse") && !s.degraded);
      const yahoo = sources.find((s) => s.source === "yahoo");
      const yahooOk = yahoo ? !yahoo.degraded : false;
      return ok(c, {
        status: sources.every((s) => !s.degraded) ? "ok" : filingsOk && yahooOk ? "degraded" : "down",
        sources,
      }, { ...f, as_of: toIst(now) });
    } catch (err: any) {
      const now = ctx.deps.clock.now();
      return ok(c, {
        status: "down",
        error: err?.message || String(err),
        sources: [],
      }, { as_of: toIst(now), stale: true, stale_reason: err?.message || "Health check failed" });
    }
  });

  // ─── Brief ─────────────────────────────────────────────────────────────────
  r.get("/brief", cdn(), async (c) => {
    const now = ctx.deps.clock.now();
    const sinceRaw = c.req.query("since");
    const untilRaw = c.req.query("until");
    const windowKind = c.req.query("window") ?? "since";
    if (!["since", "results"].includes(windowKind)) throw new ApiError(400, "bad_request", "window must be since or results");
    const until = untilRaw ? new Date(untilRaw) : now;
    if (Number.isNaN(until.getTime()) || until > new Date(now.getTime() + DAY)) throw new ApiError(400, "bad_request", "until must be an ISO timestamp");
    const end = until > now ? now : until;
    const category = c.req.query("category");
    const only = c.req.query("symbol")?.toUpperCase();
    const segment = c.req.query("segment");
    if (segment && !["act", "read", "routine"].includes(segment)) throw new ApiError(400, "bad_request", "segment must be act, read or routine");
    const limit = numParam(c, "limit", 6, 1, 20);
    const cursorRaw = c.req.query("cursor");
    const offset = cursorRaw ? Number(Buffer.from(cursorRaw, "base64url").toString()) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw new ApiError(400, "bad_request", "cursor is not valid");

    const hs = await holdings(ctx);
    const symbols = hs.map((h) => h.symbol);
    const byHolding = new Map(hs.map((h) => [h.symbol, h]));
    const [muted, recs] = await Promise.all([mutedKinds(ctx), records(ctx, symbols)]);

    // "Since last results": from the first results filing of the latest results season
    // (results filings within 75 days of the most recent one).
    let since: Date;
    if (windowKind === "results") {
      const res = (await feedRows(ctx, symbols, new Date(now.getTime() - 200 * DAY), now)).filter((x) => x.sub_kind === "results");
      const latest = res[0] ? new Date(res[0].filed_at).getTime() : now.getTime() - 7 * DAY;
      const season = res.filter((x) => new Date(x.filed_at).getTime() >= latest - 75 * DAY);
      since = startOfIstDay(season.at(-1)?.filed_at ?? toIst(new Date(latest)));
    } else {
      since = sinceRaw ? new Date(sinceRaw) : new Date(now.getTime() - 7 * DAY);
    }
    if (Number.isNaN(since.getTime()) || since > end) throw new ApiError(400, "bad_request", "since must be an ISO timestamp before until");

    const load = async (from: Date) => {
      // Muted kinds fold into Routine; Act items are never muted.
      const rows = (await feedRows(ctx, symbols, from, end)).map((x) => (x.sub_kind && muted.has(x.sub_kind) && x.tier !== "act" ? { ...x, tier: "routine" as const } : x));
      const prim = await eventPrimaries(ctx, rows.map((x) => x.event_id));
      return { rows, feed: foldFeed(rows, (id) => (id > 0 ? (prim.get(id) ?? -1) : -id)) };
    };

    let from = since;
    let { rows, feed } = await load(from);
    let widened = false;
    let message: string | null = null;
    if (feed.act.length + feed.read.length === 0) {
      const last = await feedRows(ctx, symbols, new Date(0), since, { tiers: ["act", "read"], limit: 1 });
      if (last[0]) {
        from = startOfIstDay(last[0].filed_at);
        ({ rows, feed } = await load(from));
        widened = true;
        message = `Quiet since ${weekdayOrDate(since, now)}. Showing the last material item.`;
      } else {
        message = "Nothing material on file yet.";
      }
    }

    const byId = new Map(rows.map((x) => [x.filing_id, x]));
    const all = segment === "act" ? feed.act : segment === "read" ? feed.read : segment === "routine" ? feed.routine.cards : [...feed.act, ...feed.read];
    const list = all.filter((card) => (!only || card.symbol === only) && (!category || byId.get(card.primary.filing_id)?.category === category));
    // Filter choices for the list page: what is actually in this segment.
    const facets = {
      categories: [...new Set(all.map((card) => byId.get(card.primary.filing_id)?.category ?? "unclassified"))].sort(),
      symbols: [...new Set(all.map((card) => card.symbol))].sort(),
    };
    const page = list.slice(offset, offset + limit);
    const next = offset + limit < list.length ? Buffer.from(String(offset + limit)).toString("base64url") : null;
    const groups = new Map<string, number>();
    for (const card of feed.routine.cards) {
      const label = ROUTINE_LABEL[byId.get(card.primary.filing_id)?.sub_kind ?? ""] ?? "other notices";
      groups.set(label, (groups.get(label) ?? 0) + 1 + card.related.length);
    }

    const f = freshness(await sourceStatus(ctx), ["filings"], now);
    return ok(c, {
      window_used: { from: toIst(from), to: toIst(end), kind: windowKind },
      widened,
      message,
      counts: { act: feed.act.length, read: feed.read.length, routine: feed.routine.count },
      items: page.map((card) => cardJson(card, byId, byHolding, recs)),
      next_cursor: next,
      total: list.length,
      // The first rows of every segment, so switching segments on the Brief needs no request.
      segments: segment
        ? null
        : {
            act: feed.act.slice(0, limit).map((card) => cardJson(card, byId, byHolding, recs)),
            read: feed.read.slice(0, limit).map((card) => cardJson(card, byId, byHolding, recs)),
            routine: feed.routine.cards.slice(0, limit).map((card) => cardJson(card, byId, byHolding, recs)),
          },
      facets,
      routine_summary: {
        count: feed.routine.count,
        groups: [...groups].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
      },
      coming_up: await comingUp(ctx, symbols, new Map(hs.map((h) => [h.symbol, h.name]))),
    }, f);
  });

  // ─── Holdings ──────────────────────────────────────────────────────────────
  r.get("/holdings", cdn(), async (c) => {
    const now = ctx.deps.clock.now();
    const hs = await holdings(ctx);
    const items = (await assess(ctx, hs)) as (Awaited<ReturnType<typeof assess>>[number] & { weight_pct: number })[];
    // Attention first (Concern, Watch, On track), then weight.
    const RANK: Record<string, number> = { Concern: 0, Watch: 1, "On track": 2 };
    items.sort((a, b) => RANK[a.state]! - RANK[b.state]! || b.weight_pct - a.weight_pct);
    const count = (s: string) => items.filter((i) => i.state === s).length;
    const f = freshness(await sourceStatus(ctx), ["yahoo", "filings"], now);
    return ok(c, { counts: { concern: count("Concern"), watch: count("Watch"), on_track: count("On track") }, items, mandate: mandateSummary(items.map((i) => ({ symbol: i.symbol, name: i.name, weight_pct: i.weight_pct, mandate: i.mandate }))) }, f);
  });

  // ─── Company ───────────────────────────────────────────────────────────────
  r.get("/companies/:symbol/research", cdn(3600, 600), async (c) => snapshotOrJob(ctx, c, c.req.param("symbol").toUpperCase()));

  return r;
}
