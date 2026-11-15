/** Number and time formatting. Indian grouping, true minus signs, IST, absolute times only. */

export const MINUS = "−";

const group = (n: number, digits: number) =>
  Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** "−9.7%", "+2.1%", "0%". A true minus, never a hyphen. */
export function signedPct(n: number, digits = 1): string {
  if (n === 0) return "0%";
  return `${n < 0 ? MINUS : "+"}${group(n, digits)}%`;
}

/** "₹1,988 cr", "−₹280 cr". */
export function crore(n: number, digits = 0): string {
  return `${n < 0 ? MINUS : ""}₹${group(n, digits)} cr`;
}

/** Plain number with Indian grouping and a true minus. */
export function num(n: number, digits = 0): string {
  return `${n < 0 ? MINUS : ""}${group(n, digits)}`;
}

/** Replace ASCII hyphen-minus in front of digits (from API strings) with a true minus. */
export const trueMinus = (s: string) => s.replace(/(^|[\s(])-(?=[₹\d])/g, `$1${MINUS}`);

const IST = "Asia/Kolkata";

/** "15 Nov, 18:40" in IST. */
export function istDateTime(iso: string | number | Date): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-IN", { timeZone: IST, day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day}, ${time}`;
}

/** "15 Nov" in IST. */
export function istDate(iso: string | number | Date): string {
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: IST, day: "numeric", month: "short" });
}

/** "Saturday" in IST. */
export function istWeekday(iso: string | number | Date): string {
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: IST, weekday: "long" });
}

/** "Dixon Technologies (India) Ltd" → "Dixon Technologies". Exchange suffixes add nothing on a phone. */
export const shortName = (name: string) =>
  name
    .replace(/\s*\(India\)\s*/i, " ")
    .replace(/\s+(?:Ltd\.?|Limited)$/i, "")
    .trim();

/** "6%", "4.5%": a position weight, without trailing zeros. */
export const weight = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

/**
 * Ranking reasons without the position size: every card already shows "% of book".
 * "Results filing for 9% position" becomes "Results filing"; "Affects a 6.5% position" is dropped.
 */
export const cleanReasons = (reasons: string[], headline = "") =>
  reasons
    .filter((r) => !/^Affects a [\d.]+% position$/i.test(r) && r.toLowerCase() !== headline.toLowerCase())
    .map((r) => r.replace(/\s+for (?:a |your )?[\d.]+% position/gi, "").trim())
    .filter(Boolean);

/** "Fri 21 Nov" in IST. */
export function istShortDay(iso: string | number | Date): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-IN", { timeZone: IST, weekday: "short" })} ${istDate(d)}`;
}
