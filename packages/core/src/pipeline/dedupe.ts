import type { IstDateTime } from "@finn/shared";
import { istToEpochMs } from "../time";
import { overlap, signals, tokens } from "./text";

export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
/** Share of the shorter subject's words that must appear in the other (cross-exchange only). */
const MIN_OVERLAP = 0.8;
const MIN_TOKENS = 3;

export interface DedupeItem {
  /** Database id if stored, otherwise a batch-local key. */
  ref: number | string;
  symbol: string;
  exchange: "NSE" | "BSE";
  subject: string;
  subject_hash: string | null;
  filed_at: IstDateTime;
}

export interface DuplicateMatch {
  original: DedupeItem;
  reason: string;
}

/**
 * Is `f` a repeat of one of `originals` (same company, within ±10 minutes)?
 *   1. Same subject hash (canonical subject, boilerplate stripped): duplicate, any exchange.
 *   2. Different exchange, same action words (resignation ≠ appointment), and ≥ 80% of the
 *      shorter subject's words in the longer one: duplicate. NSE and BSE word the same
 *      disclosure differently, so an exact hash alone misses most cross-listings.
 * The earliest qualifying filing is the original.
 */
export function findDuplicate(f: DedupeItem, originals: DedupeItem[]): DuplicateMatch | null {
  const t = istToEpochMs(f.filed_at);
  const near = originals
    .filter((o) => o.symbol === f.symbol && o.ref !== f.ref && Math.abs(istToEpochMs(o.filed_at) - t) <= DUPLICATE_WINDOW_MS)
    .sort((a, b) => a.filed_at.localeCompare(b.filed_at));
  if (near.length === 0) return null;

  const minutes = (o: DedupeItem) => Math.round(Math.abs(t - istToEpochMs(o.filed_at)) / 60000);
  const when = (o: DedupeItem) => (minutes(o) === 0 ? "within a minute" : `${minutes(o)} min apart`);

  for (const o of near) {
    if (f.subject_hash && o.subject_hash === f.subject_hash) {
      return { original: o, reason: `Same disclosure as ${o.exchange} filing (${when(o)})` };
    }
  }

  const ft = tokens(f.subject);
  const fs = signals(f.subject);
  for (const o of near) {
    if (o.exchange === f.exchange) continue;
    const ot = tokens(o.subject);
    if (Math.min(ft.size, ot.size) < MIN_TOKENS) continue;
    if (signals(o.subject) !== fs) continue;
    if (overlap(ft, ot) >= MIN_OVERLAP) {
      return { original: o, reason: `Same disclosure as ${o.exchange} filing (${when(o)}), worded differently` };
    }
  }
  return null;
}
