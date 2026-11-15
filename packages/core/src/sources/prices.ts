import { describeError, runIngest, type RunOutcome } from "../ingest/run";
import type { ChartClient, ChartQuote, CoreDeps, PriceRow } from "../ports";
import { istDate, toIst } from "../time";

/** 60-session volatility needs 61 closes; we keep 120 for headroom and the 20-day volume average. */
export const MIN_SESSIONS = 120;
/** ~270 calendar days ≈ 180 NSE sessions: comfortably over 120 after holidays and suspensions. */
const LOOKBACK_DAYS = 270;
/** NSE closes 15:30 IST; a bar for today before 16:00 may be intraday and is dropped. */
const SETTLED_AFTER_IST = "16:00";
const GAP_BETWEEN_SYMBOLS_MS = 300;

export const yahooSymbol = (nseSymbol: string) => `${nseSymbol}.NS`;

/** Clean Yahoo's daily bars into one row per IST trading date. Pure; exported for tests. */
export function normalizeQuotes(symbol: string, quotes: ChartQuote[], now: Date): PriceRow[] {
  const today = istDate(now);
  const settled = toIst(now).slice(11, 16) >= SETTLED_AFTER_IST;
  const byDate = new Map<string, PriceRow>();
  for (const q of quotes) {
    if (q.close === null || q.volume === null || !(q.close > 0) || !(q.volume >= 0)) continue;
    const date = istDate(q.date);
    if (date > today || (date === today && !settled)) continue;
    byDate.set(date, { symbol, date, close: q.close, volume: Math.round(q.volume) });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface PricesSummary {
  sessions: Record<string, number>;
  short: string[];
  failed: { symbol: string; error: string }[];
}

export async function fetchPrices(
  deps: CoreDeps & { chart: ChartClient },
  symbols: string[],
): Promise<RunOutcome<PricesSummary>> {
  return runIngest(deps, "yahoo", async () => {
    const now = deps.clock.now();
    const from = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
    const s: PricesSummary = { sessions: {}, short: [], failed: [] };
    const rows: PriceRow[] = [];

    for (const [i, symbol] of symbols.entries()) {
      if (i > 0) await deps.clock.sleep(GAP_BETWEEN_SYMBOLS_MS);
      try {
        const clean = normalizeQuotes(symbol, await deps.chart.daily(yahooSymbol(symbol), from, now), now);
        s.sessions[symbol] = clean.length;
        if (clean.length < MIN_SESSIONS) s.short.push(`${symbol} (${clean.length})`);
        rows.push(...clean);
      } catch (err) {
        s.failed.push({ symbol, error: describeError(err) });
      }
    }
    if (rows.length === 0 && symbols.length > 0) {
      throw new Error(`No prices for any symbol: ${s.failed[0]?.error ?? "empty responses"}`);
    }

    const written = await deps.store.upsertPrices(rows);
    const partial = [
      s.failed.length ? `failed: ${s.failed.map((f) => f.symbol).join(", ")}` : null,
      s.short.length ? `under ${MIN_SESSIONS} sessions: ${s.short.join(", ")}` : null,
    ].filter(Boolean);
    return { rows: written, partial: partial.length ? partial.join("; ") : null, result: s };
  });
}
