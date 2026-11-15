import type { IstDateTime } from "@finn/shared";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Format an instant as an absolute IST timestamp: 2026-11-14T16:42:05+05:30 */
export function toIst(d: Date): IstDateTime {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS).toISOString(); // wall-clock IST, labelled Z
  return `${shifted.slice(0, 19)}+05:30`;
}

/** IST calendar date (YYYY-MM-DD) of an instant. */
export function istDate(d: Date): string {
  return toIst(d).slice(0, 10);
}

/** DD-MM-YYYY in IST, the format NSE's API expects. */
export function nseDate(d: Date): string {
  const [y, m, day] = istDate(d).split("-");
  return `${day}-${m}-${y}`;
}

/** YYYYMMDD in IST, the format BSE's API expects. */
export function bseDate(d: Date): string {
  return istDate(d).replaceAll("-", "");
}

function istWallClock(y: number, mo: number, d: number, h: number, mi: number, s: number): IstDateTime | null {
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h <= 23 && mi <= 59 && s <= 59)) return null;
  // Round-trip through Date to reject impossible dates like 31-Feb.
  const utc = Date.UTC(y, mo - 1, d, h, mi, s) - IST_OFFSET_MS;
  const back = toIst(new Date(utc));
  const expected = `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}+05:30`;
  return back === expected ? back : null;
}

/**
 * Parse exchange timestamps, which are IST wall-clock times with no offset:
 *   "14-Nov-2026 16:42:05"     (NSE an_dt)
 *   "2026-11-14 16:42:05"      (NSE sort_date)
 *   "2026-11-14T16:42:05.123"  (BSE DT_TM / News_submission_dt)
 * Returns null if unparseable. Never guesses a timezone.
 */
export function parseExchangeIst(raw: unknown): IstDateTime | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  let m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) {
    const mo = MONTHS[m[2]!.toLowerCase()];
    if (!mo) return null;
    return istWallClock(+m[3]!, mo, +m[1]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
  }
  m = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(s);
  if (m) return istWallClock(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
  return null;
}

/** Milliseconds since epoch for an IST timestamp produced by this module. */
export function istToEpochMs(ts: IstDateTime): number {
  return Date.parse(ts);
}

/**
 * Indian fiscal period for a month-end column label like "Sep 2025".
 * Apr–Jun = Q1, Jul–Sep = Q2, Oct–Dec = Q3, Jan–Mar = Q4; FY27 runs Apr 2026 – Mar 2027.
 */
export function fiscalQuarter(label: string): string | null {
  const m = /^([A-Za-z]{3})\s+(\d{4})$/.exec(label.trim());
  if (!m) return null;
  const mo = MONTHS[m[1]!.toLowerCase()];
  if (!mo) return null;
  const y = +m[2]!;
  const fy = mo >= 4 ? y + 1 : y;
  const q = mo >= 4 ? Math.ceil((mo - 3) / 3) : 4;
  return `Q${q}FY${pad(fy % 100)}`;
}

/** Fiscal year for an annual column label: "Mar 2025" → FY25. Null for non-March year ends. */
export function fiscalYear(label: string): string | null {
  const q = fiscalQuarter(label);
  return q?.startsWith("Q4") ? q.slice(2) : null;
}
