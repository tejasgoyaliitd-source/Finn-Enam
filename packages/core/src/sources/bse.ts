import { z } from "zod";
import { BROWSER_HEADERS, HttpError, type PoliteHttp } from "../http/polite";
import type { Hasher } from "../ports";
import { bseDate, parseExchangeIst } from "../time";
import { buildFiling, cleanText, type NormalizeResult } from "./normalize";

const BSE_API = "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w";
const BSE_ATTACH = "https://www.bseindia.com/xml-data/corpfiling/AttachLive/";
const MAX_PAGES = 10;

export const BseAnnouncement = z.looseObject({
  NEWSID: z.string().nullish(),
  SCRIP_CD: z.union([z.string(), z.number()]).nullish(),
  HEADLINE: z.string().nullish(),
  NEWSSUB: z.string().nullish(),
  CATEGORYNAME: z.string().nullish(),
  SUBCATNAME: z.string().nullish(),
  ATTACHMENTNAME: z.string().nullish(),
  News_submission_dt: z.string().nullish(), // "2026-11-14T16:42:05"
  DT_TM: z.string().nullish(),
  NEWS_DT: z.string().nullish(),
});
export type BseAnnouncement = z.infer<typeof BseAnnouncement>;

const BsePage = z.looseObject({
  Table: z.array(z.unknown()).default([]),
  Table1: z.array(z.looseObject({ ROWCNT: z.number().nullish() })).nullish(),
});

export class BseClient {
  constructor(private readonly http: PoliteHttp) {}

  /** Raw announcement records for one BSE scrip code between two dates (inclusive, IST). */
  async announcements(scripCode: string, from: Date, to: Date): Promise<unknown[]> {
    const out: unknown[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url =
        `${BSE_API}?pageno=${page}&strCat=-1&strPrevDate=${bseDate(from)}&strScrip=${scripCode}` +
        `&strSearch=P&strToDate=${bseDate(to)}&strType=C&subcategory=-1`;
      const res = await this.http.request({
        url,
        headers: {
          ...BROWSER_HEADERS,
          accept: "application/json, text/plain, */*",
          origin: "https://www.bseindia.com",
          referer: "https://www.bseindia.com/",
        },
      });
      if (res.status !== 200) throw new HttpError(res.status, url);
      const body = await res.text();
      if (body.trimStart().startsWith("<")) throw new Error("bse: got HTML instead of JSON");
      const parsed = BsePage.parse(JSON.parse(body));
      out.push(...parsed.Table);
      const total = parsed.Table1?.[0]?.ROWCNT ?? 0;
      if (parsed.Table.length === 0 || out.length >= total) break;
    }
    return out;
  }
}

/**
 * BSE's HEADLINE is the opening line of the attachment ("Please find enclosed..."), while
 * NEWSSUB is the filing's title, unless it is the generic
 * "Announcement under Regulation 30 (LODR)-<sub-category>" (the sub-category is already in
 * exch_category). Use the specific title when there is one.
 */
export function bseSubject(r: Pick<BseAnnouncement, "NEWSSUB" | "HEADLINE"> & { SUBCATNAME?: string | null }): string {
  const title = cleanText(r.NEWSSUB).replace(/^.{2,120}? - \d{6} - /, ""); // "Company Ltd - 540699 - Title"
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // "Corporate Insolvency Resolution Process (CIRP)-Updates - …" only repeats the sub-category: no content.
  const repeatsCategory = Boolean(r.SUBCATNAME) && norm(title).includes(norm(cleanText(r.SUBCATNAME)).split(" - ").pop() ?? "\u0000") && norm(title).replace(norm(cleanText(r.SUBCATNAME)), "").trim().split(" ").length <= 8;
  const generic = /^announcement under regulation 30\b/i.test(title) || title.length < 8 || repeatsCategory;
  const headline = cleanText(r.HEADLINE);
  return (generic ? headline : title) || headline || title;
}

export async function normalizeBse(hash: Hasher, symbol: string, raw: unknown): Promise<NormalizeResult> {
  const p = BseAnnouncement.safeParse(raw);
  if (!p.success) return { ok: false, reason: "unexpected BSE record shape" };
  const r = p.data;
  const cat = cleanText(r.CATEGORYNAME);
  const sub = cleanText(r.SUBCATNAME);
  const file = cleanText(r.ATTACHMENTNAME);
  return buildFiling(hash, {
    symbol,
    exchange: "BSE",
    exch_category: [cat, sub].filter((x) => x && x !== "-").join(" / ") || "Unknown",
    subject: bseSubject({ ...r, SUBCATNAME: sub }),
    attachment_url: file ? BSE_ATTACH + encodeURIComponent(file) : null,
    filed_at: parseExchangeIst(r.News_submission_dt) ?? parseExchangeIst(r.DT_TM) ?? parseExchangeIst(r.NEWS_DT),
    raw: r,
  });
}
