import { timingSafeEqual } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { refresh, scanPriceAlerts, describeAlert, toIst } from "@finn/core";
import type { ApiCtx } from "../ctx";
import { feedRows, holdings, prices } from "../data";
import { ApiError, noStore, ok } from "../http";

/** Bearer CRON_SECRET, compared in constant time. With no secret configured, cron is refused. */
export const requireCron =
  (ctx: ApiCtx): MiddlewareHandler =>
  async (c, next) => {
    const secret = ctx.env.cronSecret;
    if (!secret) throw new ApiError(503, "upstream_unavailable", "Cron is disabled: CRON_SECRET is not set");
    const got = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const a = Buffer.from(got);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError(401, "unauthorized", "Missing or wrong cron secret");
    await next();
  };

const DAY = 864e5;

/**
 * Alerts for the latest session, per the portfolio's rules, each paired with a filing that
 * explains it (same company, material, within a day) when there is one.
 */
/** Alerts for the latest session (the daily cron), or the last N sessions for a backfill. */
export async function generateAlerts(ctx: ApiCtx, sessions = 1): Promise<number> {
  const rules = (await ctx.db.from("alert_rules").select("kind, params, enabled").eq("portfolio_id", ctx.env.portfolioId)).data ?? [];
  const p = (kind: string) => rules.find((r) => r.kind === kind && r.enabled)?.params as Record<string, number> | undefined;
  const sigma = p("move_sigma")?.sigma;
  const vx = p("volume_x")?.multiple;
  if (sigma === undefined && vx === undefined) return 0;
  const hs = await holdings(ctx);
  const symbols = hs.map((h) => h.symbol);
  const px = await prices(ctx, symbols);
  const now = ctx.deps.clock.now();
  const filings = await feedRows(ctx, symbols, new Date(now.getTime() - (sessions * 2 + 4) * DAY), now, { tiers: ["act", "read"] });
  const rows = [];
  for (const s of symbols) {
    for (const e of scanPriceAlerts(s, px.get(s) ?? [], { move_sigma: sigma ?? Infinity, volume_x: vx ?? Infinity, sessions })) {
      const lo = Date.parse(`${e.date}T00:00:00+05:30`) - DAY;
      const hi = Date.parse(`${e.date}T23:59:59+05:30`);
      // The strongest filing from the day before through the day itself explains the move.
      const why = filings.filter((f) => f.symbol === s && Date.parse(f.filed_at) >= lo && Date.parse(f.filed_at) <= hi).sort((a, b) => b.score - a.score)[0];
      rows.push({ portfolio_id: ctx.env.portfolioId, symbol: s, kind: e.kind, alert_date: e.date, filing_id: why?.filing_id ?? null, payload: { ...e, text: describeAlert(e) } });
    }
  }
  if (rows.length === 0) return 0;
  const { error } = await ctx.db.from("alerts").upsert(rows, { onConflict: "portfolio_id,symbol,kind,alert_date", ignoreDuplicates: true });
  if (error) throw new Error(`alerts: ${error.message}`);
  return rows.length;
}

export function cronRoutes(ctx: ApiCtx) {
  const r = new Hono();
  r.use("/cron/*", noStore, requireCron(ctx));
  const nowF = () => ({ as_of: toIst(ctx.deps.clock.now()), stale: false, stale_reason: null });

  /** Daily close: prices for every holding, then alerts. Also keeps the Supabase project awake. */
  r.post("/cron/daily", async (c) => {
    const rep = await refresh(ctx.deps, { target: { portfolio: ctx.env.portfolioId }, parts: ["prices"], since: new Date(Date.now() - DAY) });
    const alerts = await generateAlerts(ctx);
    const p = rep.prices;
    return ok(c, { prices: p?.ok ? { status: p.status, rows: p.rows } : { status: "failed", error: p && !p.ok ? (p as any).error : null }, alerts }, nowF(), 202);
  });

  /** Filing poll (external pinger every 20–30 min): last 2 days through the triage pipeline. */
  r.post("/cron/filings", async (c) => {
    const rep = await refresh(ctx.deps, { target: { portfolio: ctx.env.portfolioId }, parts: ["filings"], since: new Date(Date.now() - 2 * DAY) });
    const f = rep.filings;
    return ok(c, {
      nse: f?.nse ? (f.nse.ok ? { status: f.nse.status, rows: f.nse.rows } : { status: "failed", error: (f.nse as any).error }) : null,
      bse: f?.bse ? (f.bse.ok ? { status: f.bse.status, rows: f.bse.rows } : { status: "failed", error: (f.bse as any).error }) : null,
      missed: f?.missed ?? [],
      results_pending: rep.results_pending ?? [],
    }, nowF(), 202);
  });

  /** Morning digest: delivery (Telegram) is not built yet, and this says so instead of pretending. */
  r.post("/cron/digest", async (c) => ok(c, { sent: false, reason: "Telegram delivery is not set up yet" }, nowF(), 202));

  return r;
}
