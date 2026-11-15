import { Hono } from "hono";
import { z } from "zod";
import { toIst } from "@finn/core";
import { WEIGHT_SUM_TOLERANCE_PCT } from "@finn/shared";
import type { ApiCtx } from "../ctx";
import { holdings, houseView, mandate, prices } from "../data";
import { ApiError, cdn, noStore, ok } from "../http";
import { freshness, sourceStatus } from "../fresh";
import { mandateSummary } from "./read";

const Body = z.strictObject({
  holdings: z
    .array(z.strictObject({ symbol: z.string().trim().toUpperCase().pipe(z.string().regex(/^[A-Z0-9&-]{1,20}$/, "Symbols are NSE symbols like DIXON")), weight_pct: z.number().gt(0).max(100) }))
    .min(1, "Add at least one holding")
    .max(60, "At most 60 holdings"),
});

export function portfolioRoutes(ctx: ApiCtx) {
  const r = new Hono();

  /**
   * Replace the holdings. Checked before anything is written: known NSE symbols, no duplicates,
   * weights summing to 100% or less, nothing on the exclusion list. Concentration above the
   * house limit is allowed but said.
   */
  r.put("/holdings", noStore, async (c) => {
    const parsed = Body.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, "bad_request", parsed.error.issues[0]?.message ?? "invalid holdings");
    const hs = parsed.data.holdings.map((h) => ({ symbol: h.symbol, weight_pct: Math.round(h.weight_pct * 100) / 100 }));
    const symbols = hs.map((h) => h.symbol);

    const dup = symbols.find((s, i) => symbols.indexOf(s) !== i);
    if (dup) throw new ApiError(400, "bad_request", `${dup} is listed twice`);
    const total = hs.reduce((n, h) => n + h.weight_pct, 0);
    if (total > 100 + WEIGHT_SUM_TOLERANCE_PCT) throw new ApiError(400, "bad_request", `Weights add up to ${total.toFixed(2)}%. They can't be more than 100%.`);

    const known = (await ctx.db.from("companies").select("symbol, name").in("symbol", symbols)).data ?? [];
    const unknown = symbols.filter((s) => !known.some((k) => k.symbol === s));
    if (unknown.length) throw new ApiError(400, "bad_request", `FINN doesn't know ${unknown.join(", ")}. Use the NSE symbol, or search for the company in Research first.`);

    // The mandate runs before the write: an excluded name is refused, not saved and flagged.
    const hv = await houseView(ctx);
    const excluded = symbols.filter((s) => hv.excluded_symbols.includes(s));
    if (excluded.length) throw new ApiError(400, "bad_request", `${excluded.join(", ")} ${excluded.length === 1 ? "is" : "are"} on your exclusion list, so ${excluded.length === 1 ? "it" : "they"} can't be held.`);

    const pid = ctx.env.portfolioId;
    const up = await ctx.db.from("holdings").upsert(hs.map((h) => ({ portfolio_id: pid, ...h })), { onConflict: "portfolio_id,symbol" });
    if (up.error) throw new ApiError(400, "bad_request", `Could not save: ${up.error.message}`);
    const del = await ctx.db.from("holdings").delete().eq("portfolio_id", pid).not("symbol", "in", `(${symbols.join(",")})`);
    if (del.error) throw new Error(`holdings: ${del.error.message}`);

    const limit = Number(((await ctx.db.from("alert_rules").select("params").eq("portfolio_id", pid).eq("kind", "concentration").maybeSingle()).data?.params as { max_weight_pct?: number } | undefined)?.max_weight_pct ?? 10);
    const man = await mandate(ctx, symbols);
    const summary = mandateSummary(hs.map((h) => ({ ...h, name: known.find((k) => k.symbol === h.symbol)!.name, mandate: man.get(h.symbol)! })));
    const warnings = [
      ...hs.filter((h) => h.weight_pct > limit).map((h) => `${h.symbol} is ${h.weight_pct}%, above your ${limit}% limit for one company.`),
      ...(total < 100 - WEIGHT_SUM_TOLERANCE_PCT ? [`Weights add up to ${Math.round(total * 100) / 100}%; the rest is treated as cash.`] : []),
    ];
    return ok(c, { saved: hs.length, total_pct: Math.round(total * 100) / 100, mandate: summary, warnings }, { as_of: toIst(ctx.deps.clock.now()), stale: false, stale_reason: null });
  });

  /**
   * The book's value over time as an index (first session = 100): each holding's close relative to
   * its first stored close, weighted by its portfolio weight. Real closes only. Rupee values need
   * quantities, which the ledger doesn't hold, so none are returned.
   */
  r.get("/holdings/history", cdn(), async (c) => {
    const now = ctx.deps.clock.now();
    const hs = await holdings(ctx);
    const px = await prices(ctx, hs.map((h) => h.symbol), 400);
    const dates = [...new Set([...px.values()].flatMap((s) => s.map((p) => p.date)))].sort();
    const covered = hs.filter((h) => (px.get(h.symbol)?.length ?? 0) > 0);
    const wTotal = covered.reduce((n, h) => n + h.weight_pct, 0);
    const last = new Map<string, number>();
    const base = new Map<string, number>();
    const points: { date: string; index: number }[] = [];
    const bySym = new Map(covered.map((h) => [h.symbol, new Map((px.get(h.symbol) ?? []).map((p) => [p.date, p.close]))]));
    for (const d of dates) {
      let v = 0;
      let w = 0;
      for (const h of covered) {
        const close = bySym.get(h.symbol)!.get(d) ?? last.get(h.symbol);
        if (close === undefined) continue; // not listed yet on this date: left out, weights rescaled
        last.set(h.symbol, close);
        if (!base.has(h.symbol)) base.set(h.symbol, close);
        v += h.weight_pct * (close / base.get(h.symbol)!);
        w += h.weight_pct;
      }
      if (w > 0) points.push({ date: d, index: Math.round((v / w) * 100 * 100) / 100 });
    }
    return ok(c, {
      points,
      covered: covered.length,
      holdings: hs.length,
      weight_covered_pct: Math.round(wTotal * 100) / 100,
      method: "Each holding's close relative to its first stored close, weighted by portfolio weight; first session = 100.",
    }, freshness(await sourceStatus(ctx), ["yahoo"], now));
  });

  r.get("/settings", noStore, async (c) => {
    const p = await ctx.db.from("portfolios").select("settings").eq("id", ctx.env.portfolioId).maybeSingle();
    const settings = (p.data?.settings as any) ?? {
      mandate: {
        excluded_activities: ["alcohol", "tobacco", "gambling", "real_money_gaming", "animal_harm"],
        excluded_symbols: [],
      },
      push: { channel: "telegram", max_per_day: 3, digest_time_ist: "08:00" },
      muted_sub_kinds: [],
    };
    const fb = await ctx.db
      .from("feedback")
      .select("sub_kind, action")
      .eq("portfolio_id", ctx.env.portfolioId)
      .in("action", ["mute_kind", "unmute_kind"])
      .order("created_at", { ascending: true });
    const muted = new Set<string>(settings.muted_sub_kinds ?? []);
    for (const row of fb.data ?? []) {
      if (row.action === "mute_kind" && row.sub_kind) muted.add(row.sub_kind);
      if (row.action === "unmute_kind" && row.sub_kind) muted.delete(row.sub_kind);
    }
    settings.muted_sub_kinds = [...muted];

    return ok(c, {
      house_view: settings,
      materiality: {
        act_threshold: 80,
        always_act: [
          "Auditor resignation or qualification",
          "Promoter pledge creation or increase",
          "Promoter open-market sales",
          "Senior executive exits (MD, CEO, CFO, CS)",
          "Regulatory orders and penalties",
          "Material related party transactions",
          "Acquisition into an excluded business",
        ],
      },
    }, { as_of: toIst(ctx.deps.clock.now()), stale: false, stale_reason: null });
  });

  r.put("/settings", noStore, async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") throw new ApiError(400, "bad_request", "invalid body");
    const p = await ctx.db.from("portfolios").select("settings").eq("id", ctx.env.portfolioId).maybeSingle();
    const current = (p.data?.settings as any) ?? {};
    const updated = {
      ...current,
      mandate: {
        ...current.mandate,
        ...(body.mandate ?? {}),
      },
      muted_sub_kinds: Array.isArray(body.muted_sub_kinds) ? body.muted_sub_kinds : current.muted_sub_kinds ?? [],
    };
    const { error } = await ctx.db.from("portfolios").update({ settings: updated }).eq("id", ctx.env.portfolioId);
    if (error) throw new ApiError(400, "bad_request", `Could not update settings: ${error.message}`);
    return ok(c, { saved: true, settings: updated }, { as_of: toIst(ctx.deps.clock.now()), stale: false, stale_reason: null });
  });

  return r;
}
