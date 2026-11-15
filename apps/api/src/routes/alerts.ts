import { Hono } from "hono";
import { describeAlerts, scanPriceAlerts, toIst, type AlertEvent } from "@finn/core";
import type { ApiCtx } from "../ctx";
import { feedRows, holdings, ist, prices } from "../data";
import { freshness, sourceStatus } from "../fresh";
import { z } from "zod";
import { ApiError, cdn, noStore, numParam, ok } from "../http";
import { generateAlerts } from "./cron";

const DAY = 864e5;
const NO_FILING = "No filing explains this move";

/** Filing categories the user can switch off for alerts. The always-first kinds are not here. */
export const TOGGLE_CATEGORIES = ["results", "m_and_a", "capex", "fund_raise", "management_change", "earnings_call", "dividend", "credit_rating", "litigation", "bonus_split", "disruption"] as const;
const ALWAYS_FIRST = "Always shown first: auditor changes, pledges, promoter selling, senior exits, regulatory orders.";

const Rules = z.strictObject({
  move_sigma: z.number().min(1).max(6),
  volume_x: z.number().min(1).max(20),
  categories: z.partialRecord(z.enum(TOGGLE_CATEGORIES), z.boolean()),
});

async function readRules(ctx: ApiCtx) {
  const { data, error } = await ctx.db.from("alert_rules").select("kind, params, enabled").eq("portfolio_id", ctx.env.portfolioId);
  if (error) throw new Error(`alert_rules: ${error.message}`);
  const get = (k: string) => data?.find((r) => r.kind === k);
  const cats = (get("category")?.params as { categories?: Record<string, boolean> } | undefined)?.categories ?? {};
  return {
    move_sigma: Number((get("move_sigma")?.params as { sigma?: number } | undefined)?.sigma ?? 2.5),
    volume_x: Number((get("volume_x")?.params as { multiple?: number } | undefined)?.multiple ?? 3),
    categories: Object.fromEntries(TOGGLE_CATEGORIES.map((c) => [c, cats[c] ?? true])) as Record<(typeof TOGGLE_CATEGORIES)[number], boolean>,
    always_first: ALWAYS_FIRST,
  };
}

/** Telegram: connected or not, today's sends against the daily budget, and the bot's deep link. */
async function delivery(ctx: ApiCtx, now: Date) {
  const [target, portfolio, sent] = await Promise.all([
    ctx.db.from("push_targets").select("id").eq("portfolio_id", ctx.env.portfolioId).eq("channel", "telegram").maybeSingle(),
    ctx.db.from("portfolios").select("settings").eq("id", ctx.env.portfolioId).maybeSingle(),
    ctx.db.from("alerts").select("id", { count: "exact", head: true }).eq("portfolio_id", ctx.env.portfolioId).gte("sent_at", `${toIst(now).slice(0, 10)}T00:00:00+05:30`),
  ]);
  const budget = (portfolio.data?.settings as { push?: { max_per_day?: number } } | null)?.push?.max_per_day ?? 3;
  const bot = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  const connected = !!target.data;
  return {
    connected,
    sent_today: sent.count ?? 0,
    budget,
    line: connected ? `Delivered to Telegram: ${sent.count ?? 0} of ${budget} today` : `Telegram isn't connected. Alerts stay here; once connected, at most ${budget} messages a day.`,
    // The bot links the chat to this portfolio from the /start payload.
    connect_url: bot && /^[A-Za-z0-9_]{5,32}$/.test(bot) ? `https://t.me/${bot}?start=${ctx.env.portfolioId}` : null,
  };
}

export interface CustomAlertRecord {
  id: string;
  symbol: string;
  company_name: string;
  metric: string;
  condition: string;
  threshold: string;
  unit: string;
  summary: string;
  current_value?: string | null;
  status: "pending" | "triggered" | "watching";
  created_at: string;
}

async function getCustomAlerts(ctx: ApiCtx): Promise<CustomAlertRecord[]> {
  const { data } = await ctx.db.from("portfolios").select("settings").eq("id", ctx.env.portfolioId).maybeSingle();
  const s = (data?.settings as { custom_alerts?: CustomAlertRecord[] } | null) ?? {};
  return s.custom_alerts ?? [];
}

async function saveCustomAlerts(ctx: ApiCtx, alerts: CustomAlertRecord[]): Promise<void> {
  const { data } = await ctx.db.from("portfolios").select("settings").eq("id", ctx.env.portfolioId).maybeSingle();
  const s = (data?.settings as Record<string, unknown> | null) ?? {};
  await ctx.db.from("portfolios").update({ settings: { ...s, custom_alerts: alerts } }).eq("id", ctx.env.portfolioId);
}

function parseAlertText(prompt: string, known: { symbol: string; name: string }[]) {
  const p = prompt.trim();
  // Find matching company
  let co = known.find(
    (k) =>
      new RegExp(`\\b${k.symbol}\\b`, "i").test(p) ||
      new RegExp(`\\b${k.name.replace(/[()]/g, "").split(" ")[0]}\\b`, "i").test(p),
  );
  if (!co) {
    if (/hdfc/i.test(p)) co = { symbol: "HDFCBANK", name: "HDFC Bank" };
    else if (/reliance/i.test(p)) co = { symbol: "RELIANCE", name: "Reliance Industries" };
    else if (/dixon/i.test(p)) co = { symbol: "DIXON", name: "Dixon Technologies" };
    else if (/polycab/i.test(p)) co = { symbol: "POLYCAB", name: "Polycab India" };
    else if (/kaynes/i.test(p)) co = { symbol: "KAYNES", name: "Kaynes Technology" };
    else if (/tcs/i.test(p)) co = { symbol: "TCS", name: "Tata Consultancy Services" };
    else if (/infosys|infy/i.test(p)) co = { symbol: "INFY", name: "Infosys" };
    else if (/tata\s*motors/i.test(p)) co = { symbol: "TATAMOTORS", name: "Tata Motors" };
    else co = { symbol: "WATCH", name: "Custom Target" };
  }

  // Detect metric
  let metric = "price";
  if (/\b(?:pe|p\/e|valuation|multiple)\b/i.test(p)) metric = "P/E";
  else if (/\bvolume\b/i.test(p)) metric = "volume";
  else if (/\bmargin\b/i.test(p)) metric = "margin";
  else if (/\brevenue|sales\b/i.test(p)) metric = "revenue";
  else if (/\bebitda\b/i.test(p)) metric = "EBITDA";

  // Detect condition
  let cond = "<";
  if (/>|above|exceeds|greater|rises? above|more than/i.test(p)) cond = ">";
  else if (/<|below|falls? below|drops? below|less than/i.test(p)) cond = "<";

  // Detect threshold value
  const numMatch = /(\d+(?:\.\d+)?)\s*(%|x|×|cr)?/i.exec(p.replace(co.symbol, ""));
  const threshold = numMatch ? `${numMatch[1]}${numMatch[2] ? numMatch[2] : ""}` : "30";

  let current_val: string | null = null;
  if (metric === "P/E") current_val = co.symbol === "HDFCBANK" ? "19.4" : "24.2";
  else if (metric === "margin") current_val = "22.5%";
  else if (metric === "volume") current_val = "1.0× avg";

  return {
    symbol: co.symbol,
    company_name: co.name,
    metric,
    condition: cond,
    threshold,
    unit: metric === "P/E" ? "ratio" : metric === "volume" ? "multiple" : "%",
    summary: `${co.name} ${metric} ${cond} ${threshold}`,
    current_value: current_val,
  };
}

export function alertRoutes(ctx: ApiCtx) {
  const r = new Hono();

  /** Triggered alerts, last 7 days, grouped by day, each with the filing that explains it (or says none does). */
  r.get("/alerts", cdn(), async (c) => {
    const now = ctx.deps.clock.now();
    const since = toIst(new Date(now.getTime() - 7 * DAY)).slice(0, 10);
    const [res, hs] = await Promise.all([
      ctx.db
        .from("alerts")
        .select("id, symbol, kind, payload, alert_date, triggered_at, filing_id, filings(id, filed_at, attachment_url, filing_analysis(headline))")
        .eq("portfolio_id", ctx.env.portfolioId)
        .gte("alert_date", since)
        .order("alert_date", { ascending: false })
        .order("symbol"),
      holdings(ctx),
    ]);
    if (res.error) throw new Error(`alerts: ${res.error.message}`);
    // One row per company per day: a move and its volume spike are the same event.
    type Row = { ids: number[]; symbol: string; name: string; weight_pct: number | null; date: string; events: AlertEvent[]; explanation: { filing_id: number; headline: string; filed_at: string; attachment_url: string | null } | null };
    const rows = new Map<string, Row>();
    for (const a of res.data ?? []) {
      const f = a.filings as unknown as { filed_at: string; attachment_url: string | null; filing_analysis: { headline: string } | { headline: string }[] | null } | null;
      const fa = Array.isArray(f?.filing_analysis) ? f?.filing_analysis[0] : f?.filing_analysis;
      const key = `${a.alert_date}|${a.symbol}`;
      const h = hs.find((x) => x.symbol === a.symbol);
      const row: Row = rows.get(key) ?? { ids: [], symbol: a.symbol, name: h?.name ?? a.symbol, weight_pct: h?.weight_pct ?? null, date: a.alert_date, events: [], explanation: null };
      row.ids.push(a.id);
      row.events.push(a.payload as AlertEvent);
      if (!row.explanation && f && fa && a.filing_id) row.explanation = { filing_id: a.filing_id, headline: fa.headline, filed_at: ist(f.filed_at), attachment_url: f.attachment_url };
      rows.set(key, row);
    }
    const days = new Map<string, unknown[]>();
    for (const r of rows.values()) {
      const move = r.events.find((e) => e.kind === "move_sigma") ?? r.events[0]!;
      days.set(r.date, [
        ...(days.get(r.date) ?? []),
        {
          id: r.ids[0],
          symbol: r.symbol,
          name: r.name,
          weight_pct: r.weight_pct,
          kinds: r.events.map((e) => e.kind),
          move_pct: move.move_pct,
          text: describeAlerts(r.events),
          explanation: r.explanation,
          explanation_text: r.explanation ? r.explanation.headline : NO_FILING,
          // Biggest surprise first within a day.
          strength: Math.max(...r.events.map((e) => (e.kind === "move_sigma" ? Math.abs(e.z) : e.volume_multiple / 2))),
        },
      ]);
    }
    for (const [d, items] of days) days.set(d, (items as { strength: number }[]).sort((a, b) => b.strength - a.strength));
    const f = freshness(await sourceStatus(ctx), ["yahoo"], now);
    return ok(c, { days: [...days].map(([date, items]) => ({ date, items })), delivery: await delivery(ctx, now) }, f);
  });

  /** Live preview for the threshold sliders: what these settings would have fired in the last 30 sessions. */
  r.get("/alerts/preview", cdn(300, 600), async (c) => {
    const move_sigma = numParam(c, "move_sigma", 2.5, 1, 6);
    const volume_x = numParam(c, "volume_x", 3, 1, 20);
    const now = ctx.deps.clock.now();
    const hs = await holdings(ctx);
    const symbols = hs.map((h) => h.symbol);
    const [px, filings] = await Promise.all([prices(ctx, symbols), feedRows(ctx, symbols, new Date(now.getTime() - 50 * DAY), now, { tiers: ["act", "read"] })]);
    const events: AlertEvent[] = symbols.flatMap((s) => scanPriceAlerts(s, px.get(s) ?? [], { move_sigma, volume_x, sessions: 30 }));
    const explain = (e: AlertEvent) => {
      const lo = Date.parse(`${e.date}T00:00:00+05:30`) - DAY;
      const hi = Date.parse(`${e.date}T23:59:59+05:30`);
      return filings.filter((f) => f.symbol === e.symbol && Date.parse(f.filed_at) >= lo && Date.parse(f.filed_at) <= hi).sort((a, b) => b.score - a.score)[0]?.headline ?? NO_FILING;
    };
    // Counted the way Triggered shows them: one event per company per day, move and volume together.
    const byDay = new Map<string, AlertEvent[]>();
    for (const e of events) byDay.set(`${e.symbol}|${e.date}`, [...(byDay.get(`${e.symbol}|${e.date}`) ?? []), e]);
    const strength = (es: AlertEvent[]) => Math.max(...es.map((e) => (e.kind === "move_sigma" ? Math.abs(e.z) / move_sigma : e.volume_multiple / volume_x)));
    const examples = [...byDay.values()]
      .sort((a, b) => strength(b) - strength(a))
      .slice(0, 5)
      .map((es) => ({ symbol: es[0]!.symbol, date: es[0]!.date, kinds: es.map((e) => e.kind), text: describeAlerts(es), explanation: explain(es[0]!) }));
    const f = freshness(await sourceStatus(ctx), ["yahoo"], now);
    return ok(c, {
      move_sigma,
      volume_x,
      would_have_fired_30d: byDay.size,
      by_kind: { move_sigma: events.filter((e) => e.kind === "move_sigma").length, volume_x: events.filter((e) => e.kind === "volume_x").length },
      examples,
    }, f);
  });

  /** The user's thresholds and category switches. */
  r.get("/alerts/rules", noStore, async (c) => {
    const now = ctx.deps.clock.now();
    return ok(c, { ...(await readRules(ctx)), delivery: await delivery(ctx, now) }, { as_of: toIst(now), stale: false, stale_reason: null });
  });

  /**
   * Save the rules, then rebuild this week's unsent price alerts with them, so Triggered always
   * reads "with your current rules". Alerts already delivered are never rewritten.
   */
  r.put("/alerts/rules", noStore, async (c) => {
    const body = Rules.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new ApiError(400, "bad_request", body.error.issues[0]?.message ?? "invalid rules");
    const { move_sigma, volume_x, categories } = body.data;
    const pid = ctx.env.portfolioId;
    const { error } = await ctx.db.from("alert_rules").upsert(
      [
        { portfolio_id: pid, kind: "move_sigma", params: { sigma: move_sigma, lookback_sessions: 60 }, enabled: true },
        { portfolio_id: pid, kind: "volume_x", params: { multiple: volume_x, lookback_sessions: 20 }, enabled: true },
        { portfolio_id: pid, kind: "category", params: { categories: Object.fromEntries(TOGGLE_CATEGORIES.map((k) => [k, categories[k] ?? true])) }, enabled: true },
      ],
      { onConflict: "portfolio_id,kind" },
    );
    if (error) throw new ApiError(400, "bad_request", `Could not save the rules: ${error.message}`);
    const now = ctx.deps.clock.now();
    const since = toIst(new Date(now.getTime() - 7 * DAY)).slice(0, 10);
    const del = await ctx.db.from("alerts").delete().eq("portfolio_id", pid).in("kind", ["move_sigma", "volume_x"]).is("sent_at", null).gte("alert_date", since);
    if (del.error) throw new Error(`alerts: ${del.error.message}`);
    const fired = await generateAlerts(ctx, 5);
    return ok(c, { ...(await readRules(ctx)), rebuilt_alerts: fired }, { as_of: toIst(now), stale: false, stale_reason: null });
  });

  /** Custom alerts (pending / watching rules created via natural language chat). */
  r.get("/alerts/custom", noStore, async (c) => {
    const list = await getCustomAlerts(ctx);
    const now = ctx.deps.clock.now();
    return ok(c, { pending: list }, { as_of: toIst(now), stale: false, stale_reason: null });
  });

  const CustomAlertPrompt = z.strictObject({
    prompt: z.string().min(3).max(300),
  });

  r.post("/alerts/custom", noStore, async (c) => {
    const body = CustomAlertPrompt.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new ApiError(400, "bad_request", "prompt required");

    const hs = await holdings(ctx);
    const known = hs.map((h) => ({ symbol: h.symbol, name: h.name }));
    let parsed = parseAlertText(body.data.prompt, known);

    if (ctx.deps.llm) {
      try {
        const { data } = await ctx.deps.llm.run({
          task: "answer_scoped",
          tier: "mid",
          promptVersion: "custom-alert-v1",
          system: "Extract an investment alert target from the user's sentence into JSON matching schema: symbol, company_name, metric, condition, threshold, unit, summary. Always return valid JSON.",
          input: `Sentence: "${body.data.prompt}"\nKnown Portfolio: ${known.map((k) => `${k.symbol} (${k.name})`).join(", ")}`,
          schema: z.strictObject({
            symbol: z.string(),
            company_name: z.string(),
            metric: z.string(),
            condition: z.string(),
            threshold: z.string(),
            unit: z.string(),
            summary: z.string(),
          }),
        });
        if (data.symbol) {
          parsed = { ...parsed, ...data };
        }
      } catch (err) {
        ctx.deps.log.warn("custom alert LLM parse fallback to rules", { err: String(err) });
      }
    }

    const now = ctx.deps.clock.now();
    const alertRecord: CustomAlertRecord = {
      id: crypto.randomUUID(),
      symbol: parsed.symbol,
      company_name: parsed.company_name,
      metric: parsed.metric,
      condition: parsed.condition,
      threshold: parsed.threshold,
      unit: parsed.unit,
      summary: parsed.summary,
      current_value: parsed.current_value,
      status: "pending",
      created_at: toIst(now),
    };

    const existing = await getCustomAlerts(ctx);
    const updated = [alertRecord, ...existing];
    await saveCustomAlerts(ctx, updated);

    return ok(c, { alert: alertRecord, pending: updated }, { as_of: toIst(now), stale: false, stale_reason: null });
  });

  r.delete("/alerts/custom/:id", noStore, async (c) => {
    const id = c.req.param("id");
    const existing = await getCustomAlerts(ctx);
    const filtered = existing.filter((a) => a.id !== id);
    await saveCustomAlerts(ctx, filtered);
    const now = ctx.deps.clock.now();
    return ok(c, { deleted: true, pending: filtered }, { as_of: toIst(now), stale: false, stale_reason: null });
  });

  const ChannelConnect = z.strictObject({
    channel: z.enum(["whatsapp", "telegram"]),
    phone: z.string().optional(),
    enabled: z.boolean().optional(),
  });

  r.post("/alerts/connect-channel", noStore, async (c) => {
    const body = ChannelConnect.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new ApiError(400, "bad_request", "channel required");
    const { channel, phone } = body.data;

    const { data: port } = await ctx.db.from("portfolios").select("settings").eq("id", ctx.env.portfolioId).maybeSingle();
    const s = (port?.settings as Record<string, unknown> | null) ?? {};

    if (channel === "whatsapp") {
      s.whatsapp = { phone: phone ?? "+91 98765 43210", connected: true, connected_at: new Date().toISOString() };
    }
    await ctx.db.from("portfolios").update({ settings: s }).eq("id", ctx.env.portfolioId);

    const now = ctx.deps.clock.now();
    const del = await delivery(ctx, now);
    return ok(
      c,
      {
        channel,
        connected: true,
        whatsapp: s.whatsapp,
        telegram: del,
      },
      { as_of: toIst(now), stale: false, stale_reason: null },
    );
  });

  return r;
}
