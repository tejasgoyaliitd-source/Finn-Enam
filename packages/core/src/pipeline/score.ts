import type { FilingCategory, FilingTier } from "@finn/shared";
import type { Trigger } from "./always-act";

/** How much each category matters on its own, before position size. Internal only. */
export const CATEGORY_BASE: Record<FilingCategory, number> = {
  results: 45,
  m_and_a: 45,
  regulatory_order: 45,
  disruption: 45,
  fund_raise: 40,
  management_change: 40,
  auditor_change: 40,
  pledging: 35,
  litigation: 35,
  credit_rating: 30,
  capex: 30,
  earnings_call: 30,
  unclassified: 30,
  insider_trading: 25,
  investor_meetings: 20,
  press_release: 20,
  bonus_split: 20,
  dividend: 15,
  agm_egm: 10,
  postal_ballot: 10,
  routine: 0,
};

const LABEL: Record<FilingCategory, string> = {
  results: "Results filing",
  m_and_a: "Deal announcement",
  regulatory_order: "Regulatory order",
  disruption: "Operational disruption",
  fund_raise: "Fund raise",
  management_change: "Management change",
  auditor_change: "Auditor change",
  pledging: "Pledge disclosure",
  litigation: "Litigation update",
  credit_rating: "Credit rating update",
  capex: "Capex update",
  earnings_call: "Earnings call update",
  unclassified: "Unclassified filing",
  insider_trading: "Insider trade disclosure",
  investor_meetings: "Investor material",
  press_release: "Press release",
  bonus_split: "Bonus or split",
  dividend: "Dividend update",
  agm_egm: "Shareholder meeting",
  postal_ballot: "Postal ballot",
  routine: "Routine compliance filing",
};

const ROUTINE_LABEL: Record<string, string> = {
  trading_window: "trading window closure",
  newspaper_ad: "newspaper publication copy",
  share_certificate_loss: "lost share certificate notice",
  investor_meet_schedule: "investor meeting schedule",
  earnings_call_intimation: "earnings call schedule",
  call_recording: "call recording link",
  depository_certificate: "depository certificate",
  compliance_certificate: "compliance certificate",
  esop_allotment: "ESOP allotment",
  unmodified_opinion_declaration: "clean audit opinion declaration",
  no_encumbrance_declaration: "no-pledge declaration",
  board_meeting_notice: "board meeting date notice",
};

/** Each portfolio percentage point adds this much, up to POSITION_CAP. */
const PER_WEIGHT_POINT = 3;
const POSITION_CAP = 30;
/** Act above this. Results for a ~9% position clear it; for a ~2% position they don't. */
export const ACT_THRESHOLD = 70;
const ALWAYS_ACT_FLOOR = 100;

export interface ScoreInput {
  category: FilingCategory;
  sub_kind: string | null;
  routine: boolean;
  triggers: Trigger[];
  rotation: string | null;
  /** Portfolio weight in percent; 0 if not held. */
  weight: number;
}

export interface ScoreResult {
  tier: FilingTier;
  score: number;
  reasons: string[];
}

export const fmtWeight = (w: number) => `${Number(w.toFixed(1))}%`;

export function scoreFiling(i: ScoreInput): ScoreResult {
  const position = Math.min(Math.round(i.weight * PER_WEIGHT_POINT), POSITION_CAP);
  const held = i.weight > 0;
  const positionPhrase = held ? `${fmtWeight(i.weight)} position` : "a company not in the portfolio";

  // 1. Always-Act red flags win over everything, including routine rules.
  if (i.triggers.length > 0) {
    return {
      tier: "act",
      score: ALWAYS_ACT_FLOOR + position,
      reasons: [
        ...i.triggers.map((t) => t.reason),
        "Always flagged: governance red flag",
        held ? `Affects a ${positionPhrase}` : "Company is not in the portfolio",
      ],
    };
  }

  // 2. Routine boilerplate: kept, folded behind a count.
  if (i.routine || i.category === "routine") {
    const what = (i.sub_kind && ROUTINE_LABEL[i.sub_kind]) ?? "standard disclosure";
    return { tier: "routine", score: 0, reasons: [`Routine compliance filing: ${what}`] };
  }

  // 3. Everything else: category importance plus position size.
  const score = CATEGORY_BASE[i.category] + position;
  const reasons = [`${LABEL[i.category]} for ${positionPhrase}`];
  if (i.rotation) reasons.push(i.rotation);
  // Mandatory auditor rotation is compliance: Read at most, however large the position.
  const tier: FilingTier = score >= ACT_THRESHOLD && !i.rotation ? "act" : "read";
  if (tier === "act") reasons.push("Large position makes this material");
  return { tier, score, reasons };
}
