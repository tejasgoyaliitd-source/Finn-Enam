const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
};

/**
 * The meeting date in a board-meeting intimation ("scheduled on 14/11/2026", "on Friday,
 * November 14, 2026", "14th November, 2026"). Only dates on or after the filing date count.
 * Deterministic; the tier-1 "read_meeting_date" task is only needed when this finds nothing.
 */
export function parseMeetingDate(subject: string, filedAt: string): string | null {
  const filed = filedAt.slice(0, 10);
  const found: string[] = [];
  const s = subject.replace(/\s+/g, " ");
  for (const m of s.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/g)) found.push(iso(+m[3]!, +m[2]!, +m[1]!) ?? "");
  for (const m of s.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*\.?,?\s+(20\d{2})\b/g)) {
    const mo = MONTHS[m[2]!.toLowerCase()];
    if (mo) found.push(iso(+m[3]!, mo, +m[1]!) ?? "");
  }
  for (const m of s.matchAll(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/g)) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    if (mo) found.push(iso(+m[3]!, mo, +m[2]!) ?? "");
  }
  return found.filter((d) => d && d >= filed).sort()[0] ?? null;
}
