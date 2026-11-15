import { z } from "zod";
import type { FilingCategory } from "@finn/shared";
import { fiscalQuarter } from "../time";
import { ratingMove, type Trigger } from "./always-act";

/**
 * Headlines: one plain sentence instead of the exchange's boilerplate subject.
 * Tier-1 model for Act/Read items (cached per filing by the caller); a deterministic
 * template for Routine items and whenever the model is unavailable or says something odd.
 */

export const HEADLINE_PROMPT_VERSION = "headline-v1";
export const HEADLINE_SYSTEM = [
  "You rewrite Indian stock exchange filing subjects into one short, plain English headline for a fund manager.",
  "Rules: one sentence, at most 90 characters, no full stop at the end.",
  "Use only facts present in the subject. Never invent names, numbers, dates or reasons.",
  "Drop regulation references, company boilerplate and phrases like 'has informed the Exchange'.",
  "Prefer short role names: CFO, CEO, MD. Use past tense for things that happened.",
  'Return JSON: {"headline": "..."}',
].join("\n");

export const HeadlineOutput = z.object({ headline: z.string().min(3).max(110) });

/** The model's headline is rejected (template used instead) if it still reads like boilerplate. */
export function acceptableHeadline(h: string): boolean {
  return (
    h.length >= 3 &&
    h.length <= 110 &&
    !h.includes("\n") &&
    !/\bregulation\b|\blodr\b|informed the exchange|pursuant to|disclosure under/i.test(h)
  );
}

const ROLE: [RegExp, string][] = [
  [/chief financial officer|\bcfo\b/i, "CFO"],
  [/chief executive officer|\bceo\b/i, "CEO"],
  [/managing director|\bmd\b/i, "MD"],
  [/company secretary/i, "Company Secretary"],
  [/whole[- ]time director/i, "Whole-time Director"],
  [/independent director/i, "Independent Director"],
  [/\bchairman|\bchairperson/i, "Chairperson"],
  [/\bdirector\b/i, "Director"],
];

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";

export function extractRole(s: string): string | null {
  for (const [re, label] of ROLE) if (re.test(s)) return label;
  return null;
}

export function extractName(s: string): string | null {
  const m = /\b(?:Mr|Ms|Mrs|Dr|Shri|Smt)\.?\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,3})/.exec(s);
  return m ? m[1]!.replace(/\s+(?:As|From|With|The|To)$/, "") : null;
}

/** "quarter ended September 30, 2026" / "30th September 2026" → "Q2 FY27". */
export function extractQuarter(s: string): string | null {
  const m =
    new RegExp(`(?:quarter|period|half[- ]year|year)[^|.]{0,40}?ended(?: on)?\\s+(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+)?(${MONTHS})[a-z]*\\.?,?\\s+(?:(\\d{1,2})(?:st|nd|rd|th)?,?\\s+)?(\\d{4})`, "i").exec(s);
  if (!m) return null;
  const q = fiscalQuarter(`${m[2]!.slice(0, 1).toUpperCase()}${m[2]!.slice(1, 3).toLowerCase()} ${m[4]}`);
  return q ? `${q.slice(0, 2)} ${q.slice(2)}` : null;
}

/** "November 14, 2026" / "14th November, 2026" → "14 Nov". */
export function extractDate(s: string): string | null {
  const a = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS})[a-z]*\\.?,?\\s+\\d{4}`, "i").exec(s);
  const b = new RegExp(`\\b(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+\\d{4}`, "i").exec(s);
  const [day, mon] = a ? [a[1]!, a[2]!] : b ? [b[2]!, b[1]!] : [null, null];
  return day && mon ? `${Number(day)} ${mon[0]!.toUpperCase()}${mon.slice(1, 3).toLowerCase()}` : null;
}

/** Boilerplate-free version of the subject, as a last resort. */
export function cleanSubject(subject: string): string {
  let s = subject
    .replace(/^.*?\bhas (?:informed|intimated|submitted to) the exchanges?\b(?: (?:about|regarding|that|of|on|under))?\s*/i, "")
    .replace(/\b(?:disclosure|intimation|submission)s? (?:under|pursuant to|in terms of) regulations? [\d()a-z ,&]+? of (?:the )?sebi\b[^,;:-]*?(?:regulations?)?,? ?(?:2015|2011|2018)?\s*[-–:]*\s*/gi, "")
    .replace(/\s*\b(?:pursuant to|under) regulation \d+[^,.;-]*/gi, "")
    .replace(/^\s*(?:the )?(?:intimation|disclosure|submission|announcement)s?\s*(?:of|regarding|about|under|for|-|:)\s*(?:the )?/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–:,.]+|[\s\-–:,.]+$/g, "");
  if (!s) s = subject.trim();
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.length <= 100 ? s : `${s.slice(0, 97).replace(/\s+\S*$/, "")}…`;
}

/**
 * Subjects that are pure boilerplate: BSE often puts the first line of the letter here
 * ("Intimation u/r 30", "Please find enclosed ...", "Pursuant to Regulation 30 of ...").
 */
const UNINFORMATIVE = /^(?:intimation u\/r|please find|pursuant to|in terms of|announcement under|we wish to inform|this is to inform|the company has|\(?listing obligations?)|^.{0,60}\(listing obligat/i;

export function templateHeadline(f: {
  subject: string;
  exch_category?: string;
  category: FilingCategory;
  sub_kind: string | null;
  triggers: Trigger[];
  rotation: string | null;
}): string {
  const headline = templateFromSubject(f);
  // Only the generic fallback (the cleaned subject) is ever replaced; a specific template wins.
  if (headline !== cleanSubject(f.subject)) return headline;
  // Boilerplate subject: the exchange's own sub-category ("Strikes /Lockouts / Disturbances") says more.
  const sub = f.exch_category?.split(" / ").slice(1).join(" / ").trim();
  if (sub && !/^(?:general|others?|updates?)$/i.test(sub) && (UNINFORMATIVE.test(f.subject) || UNINFORMATIVE.test(headline))) {
    return `${sub.replace(/\s*\/\s*(?=\S{3,})/g, " / ")} update`.replace(/^./, (c) => c.toUpperCase());
  }
  return headline;
}

function templateFromSubject(f: Parameters<typeof templateHeadline>[0]): string {
  const s = f.subject;
  const role = extractRole(s);
  const name = extractName(s);
  const q = extractQuarter(s);
  const t = new Set(f.triggers.map((x) => x.id));

  if (t.has("auditor_exit")) return /resign/i.test(s) ? "Statutory auditor resigned" : "Statutory auditor changed mid-term";
  if (t.has("audit_qualification")) return "Auditor qualified the accounts";
  if (t.has("kmp_resignation")) return `${role ?? "Senior executive"}${name ? ` ${name}` : ""} resigned`;
  if (t.has("promoter_sale")) return /open market/i.test(s) ? "Promoter sold shares in the open market" : "Promoter sold shares";
  if (t.has("pledge_increase")) return /invo[kc]/i.test(s) ? "Lender invoked pledged promoter shares" : "Promoter pledged more shares";
  if (t.has("insolvency")) {
    if (/set(?:ting)? aside|dismiss|quash|withdraw|stay(?:ed)? the/i.test(s)) return "Insolvency order set aside or stayed on appeal";
    if (/appeal|nclat|update|hearing|listed/i.test(s)) return "Update on insolvency proceedings";
    return "Insolvency proceedings filed";
  }
  if (t.has("regulatory_penalty")) return "Regulator imposed a penalty";
  if (t.has("rating_downgrade")) {
    const m = ratingMove(s);
    return m ? `Credit rating downgraded from ${m.from} to ${m.to}` : "Credit rating downgraded";
  }
  if (f.rotation) return "Auditor changed on mandatory rotation";

  switch (f.sub_kind) {
    case "results": return q ? `${q} results announced` : "Quarterly results announced";
    case "board_meeting_notice": {
      const d = extractDate(s);
      return d ? `Board meets ${d} to consider results` : "Board meeting date announced";
    }
    case "investor_presentation": return q ? `${q} investor presentation posted` : "Investor presentation posted";
    case "press_release": return q ? `Press release on ${q} results` : "Press release issued";
    case "transcript": return q ? `${q} earnings call transcript posted` : "Earnings call transcript posted";
    case "order_win": return "New order won";
    case "resignation": return `${role ?? "Director"}${name ? ` ${name}` : ""} resigned`;
    case "appointment": {
      const re = /re-?appoint/i.test(s) ? "re-appointed" : "appointed";
      if (name) return `${name} ${re}${role ? ` as ${role}` : ""}`;
      return role ? `New ${role} ${re}` : cleanSubject(s);
    }
    case "disruption": return cleanSubject(s);
    case "smp_change": return "Senior management change";
    case "postal_ballot":
      return /notice/i.test(s) ? "Postal ballot notice issued" : /outcome|result|scrutini/i.test(s) ? "Postal ballot results declared" : "Postal ballot update";
    case "shareholder_meeting":
      return /outcome|result|scrutini|proceedings/i.test(s) ? "Shareholder meeting results declared" : /notice/i.test(s) ? "Shareholder meeting called" : "Shareholder meeting update";
    case "rating_action": {
      const m = ratingMove(s);
      if (m?.direction === "up") return `Credit rating upgraded from ${m.from} to ${m.to}`;
      return /reaffirm/i.test(s) ? "Credit rating reaffirmed" : "Credit rating update";
    }
    case "promoter_trade": return /\b(?:acqui|purchas|bought|buy)/i.test(s) ? "Promoter bought shares" : "Promoter share transaction";
    case "pledge": return /releas|revok|revoc/i.test(s) ? "Pledge on promoter shares released" : "Pledge disclosure";
    case "trading_window": return "Trading window closed";
    case "newspaper_ad": return "Newspaper notice published";
    case "share_certificate_loss": return "Lost share certificate reported";
    case "investor_meet_schedule": return "Investor meetings scheduled";
    case "earnings_call_intimation": return "Earnings call scheduled";
    case "esop_allotment": return "Shares allotted under ESOP";
    case "dividend": return "Dividend announced";
    case "record_date": return "Record date fixed";
    default: return cleanSubject(s);
  }
}
