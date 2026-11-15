import { z } from "zod";
import { BROWSER_HEADERS, CookieJar, HttpError, type PoliteHttp } from "../http/polite";
import type { Hasher, Logger } from "../ports";
import { nseDate, parseExchangeIst } from "../time";
import { buildFiling, cleanText, cleanUrl, type NormalizeResult } from "./normalize";

const NSE_HOME = "https://www.nseindia.com/";
const NSE_REFERER = "https://www.nseindia.com/companies-listing/corporate-filings-announcements";
const NSE_API = "https://www.nseindia.com/api/corporate-announcements";

/** NSE refused us (403/401, or an HTML challenge page instead of JSON). Triggers the BSE fallback. */
export class NseBlockedError extends Error {
  constructor(detail: string) {
    super(`NSE blocked the request: ${detail}`);
    this.name = "NseBlockedError";
  }
}

/** The fields we rely on. NSE sends more; extras are kept in `raw`. */
export const NseAnnouncement = z.looseObject({
  symbol: z.string(),
  desc: z.string().nullish(), // exchange category, e.g. "Outcome of Board Meeting"
  attchmntText: z.string().nullish(), // the subject text
  attchmntFile: z.string().nullish(),
  an_dt: z.string().nullish(), // "14-Nov-2026 16:42:05"
  sort_date: z.string().nullish(), // "2026-11-14 16:42:05"
  exchdisstime: z.string().nullish(),
  seq_id: z.union([z.string(), z.number()]).nullish(),
});
export type NseAnnouncement = z.infer<typeof NseAnnouncement>;

export class NseClient {
  private readonly jar = new CookieJar();
  private shaken = false;

  constructor(
    private readonly http: PoliteHttp,
    private readonly log: Logger,
  ) {}

  /** GET the homepage so NSE sets its session cookies (nsit, nseappid, bm_sv, ...). */
  async handshake(): Promise<void> {
    this.jar.clear();
    const res = await this.http.request({
      url: NSE_HOME,
      headers: { ...BROWSER_HEADERS, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    });
    if (res.status === 401 || res.status === 403) throw new NseBlockedError(`homepage returned ${res.status}`);
    if (res.status >= 400) throw new HttpError(res.status, NSE_HOME);
    this.jar.absorb(res.setCookies);
    if (this.jar.size === 0) this.log.warn("nse: homepage set no cookies; API call may be refused");
    this.shaken = true;
  }

  /** Raw announcement records for one symbol between two dates (inclusive, IST). */
  async announcements(symbol: string, from: Date, to: Date): Promise<unknown[]> {
    const url =
      `${NSE_API}?index=equities&from_date=${nseDate(from)}&to_date=${nseDate(to)}` +
      `&symbol=${encodeURIComponent(symbol)}`;

    for (let attempt = 1; attempt <= 2; attempt++) {
      let refusal: string | null = null;
      let res: Awaited<ReturnType<PoliteHttp["request"]>> | null = null;
      let body = "";
      try {
        if (!this.shaken) await this.handshake();
        res = await this.http.request({
          url,
          headers: {
            ...BROWSER_HEADERS,
            accept: "application/json, text/plain, */*",
            referer: NSE_REFERER,
            cookie: this.jar.header(),
          },
        });
        body = await res.text();
        if (res.status === 401 || res.status === 403 || body.trimStart().startsWith("<")) {
          refusal = `API returned ${res.status}${res.status === 200 ? " with HTML" : ""}`;
        }
      } catch (err) {
        if (err instanceof NseBlockedError) throw err;
        // NSE's bot protection often stalls a request rather than refusing it. A hang is a block.
        refusal = `no response (${err instanceof Error ? err.name : "network error"})`;
      }
      if (refusal || !res) {
        // Cookies may have expired: re-handshake once, then give up and let BSE take over.
        this.shaken = false;
        if (attempt === 2) throw new NseBlockedError(refusal ?? "no response");
        this.log.warn("nse: refused, re-doing cookie handshake", { symbol, reason: refusal });
        continue;
      }
      if (res.status !== 200) throw new HttpError(res.status, url);
      const json: unknown = JSON.parse(body);
      if (Array.isArray(json)) return json;
      if (json && typeof json === "object" && Array.isArray((json as { data?: unknown }).data)) {
        return (json as { data: unknown[] }).data;
      }
      throw new Error(`nse: unexpected response shape for ${symbol}`);
    }
    throw new NseBlockedError("unreachable");
  }
}

export async function normalizeNse(hash: Hasher, expectedSymbol: string, raw: unknown): Promise<NormalizeResult> {
  const p = NseAnnouncement.safeParse(raw);
  if (!p.success) return { ok: false, reason: "unexpected NSE record shape" };
  const r = p.data;
  if (r.symbol !== expectedSymbol) return { ok: false, reason: `symbol ${r.symbol} ≠ requested ${expectedSymbol}` };
  const category = cleanText(r.desc);
  return buildFiling(hash, {
    symbol: r.symbol,
    exchange: "NSE",
    exch_category: category || "Unknown",
    subject: cleanText(r.attchmntText) || category,
    attachment_url: cleanUrl(r.attchmntFile),
    filed_at: parseExchangeIst(r.an_dt) ?? parseExchangeIst(r.sort_date) ?? parseExchangeIst(r.exchdisstime),
    raw: r,
  });
}
