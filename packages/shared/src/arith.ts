/**
 * Single source of truth for "do these numbers tie?". Used by the schemas to reject
 * cards whose recorded checks contradict their own numbers, and by packages/core when
 * it computes those checks. Keep the two in lockstep by only ever calling this.
 */
export const TIE_RELATIVE_TOLERANCE = 0.01; // ±1%
export const TIE_ABSOLUTE_FLOOR_CR = 0.05; // rounding noise from lakh → crore conversion

export function ties(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Math.max(scale * TIE_RELATIVE_TOLERANCE, TIE_ABSOLUTE_FLOOR_CR);
}
