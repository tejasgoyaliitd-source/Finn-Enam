/**
 * 20 NSE announcements across the demo portfolio, shaped like /api/corporate-announcements
 * records, plus 3 BSE copies of NSE disclosures. Names of individuals are fictional; this is
 * test data, not a record of real filings.
 *
 * `expect` is what the pipeline must produce for each NSE record.
 */
import type { FilingCategory, FilingTier } from "@finn/shared";
import type { TriggerId } from "../../src/index";

export interface NseFixture {
  id: string;
  raw: { symbol: string; desc: string; attchmntText: string; an_dt: string; attchmntFile: string; seq_id: string };
  expect: { category: FilingCategory; tier: FilingTier; trigger?: TriggerId; group?: string };
}

const co: Record<string, string> = {
  DIXON: "Dixon Technologies (India) Limited",
  POLYCAB: "Polycab India Limited",
  KAYNES: "Kaynes Technology India Limited",
  ASTRAL: "Astral Limited",
  BAJFINANCE: "Bajaj Finance Limited",
  TITAN: "Titan Company Limited",
  SONACOMS: "Sona BLW Precision Forgings Limited",
  PAGEIND: "Page Industries Limited",
  HAVELLS: "Havells India Limited",
  CGPOWER: "CG Power and Industrial Solutions Limited",
  HDFCBANK: "HDFC Bank Limited",
  MARICO: "Marico Limited",
  ASIANPAINT: "Asian Paints Limited",
  KPITTECH: "KPIT Technologies Limited",
  PERSISTENT: "Persistent Systems Limited",
};

let seq = 107_700_000;
const nse = (
  id: string,
  symbol: string,
  desc: string,
  about: string,
  an_dt: string,
  expect: NseFixture["expect"],
): NseFixture => ({
  id,
  raw: {
    symbol,
    desc,
    attchmntText: `${co[symbol]} has informed the Exchange about ${about}`,
    an_dt,
    attchmntFile: `https://nsearchives.nseindia.com/corporate/${symbol}_${++seq}.pdf`,
    seq_id: String(seq),
  },
  expect,
});

export const NSE_FIXTURE: NseFixture[] = [
  // Results day at Dixon: four filings, one event.
  nse("dixon-results", "DIXON", "Financial Result Updates",
    "Financial Results for the quarter and half year ended September 30, 2026", "14-Nov-2026 16:42:05",
    { category: "results", tier: "read", group: "dixon-q2" }),
  nse("dixon-deck", "DIXON", "Investor Presentation",
    "Investor Presentation on financial results for Q2 FY27", "14-Nov-2026 17:05:40",
    { category: "investor_meetings", tier: "read", group: "dixon-q2" }),
  nse("dixon-pr", "DIXON", "Press Release",
    "Press Release on unaudited financial results for the quarter ended September 30, 2026", "14-Nov-2026 17:10:12",
    { category: "press_release", tier: "read", group: "dixon-q2" }),
  nse("dixon-ad", "DIXON", "Copy of Newspaper Publication",
    "Copy of Newspaper Publication of financial results for the quarter ended September 30, 2026", "15-Nov-2026 09:30:00",
    { category: "routine", tier: "routine", group: "dixon-q2" }),

  // CFO leaves and is replaced the same evening: one event, resignation is primary.
  nse("polycab-cfo-out", "POLYCAB", "Resignation",
    "Resignation of Mr. Rakesh Sharma as Chief Financial Officer of the Company with effect from November 30, 2026", "13-Nov-2026 18:20:00",
    { category: "management_change", tier: "act", trigger: "kmp_resignation", group: "polycab-cfo" }),
  nse("polycab-cfo-in", "POLYCAB", "Appointment",
    "Appointment of Mr. Anil Mehta as Chief Financial Officer of the Company with effect from December 1, 2026", "13-Nov-2026 18:25:00",
    { category: "management_change", tier: "read", group: "polycab-cfo" }),

  // Auditors: a resignation is a red flag, a rotation is compliance.
  nse("kaynes-auditor", "KAYNES", "Change in Auditor",
    "Resignation of Statutory Auditors", "14-Nov-2026 21:10:00",
    { category: "auditor_change", tier: "act", trigger: "auditor_exit" }),
  nse("astral-rotation", "ASTRAL", "Change in Auditor",
    "Change in Statutory Auditors on completion of second term of five consecutive years pursuant to Section 139(2) of the Companies Act, 2013",
    "13-Nov-2026 15:00:00",
    { category: "auditor_change", tier: "read" }),

  // Nothing in the rule book matches this one.
  nse("bajfinance-update", "BAJFINANCE", "General Updates",
    "Update on business performance for October 2026", "12-Nov-2026 19:02:00",
    { category: "unclassified", tier: "read" }),

  nse("titan-downgrade", "TITAN", "Credit Rating",
    "Credit Rating - ICRA revised long term rating from [ICRA]AA+ to [ICRA]AA", "13-Nov-2026 12:15:00",
    { category: "credit_rating", tier: "act", trigger: "rating_downgrade" }),
  nse("sona-promoter-sale", "SONACOMS", "Disclosure under SEBI Takeover Regulations",
    "Disclosure under Regulation 29(2) of SEBI (SAST) Regulations, 2011 - sale of shares by promoter in open market", "13-Nov-2026 20:40:00",
    { category: "insider_trading", tier: "act", trigger: "promoter_sale" }),
  nse("page-pledge", "PAGEIND", "Disclosure under SEBI Takeover Regulations",
    "Disclosure under Regulation 31(1) and 31(2) of SEBI (SAST) Regulations, 2011 - creation of pledge on promoter shares", "12-Nov-2026 22:05:00",
    { category: "pledging", tier: "act", trigger: "pledge_increase" }),
  nse("havells-penalty", "HAVELLS", "Action(s) taken or orders passed",
    "Order passed by SEBI imposing a penalty of Rs. 5,00,000 under Section 15HB of the SEBI Act, 1992", "13-Nov-2026 17:30:00",
    { category: "regulatory_order", tier: "act", trigger: "regulatory_penalty" }),
  nse("cgpower-ibc", "CGPOWER", "Litigation/ Dispute",
    "Petition filed under Section 9 of the Insolvency and Bankruptcy Code, 2016 against a wholly owned subsidiary before NCLT", "14-Nov-2026 11:00:00",
    { category: "regulatory_order", tier: "act", trigger: "insolvency" }),

  // LODR boilerplate.
  nse("hdfc-window", "HDFCBANK", "Trading Window-XBRL", "Closure of Trading Window", "12-Nov-2026 10:00:00",
    { category: "routine", tier: "routine" }),
  nse("marico-certs", "MARICO", "Loss of Share Certificates", "Loss of Share Certificates", "13-Nov-2026 14:20:00",
    { category: "routine", tier: "routine" }),
  nse("asianpaint-meets", "ASIANPAINT", "Analysts/Institutional Investor Meet/Con. Call Updates",
    "Schedule of Analyst / Institutional Investor Meetings", "14-Nov-2026 09:15:00",
    { category: "routine", tier: "routine" }),
  // Looks like an audit-opinion filing, but it says the opinion is clean.
  nse("kpit-clean-opinion", "KPITTECH", "Declaration",
    "Declaration of unmodified opinion on audit report for the year ended March 31, 2026", "12-Nov-2026 16:00:00",
    { category: "routine", tier: "routine" }),

  nse("persistent-qualified", "PERSISTENT", "Financial Result Updates",
    "Statement on Impact of Audit Qualifications (for audit report with modified opinion) for the year ended March 31, 2026",
    "14-Nov-2026 18:00:00",
    { category: "auditor_change", tier: "act", trigger: "audit_qualification" }),

  // Same category as Dixon's results, but a 9% position: Act on size alone.
  nse("hdfc-results", "HDFCBANK", "Financial Result Updates",
    "Financial Results for the quarter ended September 30, 2026", "14-Nov-2026 15:50:00",
    { category: "results", tier: "act" }),
];

/** BSE copies of three NSE disclosures, worded the BSE way, minutes later. */
export const BSE_DUPLICATES = [
  {
    of: "dixon-results",
    symbol: "DIXON",
    raw: {
      NEWSID: "bse-1", SCRIP_CD: 540699, CATEGORYNAME: "Result", SUBCATNAME: "Financial Results",
      HEADLINE: "Unaudited Financial Results for the quarter and half year ended September 30, 2026",
      ATTACHMENTNAME: "dixon-q2.pdf", News_submission_dt: "2026-11-14T16:45:31",
    },
  },
  {
    of: "polycab-cfo-out",
    symbol: "POLYCAB",
    raw: {
      NEWSID: "bse-2", SCRIP_CD: 542652, CATEGORYNAME: "Company Update", SUBCATNAME: "Resignation of Chief Financial Officer (CFO)",
      HEADLINE: "Resignation of Chief Financial Officer (CFO)",
      ATTACHMENTNAME: "polycab-cfo.pdf", News_submission_dt: "2026-11-13T18:23:10",
    },
  },
  {
    of: "kaynes-auditor",
    symbol: "KAYNES",
    raw: {
      NEWSID: "bse-3", SCRIP_CD: 543664, CATEGORYNAME: "Company Update", SUBCATNAME: "Change in Auditor",
      HEADLINE: "Resignation of Statutory Auditors",
      ATTACHMENTNAME: "kaynes-aud.pdf", News_submission_dt: "2026-11-14T21:12:00",
    },
  },
];

/** Demo portfolio weights (supabase/seed.sql). */
export const WEIGHTS: Record<string, number> = {
  HDFCBANK: 9, TITAN: 7.5, BAJFINANCE: 7, DIXON: 6.5, POLYCAB: 6.5, PERSISTENT: 6, KPITTECH: 5.5, ASTRAL: 5.5,
  PIDILITIND: 5.5, HAVELLS: 5, KAYNES: 5, CGPOWER: 5, APLAPOLLO: 4.5, ASIANPAINT: 4.5, MARICO: 4.5, PAGEIND: 4.5,
  SUPREMEIND: 4, SONACOMS: 4,
};
