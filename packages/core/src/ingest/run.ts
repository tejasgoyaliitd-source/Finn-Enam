import type { CoreDeps, IngestSource, IngestStatus } from "../ports";

export interface RunBody<T> {
  rows: number;
  /** Set when some items failed but the run produced data (e.g. 2 of 18 symbols failed). */
  partial?: string | null;
  cursor?: string | null;
  result: T;
}

export type RunOutcome<T> =
  | { ok: true; status: Exclude<IngestStatus, "failed">; rows: number; note: string | null; result: T }
  | { ok: false; status: "failed"; rows: 0; error: string };

/**
 * Every source goes through this, so ingest_runs always records start, finish, row count and
 * the error. A failing source never throws past here: callers get a RunOutcome and carry on
 * with the next source. If logging the run itself fails, that error does propagate, because
 * /health would otherwise lie.
 */
export async function runIngest<T>(
  deps: Pick<CoreDeps, "store" | "log" | "runner">,
  source: IngestSource,
  body: () => Promise<RunBody<T>>,
): Promise<RunOutcome<T>> {
  const id = await deps.store.startRun(source, deps.runner);
  deps.log.info(`${source}: started`, { run_id: id });
  try {
    const r = await body();
    const status = r.partial ? "partial" : "ok";
    await deps.store.finishRun(id, { status, rows_ingested: r.rows, error: r.partial ?? null, cursor: r.cursor ?? null });
    deps.log.info(`${source}: ${status}`, { run_id: id, rows: r.rows, ...(r.partial ? { note: r.partial } : {}) });
    return { ok: true, status, rows: r.rows, note: r.partial ?? null, result: r.result };
  } catch (err) {
    const error = describeError(err);
    await deps.store.finishRun(id, { status: "failed", rows_ingested: 0, error });
    deps.log.error(`${source}: failed`, { run_id: id, error });
    return { ok: false, status: "failed", rows: 0, error };
  }
}

export function describeError(err: unknown): string {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return msg.slice(0, 4000);
}
