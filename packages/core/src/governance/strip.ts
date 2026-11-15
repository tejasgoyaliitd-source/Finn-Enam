import type { GovernanceFlagRow, StoredFiling } from "../ports";
import type { IstDateTime } from "@finn/shared";

/**
 * Governance strip.
 *
 * 12-month trailing lookback across stored filings to detect governance red flags:
 *   - auditor resignation or qualified audit opinions
 *   - promoter pledge creation or increases
 *   - promoter selling in the open market
 *   - senior leadership exits (MD, CEO, CFO, Company Secretary)
 *   - regulatory orders or penalties
 *   - material related party transactions
 *
 * Output:
 *   If 0 flags in trailing 12 months: "No governance flags in 12 months" (clean, quiet)
 *   If flags exist: listed factually with dates and filing reasons, without sensationalism or emojis.
 */

export type GovernanceFlagKind =
  | "auditor_resignation"
  | "auditor_qualification"
  | "pledge_created"
  | "pledge_increased"
  | "promoter_sell"
  | "senior_exit"
  | "regulatory_order"
  | "related_party";

export interface GovernanceFlag {
  filing_id: number | null;
  symbol: string;
  kind: GovernanceFlagKind;
  detail: string;
  filed_at: IstDateTime;
  date_formatted: string;
}

export interface GovernanceStrip {
  symbol: string;
  clean: boolean;
  count: number;
  line: string;
  flags: GovernanceFlag[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatFlagDate(isoOrIst: string): string {
  const d = new Date(isoOrIst);
  if (isNaN(d.getTime())) return isoOrIst.slice(0, 10);
  // Format in IST (+05:30)
  const utc = d.getTime();
  const istDate = new Date(utc + 5.5 * 3600 * 1000);
  const day = istDate.getUTCDate();
  const month = MONTHS[istDate.getUTCMonth()];
  const year = istDate.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

const NEAR = (a: string, b: string, gap = 80) =>
  new RegExp(`(?:${a})[^.;|]{0,${gap}}?(?:${b})|(?:${b})[^.;|]{0,${gap}}?(?:${a})`);

const AUDITOR = String.raw`\b(?:statutory |secretarial |internal |cost |joint )?auditors?\b`;
const AUDITOR_RESIGN = NEAR(AUDITOR, String.raw`\bresign\w*|\bcessation\b|\bremov\w*|\bcasual vacancy\b`);
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

const PENALTY =
  /\bpenalt(?:y|ies)\b|\bfines?\b[^.;|]{0,40}?\b(?:levied|imposed)\b|\b(?:levied|imposed)\b[^.;|]{0,40}?\bfines?\b|adjudication order|monetary penalty|disgorgement|\bdebarr?\w*/;

const RELATED_PARTY =
  /material related party|approval of (?:material )?related party|related party transaction.*?approv|approv.*?related party transaction|\brpt\b.*?(?:approv|material)/i;

/** Extracts name if mentioned like "Gandharv Tongia, CFO" or "CFO Gandharv Tongia" */
function extractPersonName(text: string): string | null {
  const m =
    /(?:mr\.|ms\.|shri|smt\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})|\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})(?=,\s*(?:CFO|CEO|MD|Company Secretary|Chief))/i.exec(
      text,
    );
  return m ? (m[1] ?? m[2] ?? null) : null;
}

/**
 * Scans a filing subject and exchange category to detect any governance red flags.
 */
export function detectGovernanceFlagsInFiling(filing: {
  id?: number | null;
  symbol: string;
  subject: string;
  exch_category: string;
  filed_at: IstDateTime;
}): GovernanceFlag[] {
  const t = `${filing.exch_category} || ${filing.subject}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b(mr|mrs|ms|dr|shri|smt|rs|no|sr|jr|ltd|pvt|co|inc)\./g, "$1");

  const flags: GovernanceFlag[] = [];
  const filing_id = filing.id ?? null;
  const date_formatted = formatFlagDate(filing.filed_at);

  // 1. Auditor resignation / qualification
  if (AUDITOR_RESIGN.test(t)) {
    if (!ROTATION.test(t)) {
      flags.push({
        filing_id,
        symbol: filing.symbol,
        kind: "auditor_resignation",
        detail: /resign/.test(t) ? "Statutory auditor resigned" : "Auditor changed mid-term",
        filed_at: filing.filed_at,
        date_formatted,
      });
    }
  }
  if (QUALIFIED.test(t) && !NOT_QUALIFIED.test(t)) {
    flags.push({
      filing_id,
      symbol: filing.symbol,
      kind: "auditor_qualification",
      detail: "Auditor issued a qualified audit opinion",
      filed_at: filing.filed_at,
      date_formatted,
    });
  }

  // 2. Promoter pledge created or increased
  if (PLEDGE.test(t) && PLEDGE_UP.test(t) && !PLEDGE_DOWN.test(t)) {
    flags.push({
      filing_id,
      symbol: filing.symbol,
      kind: /invo(?:k|c)/.test(t) ? "pledge_increased" : /creat/.test(t) ? "pledge_created" : "pledge_increased",
      detail: /invo(?:k|c)/.test(t)
        ? "Lender invoked pledged promoter shares"
        : /creat/.test(t)
          ? "Promoter created fresh pledge on shares"
          : "Promoter increased pledged shareholding",
      filed_at: filing.filed_at,
      date_formatted,
    });
  }

  // 3. Promoter selling in the open market
  if (PROMOTER_SALE.test(t) && !NO_SALE.test(t) && !PLEDGE.test(t)) {
    flags.push({
      filing_id,
      symbol: filing.symbol,
      kind: "promoter_sell",
      detail: /open market/.test(t) ? "Promoter sold shares in open market" : "Promoter sold shares",
      filed_at: filing.filed_at,
      date_formatted,
    });
  }

  // 4. Senior leadership exits (MD, CEO, CFO, Company Secretary)
  for (const [roleRegex, label] of KMP) {
    if (NEAR(RESIGN, roleRegex.source, 80).test(t)) {
      const name = extractPersonName(filing.subject);
      const detail = name ? `${label} resigned (${name})` : `${label} resigned`;
      flags.push({
        filing_id,
        symbol: filing.symbol,
        kind: "senior_exit",
        detail,
        filed_at: filing.filed_at,
        date_formatted,
      });
      break;
    }
  }

  // 5. Regulatory orders or penalties
  if (PENALTY.test(t)) {
    flags.push({
      filing_id,
      symbol: filing.symbol,
      kind: "regulatory_order",
      detail: /adjudication order/.test(t)
        ? "Regulator issued an adjudication order"
        : /penalty|fines?/.test(t)
          ? "Regulatory penalty imposed"
          : "Regulatory order or warning issued",
      filed_at: filing.filed_at,
      date_formatted,
    });
  }

  // 6. Material related party transactions
  if (RELATED_PARTY.test(t)) {
    flags.push({
      filing_id,
      symbol: filing.symbol,
      kind: "related_party",
      detail: "Material related party transaction disclosure",
      filed_at: filing.filed_at,
      date_formatted,
    });
  }

  return flags;
}

/**
 * Trailing 12-month lookback across a company's filings to build the Governance Strip.
 */
export function computeGovernanceStrip(
  symbol: string,
  filings: Array<Pick<StoredFiling, "id" | "symbol" | "subject" | "exch_category" | "filed_at">>,
  opts?: { as_of?: Date | IstDateTime },
): GovernanceStrip {
  const asOf = opts?.as_of ? new Date(opts.as_of) : new Date();
  const twelveMonthsAgo = new Date(asOf.getTime() - 365 * 24 * 3600 * 1000);

  // Filter filings in trailing 12 months
  const recent = filings.filter((f) => {
    if (f.symbol !== symbol) return false;
    const filed = new Date(f.filed_at);
    return filed >= twelveMonthsAgo && filed <= asOf;
  });

  // Extract flags and deduplicate
  const allFlags: GovernanceFlag[] = [];
  const seen = new Set<string>();

  for (const f of recent) {
    const detected = detectGovernanceFlagsInFiling(f);
    for (const flag of detected) {
      const key = `${flag.kind}|${flag.date_formatted}|${flag.detail}`;
      if (!seen.has(key)) {
        seen.add(key);
        allFlags.push(flag);
      }
    }
  }

  // Sort chronologically descending
  allFlags.sort((a, b) => new Date(b.filed_at).getTime() - new Date(a.filed_at).getTime());

  if (allFlags.length === 0) {
    return {
      symbol,
      clean: true,
      count: 0,
      line: "No governance flags in 12 months",
      flags: [],
    };
  }

  const line = allFlags.map((f) => `${f.date_formatted}: ${f.detail}`).join("; ");

  return {
    symbol,
    clean: false,
    count: allFlags.length,
    line,
    flags: allFlags,
  };
}

/**
 * Builds the Governance Strip from pre-stored flags in `governance_flags` table.
 */
export function buildGovernanceStripFromFlags(
  symbol: string,
  flags: GovernanceFlagRow[],
  opts?: { as_of?: Date | IstDateTime },
): GovernanceStrip {
  const asOf = opts?.as_of ? new Date(opts.as_of) : new Date();
  const twelveMonthsAgo = new Date(asOf.getTime() - 365 * 24 * 3600 * 1000);

  const filtered = flags
    .filter((f) => {
      if (f.symbol !== symbol) return false;
      const filed = new Date(f.filed_at);
      return filed >= twelveMonthsAgo && filed <= asOf;
    })
    .sort((a, b) => new Date(b.filed_at).getTime() - new Date(a.filed_at).getTime());

  if (filtered.length === 0) {
    return {
      symbol,
      clean: true,
      count: 0,
      line: "No governance flags in 12 months",
      flags: [],
    };
  }

  const mapped: GovernanceFlag[] = filtered.map((f) => ({
    filing_id: f.filing_id,
    symbol: f.symbol,
    kind: f.kind as GovernanceFlagKind,
    detail: f.detail,
    filed_at: f.filed_at,
    date_formatted: formatFlagDate(f.filed_at),
  }));

  const line = mapped.map((f) => `${f.date_formatted}: ${f.detail}`).join("; ");

  return {
    symbol,
    clean: false,
    count: mapped.length,
    line,
    flags: mapped,
  };
}
