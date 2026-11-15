/**
 * Reads the notes to the results for anything that breaks period-to-period comparison.
 * "Figures have been regrouped / reclassified" is boilerplate in nearly every filing and is
 * NOT a restatement; an explicit "not comparable", a restatement, or a demerger / scheme /
 * business transfer that has taken effect is.
 */

const NOT_COMPARABLE: RegExp[] = [
  /\b(?:are|is|were|was) not comparable\b/,
  /\bnot strictly comparable\b/,
  /\brestat(?:ed|ement)\b(?![^.]{0,30}\bnot\b)/,
  /\bdemerg\w*[^.]{0,200}?(?:effective|appointed date|with effect from|w\.?e\.?f\.?|given effect|accounted)/,
  /scheme of (?:arrangement|amalgamation)[^.]{0,200}?(?:effective|appointed date|with effect from|w\.?e\.?f\.?|given effect|accounted)/,
  /\bdiscontinued operations?\b/,
];
const BENIGN_ONLY = /\b(?:regrouped|reclassified|rearranged|recast)\b/;
const NEGATED = /\b(?:no|not been|without any) restat|\bnot restated\b/;

export interface ComparabilityFinding {
  comparable: boolean;
  /** The sentence from the filing that decided it, when not comparable. */
  note: string | null;
  page: number | null;
}

/** pages: page text with its 1-based page number. */
export function detectComparability(pages: { text: string; page: number }[]): ComparabilityFinding {
  for (const { text, page } of pages) {
    const sentences = text.replace(/\s+/g, " ").split(/(?<=\.)\s+(?=[A-Z0-9(])/);
    for (const raw of sentences) {
      const s = raw.toLowerCase();
      if (NEGATED.test(s)) continue;
      const hit = NOT_COMPARABLE.some((re) => re.test(s));
      if (!hit) continue;
      if (BENIGN_ONLY.test(s) && !/not comparable|restat/.test(s)) continue;
      const sentence = raw.trim().replace(/^\d+[.)]\s*/, "");
      // Keep the whole sentence: the reason and the effective date are usually at the end.
      return { comparable: false, note: sentence.length > 420 ? `${sentence.slice(0, 417)}…` : sentence, page };
    }
  }
  return { comparable: true, note: null, page: null };
}
