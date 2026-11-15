/**
 * Subject-line canonicalisation. Exchange subjects wrap the real news in LODR boilerplate,
 * and NSE and BSE wrap it differently. Stripping that boilerplate is what lets the same
 * disclosure on both exchanges hash to the same value.
 */

const BOILERPLATE: RegExp[] = [
  // NSE: "Dixon Technologies (India) Limited has informed the Exchange regarding ..."
  /^.*?\bhas (?:informed|intimated|submitted to) the exchanges?\b(?: (?:about|regarding|that|of|on|under))?/,
  // "Disclosure under Regulation 30 (read with Schedule III) of SEBI (LODR) Regulations, 2015"
  /\b(?:disclosure|intimation|submission)s? (?:under|pursuant to|in terms of) regulations? [\d()a-z ,&]+? of (?:the )?sebi\b[^,;:-]*?(?:regulations?)?,? ?(?:2015|2011|2018)?/,
  /\b(?:pursuant to|under|in terms of|as per) regulations? \d+[a-z]?(?:\s*\(\d+[a-z]?\))*(?: (?:and|&|read with) (?:regulations? )?\d+[a-z]?(?:\s*\(\d+[a-z]?\))*)*(?: of (?:the )?sebi\b[^,;:-]*?(?:regulations?)?,? ?(?:2015|2011|2018)?)?/,
  /\bsebi \((?:listing obligations and disclosure requirements|lodr|prohibition of insider trading|substantial acquisition of shares and takeovers)\) regulations?,? ?(?:2015|2011)?/,
  /\bplease find (?:enclosed|attached)(?: herewith)?/,
];

const STOPWORDS = new Set(
  "a an and are as at be been by for from has have in is it its of on or the to was were with we our this that company limited ltd mr ms mrs dr shri smt dated held herewith enclosed attached regarding about kindly please take note".split(
    " ",
  ),
);

/** Lowercase, boilerplate stripped, punctuation removed, whitespace collapsed. */
export function canonicalSubject(subject: string): string {
  let s = subject.toLowerCase().replace(/\s+/g, " ");
  for (const re of BOILERPLATE) s = s.replace(re, " ");
  return s.replace(/[^a-z0-9]+/g, " ").trim();
}

/** Meaningful tokens of the canonical subject (stopwords dropped). */
export function tokens(subject: string): Set<string> {
  return new Set(canonicalSubject(subject).split(" ").filter((t) => t.length > 1 && !STOPWORDS.has(t)));
}

/**
 * Action words that change what a filing means. Two subjects only count as the same
 * disclosure if their signal words match exactly: "Resignation of CFO" never merges with
 * "Appointment of CFO", however many other words they share.
 */
const SIGNAL_STEMS = [
  "resign", "appoint", "reappoint", "re appoint", "cessation", "retire", "pledg", "encumb", "releas", "revoc", "invoc", "invok",
  "downgrad", "upgrad", "reaffirm", "penalt", "insolven", "sale", "sold", "sell", "purchas", "acqui", "dispos", "result",
  "closure", "dividend", "bonus", "split", "allot", "rotation", "qualif", "unmodified", "merger", "amalgam", "demerg",
];

export function signals(subject: string): string {
  const c = ` ${canonicalSubject(subject)}`;
  return SIGNAL_STEMS.filter((s) => c.includes(` ${s}`)).sort().join(",");
}

/** |A ∩ B| / min(|A|, |B|): 1.0 when the shorter subject is wholly inside the longer one. */
export function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n / Math.min(a.size, b.size);
}
