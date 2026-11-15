import type { MandateActivity } from "@finn/shared";

/**
 * Ethical mandate checker.
 *
 * Fund ethical exclusions:
 *   1. alcohol: alcoholic beverages, distilleries, breweries, liquor, beer, wine
 *   2. tobacco: cigarettes, cigars, bidi, nicotine, gutkha
 *   3. gambling: gambling, betting, casinos, real money gaming (RMG), lotteries
 *   4. animal_harm: leather, tanning, slaughterhouses, meat processing, animal testing
 *
 * Segment scanner:
 *   Tags revenue from excluded segments in annual reports and outputs:
 *   "About X% of revenue from [segment] (AR [period], p.[page])"
 *   If 100% clean: "Within your exclusions"
 *
 * M&A Breach detection:
 *   If an acquisition or joint venture is in an excluded activity, flags it as an
 *   Act-tier mandate breach immediately.
 */

export interface SegmentInput {
  name: string;
  revenue: number;
  page?: number;
  /** Tag from the tier-1 model, used only when the segment name itself doesn't match an exclusion. */
  activity?: MandateActivity | null;
}

export interface SegmentReportInput {
  symbol: string;
  period: string; // e.g. "FY26"
  total_revenue?: number;
  segments: SegmentInput[];
  default_page?: number;
}

export interface MandateBreach {
  activity: MandateActivity;
  activity_label: string;
  segment: string;
  revenue: number;
  total_revenue: number;
  revenue_pct: number;
  page: number | null;
  citation: string;
}

export interface MandateCheckResult {
  symbol: string;
  clean: boolean;
  breaches: MandateBreach[];
  line: string;
}

export interface MandateFilingCheck {
  is_breach: boolean;
  tier?: "act";
  activity?: MandateActivity;
  reason?: string;
}

const EXCLUSION_PATTERNS: Record<MandateActivity, { label: string; regex: RegExp }> = {
  alcohol: {
    label: "alcoholic beverages",
    // Not "spirit" (team spirit) or "fermentation" (pharma, enzymes); "non-alcoholic" is excluded.
    regex: /(?<!non[- ])\b(?:alcoholic|alcohol|beers?|wines?|spirits|brewer(?:y|ies)|distiller(?:y|ies)|liquor|imfl|whisk(?:e)?y|vodka)\b/i,
  },
  tobacco: {
    label: "tobacco products",
    regex: /\b(?:tobacco|cigarettes?|cigars?|bidis?|gutkha|nicotine|pan masala)\b/i,
  },
  gambling: {
    label: "gambling and betting",
    regex: /\b(?:gambling|betting|casinos?|lotter(?:y|ies)|wagering)\b/i,
  },
  real_money_gaming: {
    label: "real-money gaming",
    regex: /\b(?:real[- ]money gaming|\brmg\b|fantasy sports|rummy|poker)\b/i,
  },
  animal_harm: {
    label: "businesses involving animal harm",
    regex: /\b(?:leather|tanner(?:y|ies)|slaughter(?:house)?|abattoir|meat(?: processing)?|poultry processing|fur\b|animal testing)\b/i,
  },
};

/**
 * Classifies a segment name against ethical exclusions.
 */
export function classifySegmentActivity(segmentName: string): MandateActivity | null {
  for (const [activity, { regex }] of Object.entries(EXCLUSION_PATTERNS) as [MandateActivity, { label: string; regex: RegExp }][]) {
    if (regex.test(segmentName)) return activity;
  }
  return null;
}

/**
 * Scans segment reporting from an Annual Report and computes the ethical mandate result.
 */
export function checkSegmentMandate(input: SegmentReportInput): MandateCheckResult {
  const totalRevenue =
    input.total_revenue ?? input.segments.reduce((acc, s) => acc + s.revenue, 0);

  const breaches: MandateBreach[] = [];

  for (const seg of input.segments) {
    const activity = classifySegmentActivity(seg.name) ?? seg.activity ?? null;
    if (!activity) continue;

    const info = EXCLUSION_PATTERNS[activity];
    const pct = totalRevenue > 0 ? (seg.revenue / totalRevenue) * 100 : 0;
    const roundedPct = Math.round(pct * 10) / 10;
    const page = seg.page ?? input.default_page ?? null;
    const pageText = page ? `, p.${page}` : "";
    const citation = `About ${Math.round(roundedPct)}% of revenue from ${seg.name} (AR ${input.period}${pageText})`;

    breaches.push({
      activity,
      activity_label: info.label,
      segment: seg.name,
      revenue: seg.revenue,
      total_revenue: totalRevenue,
      revenue_pct: roundedPct,
      page,
      citation,
    });
  }

  if (breaches.length === 0) {
    return {
      symbol: input.symbol,
      clean: true,
      breaches: [],
      line: "Within your exclusions",
    };
  }

  return {
    symbol: input.symbol,
    clean: false,
    breaches,
    line: breaches.map((b) => b.citation).join("; "),
  };
}

const MA_KEYWORDS =
  /\bacqui\w*|merger|amalgamation|takeover|joint venture|\bjv\b|business transfer|purchase of (?:business|assets|stake)|stake (?:purchase|acquisition)/i;

/**
 * Scans an M&A / Corporate Action filing to detect acquisitions into excluded businesses.
 * An acquisition in an excluded business immediately triggers an Act-tier mandate breach.
 */
export function checkMandateBreachInFiling(filing: {
  subject: string;
  exch_category?: string;
}): MandateFilingCheck {
  const text = `${filing.exch_category ?? ""} || ${filing.subject}`;

  // Check if it is an M&A / investment / JV announcement
  if (!MA_KEYWORDS.test(text)) {
    return { is_breach: false };
  }

  for (const [activity, { label, regex }] of Object.entries(EXCLUSION_PATTERNS) as [MandateActivity, { label: string; regex: RegExp }][]) {
    if (regex.test(text)) {
      // Find the specific matching target or term
      const match = regex.exec(text);
      const matchedTerm = match ? match[0] : label;
      return {
        is_breach: true,
        tier: "act",
        activity,
        reason: `Mandate breach: acquisition in ${label} (${matchedTerm})`,
      };
    }
  }

  return { is_breach: false };
}
