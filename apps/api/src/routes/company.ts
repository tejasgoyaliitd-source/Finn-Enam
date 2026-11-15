import { Hono } from "hono";
import { fmtTarget, periodLabel, quarterOrdinal, toIst } from "@finn/core";
import { VERDICT_LABEL } from "@finn/shared";
import type { ApiCtx } from "../ctx";
import { company, feedRows, governance, holdings, mandate, prices, records } from "../data";
import { freshness, sourceStatus } from "../fresh";
import { ApiError, cdn, noStore, numParam, ok } from "../http";
import { resultsDetail } from "./items";
import { assess } from "./read";
import { researchStatus } from "./research";

/**
 * The company page, for any NSE company: held or not, researched or not. Each tab has its own
 * endpoint so a tab loads only what it shows. Nothing here fetches from an exchange.
 */

const DAY = 864e5;
type Actual = { period: string; metric: string; basis: string; value: number };

async function annualActuals(ctx: ApiCtx, symbol: string) {
  const rows = ((await ctx.db.from("actuals").select("period, metric, basis, value").eq("symbol", symbol).like("period", "FY%")).data ?? []) as Actual[];
  // Banks and NBFCs: Screener's top line is "revenue" (interest earned), not "sales".
  const top = rows.some((r) => r.metric === "sales") ? "sales" : "revenue";
  const basis = rows.some((r) => r.basis === "consolidated" && r.metric === top) ? "consolidated" : "standalone";
  const get = (p: string, m: string) => {
    const v = rows.find((r) => r.period === p && r.basis === basis && r.metric === m)?.value;
    return v == null ? null : Number(v);
  };
  const years = [...new Set(rows.filter((r) => r.basis === basis && r.metric === top).map((r) => r.period))].sort().slice(-6);
  return { basis, years, get, top };
}

async function companyOr404(ctx: ApiCtx, raw: string) {
  const symbol = raw.toUpperCase();
  const co = await company(ctx, symbol);
  if (!co) throw new ApiError(404, "not_found", `No NSE company with symbol ${symbol}`);
  return co;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
/** ₹ crore with Indian grouping: 3,000 not 3000. */
const cr = (x: number) => `₹${Math.round(x).toLocaleString("en-IN")} cr`;

export function companyRoutes(ctx: ApiCtx) {
  const r = new Hono();

  /** Header and Overview: price with 60 sessions, state with its reason, record, governance, mandate, questions. */
  r.get("/companies/:symbol", cdn(), async (c) => {
    const co = await companyOr404(ctx, c.req.param("symbol"));
    const symbol = co.symbol;
    const now = ctx.deps.clock.now();
    const hs = await holdings(ctx);
    const weight = hs.find((h) => h.symbol === symbol)?.weight_pct ?? null;
    const [[a], px, gov, man, recs, research, recent, annual, quarters] = await Promise.all([
      assess(ctx, [{ symbol, name: co.name, sector: co.sector, weight_pct: weight }]),
      prices(ctx, [symbol], 100),
      governance(ctx, [symbol]),
      mandate(ctx, [symbol]),
      records(ctx, [symbol]),
      researchStatus(ctx, symbol),
      feedRows(ctx, [symbol], new Date(now.getTime() - 90 * DAY), now, { tiers: ["act", "read"], limit: 1 }),
      annualActuals(ctx, symbol),
      ctx.db.from("actuals").select("period, metric, value, basis").eq("symbol", symbol).like("period", "Q%").in("metric", ["opm_pct", "other_income", "profit_before_tax"]),
    ]);
    const series = (px.get(symbol) ?? []).slice(-60);
    const last = series.at(-1);
    const prev = series.at(-2);
    const g = gov.get(symbol)!;
    const rec = recs.get(symbol)!;

    // Questions for management: from gaps in the record first, then from the numbers.
    const questions: { text: string; why: string; source: { label: string; url: string | null; page: number | null } }[] = [];
    const docIds = [...new Set(rec.statements.map((s) => s.doc_id))];
    const docs = docIds.length ? ((await ctx.db.from("documents").select("id, url").in("id", docIds)).data ?? []) : [];
    for (const s of rec.statements) {
      const v = rec.verdicts.find((x) => x.statement_id === s.id);
      if (!v || !["missed", "behind", "revised", "not_mentioned_since"].includes(v.verdict)) continue;
      const target = `${s.metric_label} ${fmtTarget(s.target, s.unit)}${s.period_target ? ` for ${periodLabel(s.period_target)}` : ""}`;
      const text =
        v.verdict === "missed" ? `You guided ${target} and missed it. What was different from the plan?`
          : v.verdict === "behind" ? `${target} is behind pace. What has to happen in the rest of the year to get there?`
            : v.verdict === "revised" ? `${target} was revised. What changed, and how confident are you in the new number?`
              : `${target} hasn't been mentioned since ${v.last_mentioned_in ? periodLabel(v.last_mentioned_in) : "it was given"}. Is it still the plan?`;
      questions.push({ text, why: v.reason, source: { label: `${periodLabel(s.call_period)} call, p.${s.page}`, url: (docs.find((d) => d.id === s.doc_id)?.url as string | undefined) ?? null, page: s.page } });
    }
    const fy = annual.years.at(-1);
    if (fy) {
      const cfo = annual.get(fy, "cf_cash_from_operating_activity");
      const pat = annual.get(fy, "net_profit");
      if (cfo != null && pat != null && pat > 0 && cfo / pat < 0.8) {
        questions.push({ text: `Operating cash flow was ${r2(cfo / pat)}× profit in ${fy}. What held the cash back, and when does it come in?`, why: `CFO ${cr(cfo)} against PAT ${cr(pat)}.`, source: { label: `Screener, ${fy} cash flow`, url: `https://www.screener.in/company/${encodeURIComponent(symbol)}/`, page: null } });
      }
    }
    const q = ((quarters.data ?? []) as Actual[]).filter((x) => x.basis === annual.basis);
    const qs = [...new Set(q.map((x) => x.period))].sort((x, y) => quarterOrdinal(x) - quarterOrdinal(y));
    const lq = qs.at(-1);
    const ya = lq ? qs.find((p) => quarterOrdinal(p) === quarterOrdinal(lq) - 4) : undefined;
    const qv = (p: string | undefined, m: string) => (p ? (q.find((x) => x.period === p && x.metric === m)?.value ?? null) : null);
    if (lq && ya) {
      const m1 = qv(lq, "opm_pct");
      const m0 = qv(ya, "opm_pct");
      if (m1 != null && m0 != null && m0 - m1 >= 2) questions.push({ text: `Operating margin fell from ${m0}% to ${m1}% year on year in ${periodLabel(lq)}. How much is pricing, mix and cost, and how much comes back?`, why: `${Math.round((m0 - m1) * 10) / 10} points lower than ${periodLabel(ya)}.`, source: { label: `Screener, ${periodLabel(lq)} results`, url: `https://www.screener.in/company/${encodeURIComponent(symbol)}/`, page: null } });
      const oi = qv(lq, "other_income");
      const pbt = qv(lq, "profit_before_tax");
      if (oi != null && pbt != null && pbt > 0 && oi / pbt >= 0.25) questions.push({ text: `Other income was ${Math.round((oi / pbt) * 100)}% of profit before tax in ${periodLabel(lq)}. What was it, and does it repeat?`, why: `${cr(oi)} of ${cr(pbt)} PBT.`, source: { label: `Screener, ${periodLabel(lq)} results`, url: `https://www.screener.in/company/${encodeURIComponent(symbol)}/`, page: null } });
    }
    const exits = g.flags.filter((x) => x.kind === "senior_exit");
    if (exits.length >= 2) questions.push({ text: `${exits.length} senior people left in the last 12 months. Is there a pattern, and who now runs those functions?`, why: exits.map((e) => `${e.detail} (${e.date_formatted})`).join("; "), source: { label: "Exchange filings", url: null, page: null } });

    const lastEvent = recent[0];
    // A company you don't hold has no filings on file: say so rather than call it clean.
    const tracked = weight !== null || (await ctx.db.from("filings").select("id", { count: "exact", head: true }).eq("symbol", symbol)).count! > 0;
    const f = freshness(await sourceStatus(ctx), ["filings", "yahoo"], now);
    return ok(c, {
      header: {
        ...co,
        weight_pct: weight,
        held: weight !== null,
        last_close: last?.close ?? null,
        change_pct: last && prev ? Math.round((last.close / prev.close - 1) * 1000) / 10 : null,
        price_date: last?.date ?? null,
        sparkline: series.map((p) => p.close),
        state: tracked ? a!.state : null,
        state_reason: tracked ? (a!.state_reasons[0] ?? null) : "Not tracked: FINN watches exchange filings for your holdings only.",
        record: a!.record,
        credibility: rec.credibility.line,
      },
      research,
      latest_event: lastEvent ? { filing_id: lastEvent.filing_id, headline: lastEvent.headline, tier: lastEvent.tier, filed_at: lastEvent.filed_at, reasons: lastEvent.reasons } : null,
      record: { credibility: rec.credibility.line, statements: rec.statements.length },
      governance: tracked
        ? { symbol: co.symbol, line: g.line, count: g.count, flags: g.flags.map((x) => ({ kind: x.kind, detail: x.detail, date: x.date_formatted, filing_id: x.filing_id })), checked: true }
        : { symbol: co.symbol, line: "Not checked: FINN hasn't fetched this company's filings.", count: 0, flags: [], checked: false },
      mandate: man.get(symbol),
      questions: questions.slice(0, 5),
    }, f);
  });

  /** Record: every statement with its verdict, quote and page, grouped by verdict on the client. */
  r.get("/companies/:symbol/record", cdn(300, 600), async (c) => {
    const co = await companyOr404(ctx, c.req.param("symbol"));
    const rec = (await records(ctx, [co.symbol])).get(co.symbol)!;
    const docIds = [...new Set(rec.statements.map((s) => s.doc_id))];
    const docs = docIds.length ? ((await ctx.db.from("documents").select("id, url, period").in("id", docIds)).data ?? []) : [];
    const book = annualActualsFor(ctx, co.symbol);
    const { get } = await book;
    const items = rec.statements
      .map((s) => {
        const v = rec.verdicts.find((x) => x.statement_id === s.id);
        const fyTarget = s.period_target && /^FY\d{2}$/.test(s.period_target) ? s.period_target : null;
        const delivered = fyTarget && s.metric_kind === "growth" && /revenue|sales/i.test(s.metric) ? get(fyTarget, "sales_growth") : null;
        return {
          id: s.id,
          call: periodLabel(s.call_period),
          call_period: s.call_period,
          metric: s.metric_label,
          scope: s.scope === "segment" ? s.segment : null,
          period_target: s.period_target ? periodLabel(s.period_target) : null,
          target: fmtTarget(s.target, s.unit),
          quote: s.quote,
          page: s.page,
          source_url: (docs.find((d) => d.id === s.doc_id)?.url as string | undefined) ?? null,
          verdict: v?.verdict ?? null,
          verdict_label: v ? VERDICT_LABEL[v.verdict] : null,
          reason: v?.reason ?? null,
          pace_note: v?.pace_note ?? null,
          delivered: delivered != null ? `Delivered ${delivered}% growth in ${periodLabel(fyTarget!)}.` : null,
        };
      })
      .sort((a, b) => quarterOrdinal(b.call_period) - quarterOrdinal(a.call_period));
    const asOf = rec.verdicts.map((v) => v.as_of).sort().at(-1) ?? toIst(ctx.deps.clock.now());
    return ok(c, { credibility: rec.credibility.line, items }, { as_of: asOf as never, stale: false, stale_reason: null });
  });

  /** Results for one quarter (latest by default) and the quarters that can be picked. */
  r.get("/companies/:symbol/results", cdn(), async (c) => {
    const co = await companyOr404(ctx, c.req.param("symbol"));
    const [cards, acts] = await Promise.all([
      ctx.db.from("results").select("period").eq("symbol", co.symbol),
      ctx.db.from("actuals").select("period").eq("symbol", co.symbol).in("metric", ["sales", "revenue"]).like("period", "Q%"),
    ]);
    const periods = [...new Set([...(cards.data ?? []), ...(acts.data ?? [])].map((x) => x.period as string))]
      .sort((a, b) => quarterOrdinal(b) - quarterOrdinal(a))
      .slice(0, 5);
    const want = (c.req.query("period") ?? periods[0] ?? "").toUpperCase().replace(/\s/g, "");
    if (!want) return ok(c, { periods: [], period: null, card: null, note: `FINN has no quarterly figures for ${co.symbol} yet. Research reads them from Screener.` }, freshness(await sourceStatus(ctx), ["screener"], ctx.deps.clock.now()));
    if (!/^Q[1-4]FY\d{2}$/.test(want)) throw new ApiError(400, "bad_request", "period looks like Q2FY27");
    // The results filing for that quarter, when it's on file, is the source chip.
    const filing = (await feedRows(ctx, [co.symbol], new Date(Date.now() - 400 * DAY), ctx.deps.clock.now())).find((x) => x.sub_kind === "results" && x.headline.includes(periodLabel(want)));
    const card = await resultsDetail(ctx, co.symbol, want, filing?.attachment_url ?? null);
    return ok(c, { periods: periods.map((p) => ({ value: p, label: periodLabel(p) })), period: want, card, filing_id: filing?.filing_id ?? null }, freshness(await sourceStatus(ctx), ["screener"], ctx.deps.clock.now()));
  });

  /** Filings: events in the last 30 days, 8 a page. */
  r.get("/companies/:symbol/filings", cdn(), async (c) => {
    const co = await companyOr404(ctx, c.req.param("symbol"));
    const now = ctx.deps.clock.now();
    const page = numParam(c, "page", 1, 1, 50);
    const rows = await feedRows(ctx, [co.symbol], new Date(now.getTime() - 30 * DAY), now);
    const events = new Map<number, typeof rows>();
    for (const x of rows) events.set(x.event_id, [...(events.get(x.event_id) ?? []), x]);
    const RANK = { act: 0, read: 1, routine: 2 } as const;
    const list = [...events.values()]
      .map((fs) => {
        const primary = [...fs].sort((a, b) => RANK[a.tier] - RANK[b.tier] || b.score - a.score)[0]!;
        return { filing_id: primary.filing_id, headline: primary.headline, tier: primary.tier, reasons: primary.reasons, filed_at: fs[0]!.filed_at, filings: fs.length, attachment_url: primary.attachment_url };
      })
      .sort((a, b) => b.filed_at.localeCompare(a.filed_at));
    const held = (await holdings(ctx)).some((h) => h.symbol === co.symbol);
    return ok(c, {
      events: list.slice((page - 1) * 8, page * 8),
      total: list.length,
      page,
      pages: Math.max(1, Math.ceil(list.length / 8)),
      note: list.length === 0 ? (held ? "No filings in the last 30 days." : "FINN tracks exchange filings for your holdings. This company's filings haven't been fetched.") : null,
    }, freshness(await sourceStatus(ctx), ["filings"], now));
  });

  /** Research tab: cash quality and trajectory from annual tables, risks from the snapshot. */
  r.get("/companies/:symbol/financials", cdn(300, 600), async (c) => {
    const co = await companyOr404(ctx, c.req.param("symbol"));
    const { basis, years, get, top } = await annualActualsFor(ctx, co.symbol);
    const cash = years.map((fy) => {
      const cfo = get(fy, "cf_cash_from_operating_activity");
      const pat = get(fy, "net_profit");
      return { fy, cfo, pat, ratio: cfo != null && pat != null && pat !== 0 ? r2(cfo / pat) : null };
    });
    const trajectory = years.map((fy) => {
      const sales = get(fy, top);
      const op = get(fy, "operating_profit");
      const pbt = get(fy, "profit_before_tax");
      const int = get(fy, "interest");
      const ce = [get(fy, "bs_equity_capital"), get(fy, "bs_reserves"), get(fy, "bs_borrowings")];
      const capital = ce.every((x) => x != null) ? ce.reduce((n, x) => n! + x!, 0)! : null;
      return {
        fy,
        revenue: sales,
        ebitda_margin: sales && op != null ? Math.round((op / sales) * 1000) / 10 : null,
        // Not for banks: their borrowings are deposits, so ROCE says nothing useful.
        roce: top === "sales" && pbt != null && int != null && capital ? Math.round(((pbt + int) / capital) * 1000) / 10 : null,
      };
    });
    const snap = (await ctx.db.from("research_snapshots").select("sections").eq("symbol", co.symbol).maybeSingle()).data?.sections as
      | { risks?: { down: { text: string; source: { label: string; url: string | null; page: number | null } }[]; up: { text: string; source: { label: string; url: string | null; page: number | null } }[] } }
      | undefined;
    const ar = (await ctx.db.from("documents").select("period, url, pages").eq("symbol", co.symbol).eq("type", "annual_report").order("period", { ascending: false }).limit(1)).data?.[0];
    return ok(c, {
      basis,
      source: { label: `Screener, ${basis} annual tables`, url: `https://www.screener.in/company/${encodeURIComponent(co.symbol)}/` },
      cash,
      trajectory,
      roce_note: "ROCE = (PBT + interest) ÷ (equity + reserves + borrowings) at year end.",
      risks: snap?.risks ?? null,
      risks_note: snap?.risks
        ? null
        : ar
          ? `FINN has the ${ar.period} annual report${ar.pages ? ` (${ar.pages} pages)` : ""} but hasn't read its risks yet: that needs the model, which isn't set up. Every point it writes will cite a page.`
          : "Risks are read from the annual report, with a page for every point. Research hasn't found an annual report yet.",
      annual_report: ar ? { label: `${ar.period} annual report`, url: ar.url as string } : null,
    }, freshness(await sourceStatus(ctx), ["screener"], ctx.deps.clock.now()));
  });

  /** Start (or join) research for any company. */
  r.get("/companies/:symbol/research-status", noStore, async (c) => {
    const co = await companyOr404(ctx, c.req.param("symbol"));
    return ok(c, await researchStatus(ctx, co.symbol), { as_of: toIst(ctx.deps.clock.now()), stale: false, stale_reason: null });
  });

  return r;
}

const annualActualsFor = annualActuals;
