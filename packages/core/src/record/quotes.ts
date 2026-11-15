import { MIN_QUOTE_MATCH } from "@finn/shared";

/**
 * Quote verification. A model's quote is never trusted: it is fuzzy-matched, word by word,
 * against the raw text of the page it cites. Ratio = 1 − (word edit distance / quote length)
 * over the best-matching window of the page. Below 0.85 the statement is dropped.
 */

export function words(s: string): string[] {
  return (
    s
      .toLowerCase()
      .replace(/[’‘`]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/ﬀ/g, "ff").replace(/ﬁ/g, "fi").replace(/ﬂ/g, "fl").replace(/Ɵ/g, "ti").replace(/Ư/g, "ff") // PDF ligatures
      .replace(/(\d),(?=\d)/g, "$1") // 1,150 → 1150
      .match(/[a-z0-9]+(?:\.[0-9]+)?%?|%/g) ?? []
  );
}

function editDistance(a: string[], b: string[]): number {
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!;
  }
  return prev[b.length]!;
}

function bestWindow(q: string[], p: string[]): number {
  if (q.length === 0) return 0;
  const first = new Set(q.slice(0, 3));
  let best = 0;
  for (let start = 0; start < p.length; start++) {
    // Windows only start near a word the quote starts with: keeps this fast on long pages.
    if (!first.has(p[start]!) && start !== 0) continue;
    for (const len of [q.length - 1, q.length, q.length + 1]) {
      if (len < 1 || start + len > p.length + 1) continue;
      const w = p.slice(start, start + len);
      const r = 1 - editDistance(q, w) / Math.max(q.length, w.length);
      if (r > best) best = r;
      if (best === 1) return 1;
    }
  }
  return best;
}

/** Best match ratio of `quote` within `text`. Quotes split by an ellipsis are matched part by part. */
export function quoteMatchRatio(quote: string, text: string): number {
  const parts = quote.split(/\.{3}|…/).map(words).filter((w) => w.length > 0);
  if (parts.length === 0) return 0;
  const p = words(text);
  const total = parts.reduce((n, w) => n + w.length, 0);
  const score = parts.reduce((acc, w) => acc + bestWindow(w, p) * w.length, 0) / total;
  return Math.round(score * 1000) / 1000;
}

export interface QuoteCheck {
  ratio: number;
  ok: boolean;
  /** True when the quote ran over onto the next page. */
  spansNextPage: boolean;
}

/** Checks the cited page, and the cited page joined with the next one for quotes that run over a page break. */
export function verifyQuote(quote: string, pages: string[], citedPage: number): QuoteCheck {
  const page = pages[citedPage - 1];
  if (page === undefined) return { ratio: 0, ok: false, spansNextPage: false };
  const r = quoteMatchRatio(quote, page);
  if (r >= MIN_QUOTE_MATCH) return { ratio: r, ok: true, spansNextPage: false };
  const next = pages[citedPage];
  if (next !== undefined) {
    const r2 = quoteMatchRatio(quote, `${page}\n${next}`);
    if (r2 >= MIN_QUOTE_MATCH) return { ratio: r2, ok: true, spansNextPage: true };
    return { ratio: Math.max(r, r2), ok: false, spansNextPage: false };
  }
  return { ratio: r, ok: false, spansNextPage: false };
}

// ─── Hedges ──────────────────────────────────────────────────────────────────

/** Phrases that make a commitment conditional or aspirational. Matched verbatim in the quote. */
const HEDGES: RegExp[] = [
  /\b(?:we |i )?aspire[sd]? (?:to|for)\b/i,
  /\baspirations?\b/i,
  /\bsubject to\b[^,.;]{0,60}/i,
  /\bhopefully\b/i,
  /\b(?:we |i )?hope (?:to|that)\b/i,
  /\bendeavou?r(?:ing)?\b/i,
  /\b(?:we will |we'll |we )?try (?:to|and)\b/i,
  /\bbarring\b[^,.;]{0,40}/i,
  /\bdepending (?:on|upon)\b[^,.;]{0,40}/i,
  /\bwhether we can\b/i,
  /\bif (?:all goes well|things go (?:well|as planned)|everything goes (?:well|as planned))\b/i,
];

/** Hedges found in the quote by code, plus any the model listed that really are in the quote. */
export function findHedges(quote: string, fromModel: string[] = []): string[] {
  const out: string[] = [];
  for (const re of HEDGES) {
    const m = re.exec(quote);
    if (m) out.push(m[0].trim());
  }
  const q = quote.toLowerCase();
  for (const h of fromModel) {
    const t = h.trim();
    if (t && q.includes(t.toLowerCase()) && !out.some((o) => o.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(o.toLowerCase()))) out.push(t);
  }
  return out;
}
