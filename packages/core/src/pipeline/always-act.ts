/**
 * The Always-Act list, in code. These detectors run on the raw text of EVERY filing,
 * independently of classification, so a rule gap or a model mistake can never route a
 * governance red flag to Read or Routine.
 *
 *   auditor resignation or exit · audit qualification · promoter selling · pledge created,
 *   increased or invoked · resignation of MD, CEO, CFO or company secretary · regulatory
 *   penalty · insolvency · credit rating downgrade
 *
 * One exception: an auditor change that cites mandatory rotation / completion of term under
 * the Companies Act is normal compliance, and is downgraded to Read.
 */

export type TriggerId =
  | "auditor_exit"
  | "audit_qualification"
  | "promoter_sale"
  | "pledge_increase"
  | "kmp_resignation"
  | "regulatory_penalty"
  | "insolvency"
  | "rating_downgrade"
  | "mandate_breach";

export interface Trigger {
  id: TriggerId;
  /** Plain-language reason shown to the user. */
  reason: string;
}

export interface AlwaysActResult {
  triggers: Trigger[];
  /** Set when an auditor change was downgraded because it is mandatory rotation. */
  rotation: string | null;
}

const NEAR = (a: string, b: string, gap = 80) => new RegExp(`(?:${a})[^.;|]{0,${gap}}?(?:${b})|(?:${b})[^.;|]{0,${gap}}?(?:${a})`);

const AUDITOR = String.raw`\b(?:statutory |secretarial |internal |cost |joint )?auditors?\b`;
const AUDITOR_EXIT = NEAR(AUDITOR, String.raw`\bresign\w*|\bchange in\b|\bcessation\b|\bremov\w*|\bvacat\w*|\bcasual vacancy\b`);
const ROTATION = /\brotation\b|completion of (?:the |his |her |their |its )?(?:second |first |2nd |1st )?(?:term|tenure)|section 139\s*\(2\)|(?:second|two) consecutive terms?|term of five (?:consecutive )?years/;

const QUALIFIED = /qualified (?:audit )?opinion|adverse opinion|disclaimer of opinion|modified opinion|audit qualifications?/;
const NOT_QUALIFIED = /unmodified|un-modified|unqualified|no (?:audit )?qualifications?/;

const PROMOTER = String.raw`\bpromoters?\b`;
const SELL = String.raw`\bsale\b|\bsold\b|\bsell\w*|\bdispos\w*|\boffload\w*|offer for sale`;
const PROMOTER_SALE = NEAR(PROMOTER, SELL, 120);
const NO_SALE = /\b(?:no|nil) (?:sale|change|disposal)\b/;

const PLEDGE = /\bpledg\w*|\bencumb\w*/;
const PLEDGE_UP = /\bcreat\w*|\bincreas\w*|\badditional\b|\bfresh\b|\binvo(?:k|c)\w*/;
const PLEDGE_DOWN = /\breleas\w*|\brevoc\w*|\brevok\w*|no (?:pledge|encumbrance)|nil encumbrance|regulation 31\s*\(4\)/;

const KMP: [RegExp, string][] = [
  [/\bchief financial officer\b|\bcfo\b/, "CFO"],
  [/\bchief executive officer\b|\bceo\b/, "CEO"],
  [/\bmanaging director\b|\bmd\b|\bmd & ceo\b/, "Managing Director"],
  [/\bcompany secretary\b|\bcs\b(?= and compliance| & compliance)/, "Company Secretary"],
];
const RESIGN = String.raw`\bresign\w*|\bstep(?:s|ping|ped)? down\b`;

const PENALTY = /\bpenalt(?:y|ies)\b|\bfines?\b[^.;|]{0,40}?\b(?:levied|imposed)\b|\b(?:levied|imposed)\b[^.;|]{0,40}?\bfines?\b|adjudication order|monetary penalty|disgorgement|\bdebarr?\w*/;
const INSOLVENCY = /\binsolven\w*|\bcirp\b|\bibc\b|corporate insolvency resolution|winding[- ]up petition|\bliquidation\b/;

/** Long-term and short-term scales, best first. Index = notches below the top. */
const LONG = ["AAA", "AA+", "AA", "AA-", "A+", "A", "A-", "BBB+", "BBB", "BBB-", "BB+", "BB", "BB-", "B+", "B", "B-", "C+", "C", "C-", "D"];
const SHORT = ["A1+", "A1", "A2+", "A2", "A3+", "A3", "A4+", "A4", "D"];
const AGENCY = String.raw`(?:\[?(?:ICRA|CRISIL|CARE|IND|Ind-?Ra|BWR|Brickwork|ACUITE|Acuite|IVR|Infomerics)\]?\s*)?`;
const GRADE = String.raw`(A[1-4]\+?|AAA|AA[+-]?|A[+-]?|BBB[+-]?|BB[+-]?|B[+-]?|C[+-]?|D)(?![A-Za-z0-9])`;
const FROM_TO = new RegExp(String.raw`from\s+${AGENCY}${GRADE}[^.;|]{0,40}?\bto\s+${AGENCY}${GRADE}`);

/** Compares "from X to Y" on the ratings scale. Case-sensitive on purpose: grades are upper case. */
export function ratingMove(subject: string): { from: string; to: string; direction: "down" | "up" | "same" } | null {
  const m = FROM_TO.exec(subject);
  if (!m) return null;
  const [from, to] = [m[1]!, m[2]!];
  const scale = LONG.includes(from) && LONG.includes(to) ? LONG : SHORT.includes(from) && SHORT.includes(to) ? SHORT : null;
  if (!scale) return null;
  const d = scale.indexOf(to) - scale.indexOf(from);
  return { from, to, direction: d > 0 ? "down" : d < 0 ? "up" : "same" };
}

export function detectAlwaysAct(exchCategory: string, subject: string): AlwaysActResult {
  // Proximity checks stop at full stops so they never join two sentences; the dots in
  // "Mr.", "Rs." and "No." are not sentence ends, so drop them first.
  const t = `${exchCategory} || ${subject}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b(mr|mrs|ms|dr|shri|smt|rs|no|sr|jr|ltd|pvt|co|inc)\./g, "$1");
  const triggers: Trigger[] = [];
  let rotation: string | null = null;

  if (AUDITOR_EXIT.test(t)) {
    if (ROTATION.test(t)) {
      rotation = "Auditor change is mandatory rotation under the Companies Act: normal compliance";
    } else {
      triggers.push({ id: "auditor_exit", reason: /resign/.test(t) ? "Auditor resigned" : "Auditor changed mid-term" });
    }
  }
  if (QUALIFIED.test(t) && !NOT_QUALIFIED.test(t)) {
    triggers.push({ id: "audit_qualification", reason: "Auditor qualified the accounts" });
  }
  if (PROMOTER_SALE.test(t) && !NO_SALE.test(t) && !PLEDGE.test(t)) {
    triggers.push({ id: "promoter_sale", reason: /open market/.test(t) ? "Promoter sold shares in open market" : "Promoter sold shares" });
  }
  if (PLEDGE.test(t) && PLEDGE_UP.test(t) && !PLEDGE_DOWN.test(t)) {
    triggers.push({ id: "pledge_increase", reason: /invo(?:k|c)/.test(t) ? "Lender invoked pledged promoter shares" : "Promoter pledged more shares" });
  }
  for (const [role, label] of KMP) {
    if (NEAR(RESIGN, role.source, 80).test(t)) {
      triggers.push({ id: "kmp_resignation", reason: `${label} resigned` });
      break;
    }
  }
  if (PENALTY.test(t)) triggers.push({ id: "regulatory_penalty", reason: "Regulator imposed a penalty" });
  if (INSOLVENCY.test(t)) triggers.push({ id: "insolvency", reason: "Insolvency proceedings filed" });

  const move = ratingMove(subject);
  if (move?.direction === "down" || (/\bdowngrad\w*/.test(t) && !/\bupgrad\w*/.test(t))) {
    triggers.push({ id: "rating_downgrade", reason: move ? `Credit rating downgraded from ${move.from} to ${move.to}` : "Credit rating downgraded" });
  }
  return { triggers, rotation };
}
