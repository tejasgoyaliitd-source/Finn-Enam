import { FilingAnalysis, type FilingTier } from "@finn/shared";
import type { AnalysisRow, CoreDeps, FilingRow, NewFilingRow } from "../ports";
import { istToEpochMs } from "../time";
import { detectAlwaysAct } from "./always-act";
import { checkMandateBreachInFiling } from "../governance/mandate";
import { classify } from "./classify";
import { findDuplicate, type DedupeItem } from "./dedupe";
import { groupFilings, familyOf, type GroupMember, type OpenEvent } from "./group";
import { acceptableHeadline, HEADLINE_PROMPT_VERSION, HEADLINE_SYSTEM, HeadlineOutput, templateHeadline } from "./headline";
import { scoreFiling } from "./score";

const LOOKBACK_MS = 48 * 60 * 60 * 1000; // covers the 36 h results window and the 10 min dedupe window

export interface PipelineReport {
  received: number;
  /** Same exchange record seen before (re-poll): nothing done. */
  already_had: number;
  inserted: number;
  duplicates: { symbol: string; exchange: string; reason: string }[];
  tiers: Record<FilingTier, number>;
  methods: { rule: number; model: number; fallback: number };
  events_created: number;
  always_act: { symbol: string; headline: string; reasons: string[] }[];
  /** New results filings, handed to the results engine (results/index.ts). */
  results_filings: { filing_id: number; symbol: string; filed_at: string; attachment_url: string | null }[];
}

/**
 * The push pipeline for newly fetched filings:
 *   dedupe → insert → classify (rules, then model) → always-Act → tier + score → headline → group
 * Each filing is analysed exactly once, when first inserted, so its headline is generated
 * once and kept with its id (filing_analysis). Duplicates are stored and linked, never analysed.
 */
export async function ingestFilings(deps: CoreDeps, rows: FilingRow[]): Promise<PipelineReport> {
  const report: PipelineReport = {
    received: rows.length,
    already_had: 0,
    inserted: 0,
    duplicates: [],
    tiers: { act: 0, read: 0, routine: 0 },
    methods: { rule: 0, model: 0, fallback: 0 },
    events_created: 0,
    always_act: [],
    results_filings: [],
  };
  if (rows.length === 0) return report;

  const symbols = [...new Set(rows.map((r) => r.symbol))];
  const earliest = Math.min(...rows.map((r) => istToEpochMs(r.filed_at)));
  const recent = await deps.store.recentFilings(symbols, new Date(earliest - LOOKBACK_MS));
  const known = new Set(recent.map((r) => r.dedupe_key));

  // Same record within this batch, or already stored: skip.
  const seen = new Set<string>();
  const fresh = rows
    .filter((r) => {
      if (known.has(r.dedupe_key) || seen.has(r.dedupe_key)) return false;
      seen.add(r.dedupe_key);
      return true;
    })
    .sort((a, b) => a.filed_at.localeCompare(b.filed_at));
  report.already_had = rows.length - fresh.length;

  // ── 1. Dedupe: link repeats to their original ──────────────────────────────
  const originals: DedupeItem[] = recent
    .filter((r) => r.duplicate_of === null)
    .map((r) => ({ ref: r.id, symbol: r.symbol, exchange: r.exchange, subject: r.subject, subject_hash: r.subject_hash, filed_at: r.filed_at }));
  const keep: FilingRow[] = [];
  const dups: { row: FilingRow; originalRef: number | string; reason: string }[] = [];
  for (const r of fresh) {
    const item: DedupeItem = { ref: r.dedupe_key, symbol: r.symbol, exchange: r.exchange, subject: r.subject, subject_hash: r.subject_hash, filed_at: r.filed_at };
    const match = findDuplicate(item, originals);
    if (match) {
      dups.push({ row: r, originalRef: match.original.ref, reason: match.reason });
    } else {
      keep.push(r);
      originals.push(item);
    }
  }

  const insertedOriginals = await deps.store.insertFilings(keep.map((r) => ({ ...r, duplicate_of: null })));
  const idOf = new Map<string | number, number>(insertedOriginals.map((r) => [r.dedupe_key, r.id]));
  const dupRows: NewFilingRow[] = [];
  for (const d of dups) {
    const id = typeof d.originalRef === "number" ? d.originalRef : idOf.get(d.originalRef);
    if (id === undefined) continue; // original was skipped by the store (raced in elsewhere)
    dupRows.push({ ...d.row, duplicate_of: id });
    report.duplicates.push({ symbol: d.row.symbol, exchange: d.row.exchange, reason: d.reason });
  }
  const insertedDups = await deps.store.insertFilings(dupRows);
  report.inserted = insertedOriginals.length + insertedDups.length;

  // ── 2–4. Classify, always-Act, tier + score, headline ─────────────────────
  const weights = await deps.store.positionWeights(deps.portfolioId);
  const analysed: (AnalysisRow & { subject: string; symbol: string; filed_at: string })[] = [];
  for (const r of keep) {
    const filing_id = idOf.get(r.dedupe_key);
    if (filing_id === undefined) continue;

    const cls = await classify(r, deps.llm, deps.log);
    const act = detectAlwaysAct(r.exch_category, r.subject);
    // An acquisition into an excluded business is a mandate breach: always Act.
    const breach = checkMandateBreachInFiling(r);
    if (breach.is_breach) act.triggers.push({ id: "mandate_breach", reason: breach.reason! });
    const rotation = act.rotation;
    const s = scoreFiling({ category: cls.category, sub_kind: cls.sub_kind, routine: cls.routine, triggers: act.triggers, rotation, weight: weights[r.symbol] ?? 0 });
    if (cls.note && cls.method === "fallback") s.reasons.push(`${cls.note}; classified without the model`);

    const fallbackHeadline = templateHeadline({ subject: r.subject, exch_category: r.exch_category, category: cls.category, sub_kind: cls.sub_kind, triggers: act.triggers, rotation });
    const headline = s.tier === "routine" ? fallbackHeadline : await modelHeadline(deps, r, fallbackHeadline);

    report.methods[cls.method]++;
    report.tiers[s.tier]++;
    if (act.triggers.length) report.always_act.push({ symbol: r.symbol, headline, reasons: s.reasons });
    if (cls.sub_kind === "results") report.results_filings.push({ filing_id, symbol: r.symbol, filed_at: r.filed_at, attachment_url: r.attachment_url });
    analysed.push({
      filing_id,
      category: cls.category,
      sub_kind: cls.sub_kind,
      tier: s.tier,
      score: s.score,
      reasons: s.reasons,
      headline,
      method: cls.method,
      model: cls.model,
      event_id: null,
      subject: r.subject,
      symbol: r.symbol,
      filed_at: r.filed_at,
    });
  }

  // ── 5. Group into events ───────────────────────────────────────────────────
  const existing = await loadOpenEvents(deps, symbols, new Date(earliest - LOOKBACK_MS), recent);
  const members: GroupMember[] = analysed.map((a) => ({
    id: a.filing_id, symbol: a.symbol, filed_at: a.filed_at as GroupMember["filed_at"], category: a.category, sub_kind: a.sub_kind, subject: a.subject,
  }));
  const events = groupFilings(members, existing);
  const eventOf = new Map<number, number>();
  for (const e of events) {
    if (e.id === null) {
      e.id = await deps.store.createEvent({ symbol: e.symbol, kind: e.kind, primary_filing_id: e.primary.id, filed_at: e.primary.filed_at });
      report.events_created++;
    } else if (e.promoted) {
      await deps.store.setEventPrimary(e.id, e.primary.id, e.primary.filed_at);
    }
    for (const m of e.members) eventOf.set(m.id, e.id);
  }

  const out: AnalysisRow[] = analysed.map(({ subject: _s, symbol: _y, filed_at: _f, ...a }) =>
    FilingAnalysis.parse({ ...a, event_id: eventOf.get(a.filing_id) ?? null }),
  );
  await deps.store.upsertAnalyses(out);
  return report;
}

async function modelHeadline(deps: CoreDeps, r: FilingRow, fallback: string): Promise<string> {
  if (!deps.llm) return fallback;
  try {
    const { data } = await deps.llm.run({
      task: "rewrite_headline",
      tier: "cheap",
      promptVersion: HEADLINE_PROMPT_VERSION,
      system: HEADLINE_SYSTEM,
      input: `Exchange category: ${r.exch_category}\nSubject: ${r.subject}`,
      schema: HeadlineOutput,
    });
    const h = data.headline.trim().replace(/\.$/, "");
    if (acceptableHeadline(h)) return h;
    deps.log.warn("headline: model output rejected, using template", { symbol: r.symbol, headline: h });
  } catch (err) {
    deps.log.warn("headline: model failed, using template", { symbol: r.symbol, error: String(err) });
  }
  return fallback;
}

/** Events already in the database that new filings may still join. */
async function loadOpenEvents(deps: CoreDeps, symbols: string[], since: Date, recent: Awaited<ReturnType<CoreDeps["store"]["recentFilings"]>>): Promise<OpenEvent[]> {
  const rows = await deps.store.recentEvents(symbols, since);
  const toMember = (f: (typeof recent)[number]): GroupMember | null =>
    f.analysis ? { id: f.id, symbol: f.symbol, filed_at: f.filed_at, category: f.analysis.category, sub_kind: f.analysis.sub_kind, subject: f.subject } : null;
  return rows.flatMap((e) => {
    const p = recent.find((f) => f.id === e.primary_filing_id);
    const primary = p && toMember(p);
    if (!primary) return [];
    const members = recent.filter((f) => f.analysis?.event_id === e.id).map(toMember).filter((m): m is GroupMember => m !== null);
    return [{ id: e.id, handle: `db-${e.id}`, symbol: e.symbol, kind: e.kind, family: familyOf(primary), primary, members, promoted: false }];
  });
}
