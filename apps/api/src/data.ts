import { fromGuidanceRow } from "@finn/adapters";
import { computeGovernanceStrip, credibilityLine, toIst, type FeedItem } from "@finn/core";
import type { FilingTier, GuidanceStatement, IstDateTime, Verdict } from "@finn/shared";
import type { ApiCtx } from "./ctx";

/** Shared read queries. Every amount and date comes back exactly as stored; IST conversion is here. */

const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
};
export const ist = (iso: string) => toIst(new Date(iso));

/** PostgREST returns at most 1,000 rows per request whatever .limit() says: page with .range(). */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, what: string, max = 20000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const r = await page(from, from + 999);
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    out.push(...(r.data ?? []));
    if ((r.data?.length ?? 0) < 1000) break;
  }
  return out;
}

export interface Holding {
  symbol: string;
  name: string;
  sector: string | null;
  is_bank: boolean;
  weight_pct: number;
}

export async function holdings(ctx: ApiCtx): Promise<Holding[]> {
  const rows = must(
    await ctx.db.from("holdings").select("weight_pct, companies!inner(symbol, name, sector, is_bank)").eq("portfolio_id", ctx.env.portfolioId).order("weight_pct", { ascending: false }),
    "holdings",
  ) as unknown as { weight_pct: string | number; companies: Omit<Holding, "weight_pct"> }[];
  return rows.map((r) => ({ ...r.companies, weight_pct: Number(r.weight_pct) }));
}

export async function company(ctx: ApiCtx, symbol: string) {
  return must(await ctx.db.from("companies").select("symbol, name, sector, is_bank, isin, bse_code").eq("symbol", symbol).maybeSingle(), "company") as
    | { symbol: string; name: string; sector: string | null; is_bank: boolean; isin: string; bse_code: string | null }
    | null;
}

export async function houseView(ctx: ApiCtx): Promise<{ excluded_symbols: string[] }> {
  const p = must(await ctx.db.from("portfolios").select("settings").eq("id", ctx.env.portfolioId).maybeSingle(), "portfolio") as { settings: { mandate?: { excluded_symbols?: string[] } } } | null;
  return { excluded_symbols: p?.settings?.mandate?.excluded_symbols ?? [] };
}

export interface FeedRow extends FeedItem {
  sub_kind: string | null;
  category: string;
  subject: string;
  attachment_url: string | null;
  raw: Record<string, unknown> | null;
}

/** Analysed, non-duplicate filings for these symbols in [from, to). */
export async function feedRows(ctx: ApiCtx, symbols: string[], from: Date, to: Date, opts: { tiers?: FilingTier[]; limit?: number; withRaw?: boolean } = {}): Promise<FeedRow[]> {
  if (symbols.length === 0) return [];
  let q = ctx.db
    .from("filings")
    .select(`id, symbol, subject, filed_at, attachment_url${opts.withRaw ? ", raw" : ""}, filing_analysis!inner(tier, score, reasons, headline, sub_kind, category, event_id)`)
    .in("symbol", symbols)
    .gte("filed_at", from.toISOString())
    .lt("filed_at", to.toISOString())
    .is("duplicate_of", null)
    .order("filed_at", { ascending: false })
    .order("id", { ascending: false });
  if (opts.tiers) q = q.in("filing_analysis.tier", opts.tiers);
  const want = opts.limit ?? 5000;
  const rows = (await all((a, b) => q.range(a, Math.min(b, want - 1)), "feed", want)) as unknown as {
    id: number; symbol: string; subject: string; filed_at: string; attachment_url: string | null; raw?: Record<string, unknown>;
    filing_analysis: { tier: FilingTier; score: number; reasons: string[]; headline: string; sub_kind: string | null; category: string; event_id: number | null } | { tier: FilingTier; score: number; reasons: string[]; headline: string; sub_kind: string | null; category: string; event_id: number | null }[];
  }[];
  return rows.map((r) => {
    const a = Array.isArray(r.filing_analysis) ? r.filing_analysis[0]! : r.filing_analysis;
    return {
      filing_id: r.id,
      event_id: a.event_id ?? -r.id,
      symbol: r.symbol,
      tier: a.tier,
      score: a.score,
      headline: a.headline,
      reasons: a.reasons,
      filed_at: ist(r.filed_at),
      sub_kind: a.sub_kind,
      category: a.category,
      subject: r.subject,
      attachment_url: r.attachment_url,
      raw: r.raw ?? null,
    };
  });
}

export async function eventPrimaries(ctx: ApiCtx, ids: number[]): Promise<Map<number, number>> {
  const real = [...new Set(ids.filter((i) => i > 0))];
  if (real.length === 0) return new Map();
  const rows = must(await ctx.db.from("events").select("id, primary_filing_id").in("id", real), "events") as { id: number; primary_filing_id: number }[];
  return new Map(rows.map((r) => [r.id, r.primary_filing_id]));
}

/** Filing sub-kinds the user muted (latest feedback per sub-kind wins). */
export async function mutedKinds(ctx: ApiCtx): Promise<Set<string>> {
  const rows = must(
    await ctx.db.from("feedback").select("action, sub_kind, created_at").eq("portfolio_id", ctx.env.portfolioId).in("action", ["mute_kind", "unmute_kind"]).order("created_at", { ascending: true }),
    "feedback",
  ) as { action: string; sub_kind: string }[];
  const s = new Set<string>();
  for (const r of rows) r.action === "mute_kind" ? s.add(r.sub_kind) : s.delete(r.sub_kind);
  return s;
}

export async function prices(ctx: ApiCtx, symbols: string[], days = 130) {
  if (symbols.length === 0) return new Map<string, { date: string; close: number; volume: number }[]>();
  const since = new Date(ctx.deps.clock.now().getTime() - days * 864e5).toISOString().slice(0, 10);
  const rows = (await all(
    (a, b) => ctx.db.from("prices_daily").select("symbol, date, close, volume").in("symbol", symbols).gte("date", since).order("date", { ascending: true }).order("symbol").range(a, b),
    "prices",
  )) as { symbol: string; date: string; close: string | number; volume: string | number }[];
  const m = new Map<string, { date: string; close: number; volume: number }[]>();
  for (const r of rows) m.set(r.symbol, [...(m.get(r.symbol) ?? []), { date: r.date, close: Number(r.close), volume: Number(r.volume) }]);
  return m;
}

export interface RecordView {
  statements: GuidanceStatement[];
  verdicts: Verdict[];
  credibility: ReturnType<typeof credibilityLine>;
}

export async function records(ctx: ApiCtx, symbols: string[]): Promise<Map<string, RecordView>> {
  const out = new Map<string, RecordView>();
  if (symbols.length === 0) return out;
  const st = (must(await ctx.db.from("guidance_statements").select("*").in("symbol", symbols), "guidance") as Parameters<typeof fromGuidanceRow>[0][]).map(fromGuidanceRow);
  const ids = st.map((s) => s.id);
  const vs = ids.length ? (must(await ctx.db.from("verdicts").select("*").in("statement_id", ids), "verdicts") as Verdict[]) : [];
  for (const sym of symbols) {
    const s = st.filter((x) => x.symbol === sym);
    const v = vs.filter((x) => s.some((y) => y.id === x.statement_id)).map((x) => ({ ...x, as_of: ist(x.as_of) as IstDateTime }));
    out.set(sym, { statements: s, verdicts: v, credibility: credibilityLine(s, v) });
  }
  return out;
}

export async function governance(ctx: ApiCtx, symbols: string[]) {
  const now = ctx.deps.clock.now();
  const out = new Map<string, ReturnType<typeof computeGovernanceStrip>>();
  if (symbols.length === 0) return out;
  const rows = (await all(
    (a, b) => ctx.db.from("filings").select("id, symbol, subject, exch_category, filed_at").in("symbol", symbols).gte("filed_at", new Date(now.getTime() - 365 * 864e5).toISOString()).is("duplicate_of", null).order("id").range(a, b),
    "governance filings",
  )) as { id: number; symbol: string; subject: string; exch_category: string; filed_at: string }[];
  const filings = rows.map((r) => ({ ...r, filed_at: ist(r.filed_at) }));
  for (const s of symbols) out.set(s, computeGovernanceStrip(s, filings, { as_of: now }));
  return out;
}

/** The mandate line: house-view exclusion first, then the annual-report check from research. */
export async function mandate(ctx: ApiCtx, symbols: string[]): Promise<Map<string, { status: "excluded" | "breach" | "clean" | "not_checked"; line: string }>> {
  const hv = await houseView(ctx);
  const snaps = symbols.length
    ? (must(await ctx.db.from("research_snapshots").select("symbol, sections").in("symbol", symbols), "snapshots") as { symbol: string; sections: { mandate?: { clean: boolean; line: string } } }[])
    : [];
  const out = new Map<string, { status: "excluded" | "breach" | "clean" | "not_checked"; line: string }>();
  for (const s of symbols) {
    const m = snaps.find((x) => x.symbol === s)?.sections?.mandate;
    out.set(
      s,
      hv.excluded_symbols.includes(s)
        ? { status: "excluded", line: "On your exclusion list" }
        : m
          ? { status: m.clean ? "clean" : "breach", line: m.line }
          : { status: "not_checked", line: "Segment note not checked yet" },
    );
  }
  return out;
}

const STRIP_GLYPH: Record<Verdict["verdict"], string> = { met: "✓", missed: "✕", revised: "↻", too_early: "◷", behind: "!", not_measurable: "–", not_mentioned_since: "–" };
const STRIP_WORD: Record<Verdict["verdict"], string> = { met: "met", missed: "missed", revised: "revised", too_early: "too early", behind: "behind", not_measurable: "not measurable", not_mentioned_since: "not mentioned since" };

/**
 * The record strip: one glyph per guidance thread (latest statement), oldest target first,
 * the last six shown. Empty when nothing has been scored.
 */
export function recordStrip(rec: RecordView | undefined): { marks: { verdict: Verdict["verdict"]; glyph: string }[]; line: string; label: string } | null {
  if (!rec || rec.verdicts.length === 0) return null;
  const byId = new Map(rec.verdicts.map((v) => [v.statement_id, v]));
  const scored = rec.statements
    .filter((s) => byId.has(s.id))
    .sort((a, b) => (a.period_target ?? "").localeCompare(b.period_target ?? "") || a.call_period.localeCompare(b.call_period))
    .map((s) => byId.get(s.id)!.verdict)
    .slice(-6);
  if (scored.length === 0) return null;
  const marks = scored.map((v) => ({ verdict: v, glyph: STRIP_GLYPH[v] }));
  const counts = new Map<string, number>();
  for (const v of scored) counts.set(STRIP_WORD[v], (counts.get(STRIP_WORD[v]) ?? 0) + 1);
  const label = `${rec.credibility.line}. Last ${scored.length} targets: ${[...counts].map(([w, n]) => `${n} ${w}`).join(", ")}.`;
  return { marks, line: rec.credibility.line, label };
}
