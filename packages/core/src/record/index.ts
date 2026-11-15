import type { GuidanceStatement, Verdict } from "@finn/shared";
import { runIngest, type RunOutcome } from "../ingest/run";
import type { CompanyRef, CoreDeps } from "../ports";
import { extractDocument } from "../sources/documents";
import { fetchScreener } from "../sources/screener";
import { toIst } from "../time";
import { ActualsBook } from "./actuals";
import { diffCalls, type ConcallCard } from "./diff";
import { extractGuidance, processExtraction, stableUuid, type Dropped } from "./extract";
import { quarterOrdinal } from "./periods";
import { computeVerdicts, credibilityLine } from "./verdict";

export interface RecordSnapshot {
  statements: GuidanceStatement[];
  verdicts: Verdict[];
  credibility: { met: number; due: number; line: string };
}

/** Recompute every verdict for a company from what is stored, and save them. Deterministic. */
export async function recomputeRecord(deps: CoreDeps, symbol: string): Promise<RecordSnapshot> {
  let rows = await deps.store.listActuals(symbol);
  if (!rows.some((r) => r.source === "screener")) {
    await fetchScreener(deps, symbol);
    rows = await deps.store.listActuals(symbol);
  }
  const statements = await deps.store.listGuidance(symbol);
  const verdicts = computeVerdicts(statements, {
    calls: await deps.store.listCalls(symbol),
    actuals: new ActualsBook(rows),
    as_of: toIst(deps.clock.now()),
  });
  await deps.store.upsertVerdicts(verdicts);
  return { statements, verdicts, credibility: credibilityLine(statements, verdicts) };
}

export interface TranscriptReport {
  kept: number;
  dropped: Dropped[];
  reported: number;
  card: ConcallCard;
}

/**
 * New earnings call transcript → stored text → guidance extracted by the mid-tier model →
 * every quote verified against its page → statements and reported figures stored → all of the
 * company's verdicts recomputed → concall card (diff against the previous call + credibility).
 */
export async function processTranscript(
  deps: CoreDeps,
  job: { company: CompanyRef; url: string; call_period: string },
): Promise<RunOutcome<TranscriptReport>> {
  const symbol = job.company.symbol;
  return runIngest<TranscriptReport>(deps, "guidance", async () => {
    const doc = await extractDocument(deps, { symbol, type: "transcript", period: job.call_period, url: job.url });
    if (!doc.ok) throw new Error(`transcript download failed: ${(doc as any).error}`);
    const sha = doc.result.sha256;
    const pages = await deps.store.getDocumentText(sha);
    if (!pages) throw new Error("transcript has no readable text (scan?)");
    if (!deps.llm) throw new Error("guidance extraction needs the mid-tier model, which is not configured");

    const { data } = await extractGuidance(deps.llm, pages);
    const doc_id = await stableUuid(deps.hash, `doc|${sha}`);
    const p = await processExtraction(data, pages, { symbol, doc_id, call_period: job.call_period, hash: deps.hash });
    await deps.store.upsertGuidance(p.statements);
    const actualsMap = new Map<string, Parameters<typeof deps.store.upsertActuals>[0][number]>();
    for (const r of p.reported) {
      const key = `${symbol}|${r.period}|${r.metric}|consolidated`;
      actualsMap.set(key, {
        symbol,
        period: r.period,
        metric: r.metric,
        basis: "consolidated" as const,
        value: r.value,
        unit: r.unit === "pct" || r.unit === "inr_cr" ? r.unit : ("other" as const),
        source: "transcript" as const,
      });
    }
    await deps.store.upsertActuals(Array.from(actualsMap.values()));
    for (const d of p.dropped) deps.log.warn("guidance: statement dropped", { symbol, page: d.page, reason: d.reason });

    const snap = await recomputeRecord(deps, symbol);
    const calls = [...new Set(await deps.store.listCalls(symbol))].sort((a, b) => quarterOrdinal(a) - quarterOrdinal(b));
    const previous = calls.filter((c) => quarterOrdinal(c) < quarterOrdinal(job.call_period)).at(-1) ?? null;
    const card: ConcallCard = {
      symbol,
      call_period: job.call_period,
      previous_call: previous,
      items: diffCalls(
        snap.statements.filter((s) => s.call_period === previous),
        snap.statements.filter((s) => s.call_period === job.call_period),
        job.call_period,
      ),
      credibility: snap.credibility.line,
    };
    return {
      rows: p.statements.length,
      partial: p.dropped.length ? `${p.dropped.length} statement(s) dropped: quote not verified or malformed` : null,
      result: { kept: p.statements.length, dropped: p.dropped, reported: p.reported.length, card },
    };
  });
}
