import { load } from "cheerio/slim";

/** Annual reports and earnings-call transcripts listed on a Screener company page. */
export interface ListedDocuments {
  annual_reports: { fy: string; url: string }[];
  transcripts: { call_period: string; month: string; url: string }[];
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * A call held in month M discusses the quarter that just ended:
 * Jan–Mar → Q3, Apr–Jun → Q4 (of the FY that just closed), Jul–Sep → Q1, Oct–Dec → Q2.
 */
export function callQuarter(monthLabel: string): string | null {
  const m = /^([A-Za-z]{3})\w*\s+(\d{4})$/.exec(monthLabel.trim());
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1]!.toLowerCase()) + 1;
  if (mo === 0) return null;
  const y = Number(m[2]);
  const [q, fy] = mo <= 3 ? [3, y] : mo <= 6 ? [4, y] : mo <= 9 ? [1, y + 1] : [2, y + 1];
  return `Q${q}FY${String(fy % 100).padStart(2, "0")}`;
}

/** BSE viewer links ("AnnPdfOpen.aspx?Pname=x.pdf") become the attachment URL the downloader understands. */
export function bseAttachmentUrl(href: string): string {
  const m = /AnnPdfOpen\.aspx\?Pname=([\w.-]+\.pdf)/i.exec(href);
  return m ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${m[1]}` : href;
}

export function parseScreenerDocuments(html: string): ListedDocuments {
  const $ = load(html);
  const annual_reports = $("#documents .annual-reports li a")
    .toArray()
    .flatMap((a) => {
      const year = /\b(20\d{2})\b/.exec($(a).text())?.[1];
      const href = $(a).attr("href");
      return year && href ? [{ fy: `FY${year.slice(2)}`, url: bseAttachmentUrl(href) }] : [];
    });
  const transcripts = $("#documents .concalls li")
    .toArray()
    .flatMap((li) => {
      const month = $(li).find("div").first().text().replace(/\s+/g, " ").trim();
      const a = $(li)
        .find("a")
        .toArray()
        .find((x) => /transcript/i.test($(x).text()) || /transcript/i.test($(x).attr("title") ?? ""));
      const href = a ? $(a).attr("href") : undefined;
      const call_period = callQuarter(month);
      return call_period && href ? [{ call_period, month, url: bseAttachmentUrl(href) }] : [];
    });
  return { annual_reports, transcripts };
}
