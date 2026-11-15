import { Hono } from "hono";
import { z } from "zod";
import {
  ACT_THRESHOLD,
  CATEGORY_BASE,
  DEFAULT_MODELS,
  fmtTarget,
  MIN_CHARS_PER_PAGE,
  RULE_VERSION,
  TASK_CONFIG,
  toIst,
} from "@finn/core";
import { EBITDA_FORMULA, MIN_QUOTE_MATCH } from "@finn/shared";
import type { ApiCtx } from "../ctx";
import { company, feedRows, records } from "../data";
import { ApiError, cdn, noStore, ok } from "../http";

const DAY = 864e5;
const nowF = (ctx: ApiCtx) => ({ as_of: toIst(ctx.deps.clock.now()), stale: false, stale_reason: null });

export function utilRoutes(ctx: ApiCtx) {
  const r = new Hono();

  r.get("/search", cdn(86400, 600), async (c) => {
    // Only letters, digits, spaces, & and - reach the query: no PostgREST filter syntax.
    const q = (c.req.query("q") ?? "").replace(/[^A-Za-z0-9 &-]/g, "").trim();
    if (q.length < 1) throw new ApiError(400, "bad_request", "q is required");
    const { data, error } = await ctx.db.from("companies").select("symbol, name").or(`symbol.ilike.${q}%,name.ilike.%${q}%`).limit(30);
    if (error) throw new Error(`search: ${error.message}`);
    const up = q.toUpperCase();
    const ranked = [...(data ?? [])];
    // Exact symbol first, then symbols that start with it, then name matches; eight at most.
    const nameStarts = (n: string) => Number(n.toUpperCase().startsWith(up));
    ranked.sort((a, b) => Number(b.symbol === up) - Number(a.symbol === up) || Number(b.symbol.startsWith(up)) - Number(a.symbol.startsWith(up)) || nameStarts(b.name) - nameStarts(a.name));
    return ok(c, { items: ranked.slice(0, 8) }, nowF(ctx));
  });

  /** "How FINN decides": the rules, formulas and model routing, plus what models have cost so far. */
  r.get("/method", cdn(), async (c) => {
    const { data, error } = await ctx.db.from("llm_calls").select("task, model, provider, tokens_in, tokens_out, cached, cost_inr, ok").limit(20000);
    if (error) throw new Error(`llm_calls: ${error.message}`);
    const calls = data ?? [];
    const byTask = new Map<string, { calls: number; cached: number; tokens_in: number; tokens_out: number; cost_inr: number }>();
    for (const x of calls) {
      const t = byTask.get(x.task) ?? { calls: 0, cached: 0, tokens_in: 0, tokens_out: 0, cost_inr: 0 };
      t.calls++;
      t.cached += x.cached ? 1 : 0;
      t.tokens_in += x.tokens_in;
      t.tokens_out += x.tokens_out;
      t.cost_inr += Number(x.cost_inr);
      byTask.set(x.task, t);
    }
    const tiers = Object.entries(TASK_CONFIG).map(([task, cfg]) => ({ task, tier: cfg.tier, tier_name: cfg.tierName, default_model: cfg.defaultModel, failover: cfg.failoverModel ?? null }));
    return ok(c, {
      ranking: {
        tiers: "Act / Read / Routine",
        act_threshold: ACT_THRESHOLD,
        category_weights: CATEGORY_BASE,
        position_weight: "Each portfolio percentage point adds to the score, capped at 10%",
        always_act: [
          "Auditor resignation or mid-term change (not mandatory rotation)", "Qualified or modified audit opinion", "Promoter selling",
          "Pledge created, increased or invoked", "Resignation of MD, CEO, CFO or company secretary", "Regulatory penalty", "Insolvency proceedings",
          "Credit rating downgrade", "Acquisition into an excluded business",
        ],
      },
      formulas: {
        ebitda: EBITDA_FORMULA,
        pat_check: "PBT − tax = PAT within 1% (or ₹0.05 cr), every quarter on the card",
        screener_check: "Revenue, PBT, PAT and EBITDA within 1% of Screener (or ₹0.51 cr for its rounding)",
        cash_conversion: "Half-year (Q2) or full-year (Q4) operating cash flow ÷ PAT for the same period",
      },
      verdicts: {
        rule_version: RULE_VERSION,
        tolerance: "0.5 pp for margins; 2% of the target for growth and amounts",
        quote_check: `Every quote is matched word by word against its cited page; below ${MIN_QUOTE_MATCH} it is dropped`,
        credibility: "Met X of Y targets that are due: only Met and Missed count",
      },
      documents: { scan_threshold: `Below ${MIN_CHARS_PER_PAGE} characters per page a PDF is treated as a scan` },
      model_routing: { tiers, defaults: DEFAULT_MODELS, tier0: "Code: arithmetic, scoring, rules, verdicts, grouping. No model." },
      costs: {
        calls: calls.length,
        cached_calls: calls.filter((x) => x.cached).length,
        failed_calls: calls.filter((x) => !x.ok).length,
        total_inr: Math.round(calls.reduce((s, x) => s + Number(x.cost_inr), 0) * 100) / 100,
        by_task: [...byTask].map(([task, t]) => ({ task, ...t, cost_inr: Math.round(t.cost_inr * 100) / 100 })),
      },
    }, nowF(ctx));
  });

  const Feedback = z.strictObject({
    action: z.enum(["seen", "mute_kind", "unmute_kind"]),
    filing_id: z.number().int().positive().optional(),
    sub_kind: z.string().regex(/^[a-z_]{2,40}$/).optional(),
  }).refine((f) => (f.action === "seen" ? f.filing_id !== undefined : f.sub_kind !== undefined), { message: "seen needs filing_id; mute_kind and unmute_kind need sub_kind" });

  r.post("/feedback", noStore, async (c) => {
    const body = Feedback.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new ApiError(400, "bad_request", body.error.issues[0]?.message ?? "invalid body");
    const { error } = await ctx.db.from("feedback").insert({ portfolio_id: ctx.env.portfolioId, action: body.data.action, filing_id: body.data.filing_id ?? null, sub_kind: body.data.sub_kind ?? null });
    if (error) throw new ApiError(400, "bad_request", `Could not save feedback: ${error.message}`);
    return ok(c, { saved: true }, nowF(ctx));
  });

  // ─── Ask: answers only from this company's stored sources, with citations ─
  const Ask = z.strictObject({ symbol: z.string().regex(/^[A-Za-z0-9&-]{1,20}$/), question: z.string().min(5).max(500) });
  const Answer = z.union([
    z.strictObject({ refused: z.literal(false), answer: z.string().min(1).max(1500), citations: z.array(z.number().int().positive()).min(1) }),
    z.strictObject({ refused: z.literal(true), reason: z.string().min(1).max(300) }),
  ]);

  r.post("/ask", noStore, async (c) => {
    const body = Ask.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new ApiError(400, "bad_request", body.error.issues[0]?.message ?? "invalid body");
    const symbol = body.data.symbol.toUpperCase();
    const co = await company(ctx, symbol);
    if (!co) throw new ApiError(404, "not_found", `No company with symbol ${symbol}`);
    if (!ctx.deps.llm) throw new ApiError(503, "upstream_unavailable", "Ask needs a model key, which is not configured");

    const now = ctx.deps.clock.now();
    const [recMap, filings, resultsRes, peopleEventsRes] = await Promise.all([
      records(ctx, [symbol]),
      feedRows(ctx, [symbol], new Date(now.getTime() - 180 * DAY), now, { tiers: ["act", "read"], limit: 25 }),
      ctx.db.from("results").select("period, basis, metrics, checks, filed_at, source_url").eq("symbol", symbol).order("filed_at", { ascending: false }).limit(1),
      ctx.db.from("people_events").select("name, role, action, effective_date, prior_roles, stated_reason, tenure_months, source_page").eq("symbol", symbol).order("effective_date", { ascending: false }).limit(10),
    ]);
    const rec = recMap.get(symbol)!;
    const results = resultsRes.data?.[0];
    const peopleEvents = (peopleEventsRes.data ?? []) as {
      name: string;
      role: string;
      action: string;
      effective_date: string | null;
      prior_roles: string[] | null;
      stated_reason: string | null;
      tenure_months: number | null;
      source_page: number | null;
    }[];

    const sources: { n: number; kind: string; label: string; text: string; url: string | null; page: number | null }[] = [];
    for (const s of rec.statements) sources.push({ n: sources.length + 1, kind: "guidance", label: `${s.call_period} call, p.${s.page}`, text: `"${s.quote}" (target ${fmtTarget(s.target, s.unit)}${s.period_target ? ` for ${s.period_target}` : ""})`, url: null, page: s.page });
    for (const f of filings) sources.push({ n: sources.length + 1, kind: "filing", label: `Filing ${f.filed_at.slice(0, 10)}`, text: f.headline, url: f.attachment_url, page: null });
    for (const p of peopleEvents) {
      const parts = [`${p.name} - ${p.role} (${p.action}${p.effective_date ? ` w.e.f. ${p.effective_date}` : ""})`];
      if (p.prior_roles && Array.isArray(p.prior_roles) && p.prior_roles.length > 0) parts.push(`Prior roles: ${p.prior_roles.join("; ")}`);
      if (p.stated_reason) parts.push(`Stated reason: ${p.stated_reason}`);
      if (p.tenure_months) parts.push(`Tenure: ${p.tenure_months} months`);
      sources.push({ n: sources.length + 1, kind: "people", label: `Management: ${p.name}`, text: parts.join(". "), url: null, page: p.source_page ?? null });
    }
    if (results) sources.push({ n: sources.length + 1, kind: "results", label: `${results.period} results (${results.basis})`, text: JSON.stringify((results.metrics as { current: unknown }).current), url: results.source_url, page: null });
    if (sources.length === 0) {
      return ok(c, { refused: true, reason: `FINN has no documents for ${symbol} yet. Run research first.` }, nowF(ctx));
    }

    const { data } = await ctx.deps.llm.run({
      task: "answer_scoped",
      tier: "mid",
      promptVersion: "ask-v1",
      system: [
        "Answer a fund manager's question about one Indian listed company using the numbered sources given.",
        "Ground every factual statement in the provided sources and cite them with source numbers [n].",
        "For management or executive leadership inquiries:",
        "- Detail the person's verified role, appointment/re-appointment/resignation status, and background from the disclosure sources.",
        "- If the user asks for a LinkedIn profile, URL, or contact details:",
        "  1. Ground their identity and title from the sources (e.g. [n]).",
        "  2. Note that regulatory filings disclose official credentials rather than direct social profile links.",
        "  3. Provide a direct LinkedIn search URL so the user can open their profile: https://www.linkedin.com/search/results/all/?keywords=<Name>+<Company>",
        "  4. Cite the source(s) mentioning the person.",
        "Only refuse if the sources contain no relevant facts or context for the question.",
      ].join("\n"),
      input: `Company: ${co.name} (${symbol})\nQuestion: ${body.data.question}\n\nSources:\n${sources.map((s) => `[${s.n}] (${s.label}) ${s.text}`).join("\n")}`,
      schema: Answer,
    });
    if (data.refused) return ok(c, { refused: true, reason: (data as any).reason }, nowF(ctx));
    const resData = data as { refused: false; answer: string; citations: number[] };
    // A citation must point at a source we actually gave the model.
    const cited = [...new Set(resData.citations)].map((n) => sources.find((s) => s.n === n));
    if (cited.some((s) => !s)) return ok(c, { refused: true, reason: "The answer cited sources that do not exist, so it was withheld." }, nowF(ctx));
    return ok(c, { refused: false, answer: resData.answer, citations: cited.map((s) => ({ n: s!.n, kind: s!.kind, label: s!.label, url: s!.url, page: s!.page })) }, nowF(ctx));
  });

  return r;
}
