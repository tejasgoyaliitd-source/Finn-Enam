import { NormalizedFiling, type Exchange, type IstDateTime } from "@finn/shared";
import { canonicalSubject } from "../pipeline/text";
import type { FilingRow, Hasher } from "../ports";

export { canonicalSubject as normalizeSubject };

/** Identity of one exchange record: re-polling the same record produces the same key. */
export function dedupeKey(hash: Hasher, exchange: Exchange, symbol: string, subject: string, filedAt: IstDateTime): Promise<string> {
  return hash.sha256(`${exchange}|${symbol}|${canonicalSubject(subject)}|${filedAt}`);
}

/** Same disclosure regardless of exchange or time; the pipeline adds the ±10 minute window. */
export function subjectHash(hash: Hasher, symbol: string, subject: string): Promise<string> {
  return hash.sha256(`${symbol}|${canonicalSubject(subject)}`);
}

export function cleanText(s: unknown): string {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
}

export function cleanUrl(s: unknown): string | null {
  const t = cleanText(s);
  return /^https?:\/\/\S+$/i.test(t) ? t : null;
}

export type NormalizeResult = { ok: true; filing: FilingRow } | { ok: false; reason: string };

/** Final step for every exchange record: build, then validate against the shared schema. */
export async function buildFiling(
  hash: Hasher,
  input: {
    symbol: string;
    exchange: Exchange;
    exch_category: string;
    subject: string;
    attachment_url: string | null;
    filed_at: IstDateTime | null;
    raw: Record<string, unknown>;
  },
): Promise<NormalizeResult> {
  if (!input.filed_at) return { ok: false, reason: "unparseable timestamp" };
  const subject = input.subject.slice(0, 2000);
  const candidate = {
    symbol: input.symbol,
    exchange: input.exchange,
    exch_category: input.exch_category,
    subject,
    attachment_url: input.attachment_url,
    filed_at: input.filed_at,
    dedupe_key: await dedupeKey(hash, input.exchange, input.symbol, subject, input.filed_at),
    subject_hash: await subjectHash(hash, input.symbol, subject),
  };
  const parsed = NormalizedFiling.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  return { ok: true, filing: { ...parsed.data, raw: input.raw } };
}
