import { PoliteHttp } from "../http/polite";
import { describeError, runIngest, type RunOutcome } from "../ingest/run";
import type { CompanyRef, CoreDeps, FilingRow } from "../ports";
import { toIst } from "../time";
import { BseClient, normalizeBse } from "./bse";
import { NseBlockedError, NseClient, normalizeNse } from "./nse";
import type { NormalizeResult } from "./normalize";
import { ingestFilings, type PipelineReport } from "../pipeline/index";

export interface AnnouncementsSummary {
  nse: RunOutcome<SourceTally> | null;
  bse: RunOutcome<SourceTally> | null;
  /** Companies we could not get from either exchange. */
  missed: string[];
}

export interface SourceTally {
  fetched: number;
  inserted: number;
  /** What the triage pipeline did with this batch. */
  pipeline: PipelineReport | null;
  skipped: { symbol: string; reason: string }[];
  failed: { symbol: string; error: string }[];
}

/**
 * NSE first. If NSE blocks us (403, challenge page) the remaining companies go to BSE by
 * scrip code. Each exchange is its own ingest_runs row, so /health shows NSE failing even
 * when BSE saved the day.
 */
export async function fetchAnnouncements(
  deps: CoreDeps,
  companies: CompanyRef[],
  window: { from: Date; to: Date },
): Promise<AnnouncementsSummary> {
  // NSE: short timeout and no blind retries. A stalled NSE request is a block, and the
  // client already re-handshakes once; retrying a tarpit would cost minutes per company.
  const nseHttp = new PoliteHttp(deps.http, deps.clock, deps.log, { timeoutMs: 10_000, maxAttempts: 1 }, deps.random);
  const nse = new NseClient(nseHttp, deps.log);
  const forBse: CompanyRef[] = [];

  const nseRun = await runIngest(deps, "nse", async () => {
    const t = tally();
    const rows: FilingRow[] = [];
    let blocked: string | null = null;
    let succeeded = 0;
    for (const c of companies) {
      if (blocked) {
        forBse.push(c);
        continue;
      }
      try {
        const raw = await nse.announcements(c.symbol, window.from, window.to);
        await collect(raw, (r) => normalizeNse(deps.hash, c.symbol, r), c.symbol, rows, t);
        succeeded++;
      } catch (err) {
        if (err instanceof NseBlockedError) blocked = err.message;
        else t.failed.push({ symbol: c.symbol, error: describeError(err) });
        forBse.push(c);
      }
    }
    // Nothing came back from NSE at all: that is a failed run, whatever the reason.
    if (succeeded === 0 && companies.length > 0) {
      throw new NseBlockedError((blocked ?? t.failed[0]?.error ?? "no data").replace(/^NSE blocked the request: /, ""));
    }
    t.pipeline = await ingestFilings(deps, rows);
    t.inserted = t.pipeline.inserted;
    return {
      rows: t.inserted,
      partial: note(t, blocked ? `blocked after ${companies.length - forBse.length} of ${companies.length} companies` : null),
      cursor: toIst(window.to),
      result: t,
    };
  });

  let bseRun: RunOutcome<SourceTally> | null = null;
  const noCode = forBse.filter((c) => !c.bse_code).map((c) => c.symbol);
  const viaBse = forBse.filter((c) => c.bse_code);
  if (viaBse.length > 0) {
    deps.log.warn(`falling back to BSE for ${viaBse.length} companies`);
    const bse = new BseClient(new PoliteHttp(deps.http, deps.clock, deps.log, {}, deps.random));
    bseRun = await runIngest(deps, "bse", async () => {
      const t = tally();
      const rows: FilingRow[] = [];
      for (const c of viaBse) {
        try {
          const raw = await bse.announcements(c.bse_code!, window.from, window.to);
          await collect(raw, (r) => normalizeBse(deps.hash, c.symbol, r), c.symbol, rows, t);
        } catch (err) {
          t.failed.push({ symbol: c.symbol, error: describeError(err) });
        }
      }
      if (rows.length === 0 && t.failed.length === viaBse.length) {
        throw new Error(`BSE failed for every company: ${t.failed[0]?.error}`);
      }
      t.pipeline = await ingestFilings(deps, rows);
    t.inserted = t.pipeline.inserted;
      return { rows: t.inserted, partial: note(t, null), cursor: toIst(window.to), result: t };
    });
  }

  const bseFailed = bseRun?.ok ? bseRun.result.failed.map((f) => f.symbol) : viaBse.map((c) => c.symbol);
  const missed = [...noCode, ...bseFailed];
  if (missed.length) deps.log.warn("no announcements from either exchange", { symbols: missed });
  return { nse: nseRun, bse: bseRun, missed };
}

function tally(): SourceTally {
  return { fetched: 0, inserted: 0, pipeline: null, skipped: [], failed: [] };
}

async function collect(
  raw: unknown[],
  normalize: (r: unknown) => Promise<NormalizeResult>,
  symbol: string,
  rows: FilingRow[],
  t: SourceTally,
): Promise<void> {
  t.fetched += raw.length;
  for (const r of raw) {
    const n = await normalize(r);
    if (n.ok) rows.push(n.filing);
    else t.skipped.push({ symbol, reason: n.reason });
  }
}

function note(t: SourceTally, extra: string | null): string | null {
  const parts = [
    extra,
    t.failed.length ? `failed: ${t.failed.map((f) => f.symbol).join(", ")}` : null,
    t.skipped.length ? `${t.skipped.length} records skipped as unparseable` : null,
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : null;
}
