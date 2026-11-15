import type { FilingCategory } from "@finn/shared";

/**
 * Deterministic classifier. Each rule maps a pattern on "<exchange category> || <subject>"
 * (lowercased) to a category and sub-kind.
 *
 * Priority decides overlaps:
 *   90  specific routine boilerplate ("newspaper publication of results" is a newspaper ad)
 *   80  specific red-flag / high-signal patterns
 *   60  specific business events
 *   40  broad category words
 * If the top priority has matches in more than one category the filing is ambiguous, and
 * only then is the tier-1 model asked.
 */
export interface Rule {
  id: string;
  category: FilingCategory;
  sub_kind: string;
  priority: number;
  /** Routine-tier boilerplate: folded behind a count, never deleted. */
  routine?: boolean;
  test: RegExp;
  /** Optional veto: the rule does not match if this does. */
  unless?: RegExp;
}

export const RULES: Rule[] = [
  // ── Routine boilerplate (90) ────────────────────────────────────────────────
  { id: "trading_window", category: "routine", sub_kind: "trading_window", priority: 90, routine: true, test: /trading window/ },
  { id: "newspaper_ad", category: "routine", sub_kind: "newspaper_ad", priority: 90, routine: true,
    test: /newspaper|news paper|publication of (?:the )?(?:notice|advertisement|extract)|advertisement(?:s)? (?:published|in)|e-?paper/ },
  { id: "share_certificate_loss", category: "routine", sub_kind: "share_certificate_loss", priority: 90, routine: true,
    test: /(?:loss|lost|misplace\w*|theft) of (?:share )?certificates?|duplicate (?:share )?certificates?|issue of duplicate/ },
  { id: "investor_meet_schedule", category: "routine", sub_kind: "investor_meet_schedule", priority: 90, routine: true,
    test: /(?:analysts?|institutional investors?|investors?)\s*(?:\/\s*\w+\s*)?(?:meet|meeting|conference)s?\b|schedule of (?:analysts?|investors?)|con\. call updates/,
    unless: /transcript|recording|presentation/ },
  { id: "earnings_call_intimation", category: "routine", sub_kind: "earnings_call_intimation", priority: 90, routine: true,
    test: /(?:earnings|conference|investors?|analysts?) call\b/,
    unless: /transcript|recording|presentation/ },
  { id: "call_recording", category: "routine", sub_kind: "call_recording", priority: 90, routine: true,
    test: /(?:audio|video|call) recording|recording of (?:the )?(?:earnings|conference|analyst|investor)/ },
  { id: "debt_servicing", category: "routine", sub_kind: "debt_servicing", priority: 90, routine: true,
    // Treasury housekeeping: CP issuance/repayment, NCD redemptions, interest servicing.
    test: /(?:redemption|repayment) of (?:commercial papers?|cps?\b|ncds?|non-convertible debentures|debentures|bonds)|(?:allotment|issuance|issue) of commercial papers?|(?:payment|servicing) of interest|interest (?:payment|paid)|regulation (?:50|52\s*\(7\)|57)\b|sebi\/ho\/ddhs/ },
  { id: "use_of_proceeds_report", category: "routine", sub_kind: "use_of_proceeds_report", priority: 90, routine: true,
    test: /monitoring agency report|statement of deviation|deviation (?:and|&|or) variation|regulation 32\b/ },
  { id: "rta_update", category: "routine", sub_kind: "rta_update", priority: 90, routine: true,
    test: /registrar (?:and|&) (?:share )?transfer agent|\brta\b|kfin technologies|link intime|mufg intime/ },
  { id: "reg74_certificate", category: "routine", sub_kind: "depository_certificate", priority: 90, routine: true,
    test: /regulation 74\s*\(5\)|reg\.? 74\s*\(5\)|depositories and participants\)? regulations/ },
  { id: "compliance_certificate", category: "routine", sub_kind: "compliance_certificate", priority: 90, routine: true,
    test: /compliance certificate|regulation (?:7\s*\(3\)|40\s*\(9\)|40\s*\(10\))|reg\.? (?:7\s*\(3\)|40\s*\(9\))|secretarial compliance report|share transfer/ },
  { id: "esop_allotment", category: "routine", sub_kind: "esop_allotment", priority: 90, routine: true,
    test: /\b(?:esops?|esos|esps|employee stock|stock options?)\b/ },
  { id: "unmodified_opinion", category: "routine", sub_kind: "unmodified_opinion_declaration", priority: 90, routine: true,
    test: /unmodified opinion|un-modified opinion|unqualified opinion|declaration .*?audit report/ },
  { id: "no_encumbrance", category: "routine", sub_kind: "no_encumbrance_declaration", priority: 90, routine: true,
    test: /regulation 31\s*\(4\)|no (?:pledge|encumbrance)|nil encumbrance/ },
  { id: "board_meeting_notice", category: "results", sub_kind: "board_meeting_notice", priority: 85, routine: true,
    test: /board meeting intimation|(?:intimation|notice|prior intimation) (?:of|for|regarding) (?:the )?(?:meeting of (?:the )?)?board meeting|board meeting (?:to be held|is scheduled|scheduled|on)\b|meeting of (?:the )?board of directors[^|]{0,40}?(?:is |will be )?(?:scheduled|held on|to be held)/,
    unless: /outcome/ },

  // ── Red flags and high-signal (80) ──────────────────────────────────────────
  { id: "auditor_resignation", category: "auditor_change", sub_kind: "auditor_resignation", priority: 80,
    test: /auditors?\b[^|]{0,80}?resign|resign\w*[^|]{0,80}?\bauditors?\b/ },
  { id: "auditor_change", category: "auditor_change", sub_kind: "auditor_change", priority: 80,
    test: /change in (?:the )?(?:statutory |secretarial |internal |cost )?auditors?|(?:appointment|re-?appointment|cessation|removal) of (?:the )?(?:statutory |secretarial |internal |cost )?auditors?/ },
  { id: "audit_qualification", category: "auditor_change", sub_kind: "audit_qualification", priority: 80,
    test: /qualified (?:audit )?opinion|adverse opinion|disclaimer of opinion|modified opinion|audit qualifications?/,
    unless: /unmodified|un-modified|unqualified/ },
  { id: "kmp_resignation", category: "management_change", sub_kind: "resignation", priority: 80,
    test: /\bresign\w*|step(?:s|ping|ped)? down/, unless: /\bauditors?\b/ },
  { id: "kmp_appointment", category: "management_change", sub_kind: "appointment", priority: 70,
    test: /\b(?:re-?)?appoint\w*|change in (?:directorate|management|key managerial|kmp)|cessation|retire\w*|completion of (?:the )?tenure/,
    unless: /\bauditors?\b/ },
  { id: "smp_change", category: "management_change", sub_kind: "smp_change", priority: 70,
    test: /senior management(?: personnel)?|\bsmp\b/, unless: /resign\w*|step(?:s|ping|ped)? down/ },
  { id: "rating_action", category: "credit_rating", sub_kind: "rating_action", priority: 80,
    test: /credit rating|\bratings?\b.*?(?:assign|reaffirm|revis|upgrad|downgrad|withdr|watch)|\b(?:crisil|icra|care ratings|india ratings|ind-ra|brickwork|acuite|infomerics)\b/ },
  { id: "promoter_trade", category: "insider_trading", sub_kind: "promoter_trade", priority: 80,
    test: /promoters?\b[^|]{0,100}?\b(?:sale|sold|sell\w*|dispos\w*|offload\w*|acqui\w*|purchas\w*|bought|buy)|(?:sale|sold|dispos\w*|acqui\w*|purchas\w*)[^|]{0,100}?\bpromoters?\b|offer for sale/,
    unless: /pledg|encumb/ },
  { id: "insider_disclosure", category: "insider_trading", sub_kind: "insider_disclosure", priority: 70,
    test: /regulation 7\s*\(2\)|reg\.? 7\s*\(2\)|regulation 29\s*\(\d\)|insider trading|prohibition of insider|substantial acquisition|takeover regulations/ },
  { id: "pledge", category: "pledging", sub_kind: "pledge", priority: 85,
    test: /pledg\w*|encumb\w*|regulation 31\s*\(1\)|regulation 31\s*\(2\)/ },
  { id: "insolvency", category: "regulatory_order", sub_kind: "insolvency", priority: 80,
    test: /insolven\w*|\bcirp\b|\bibc\b|corporate insolvency|winding[- ]up|liquidat\w*/ },
  { id: "regulatory_penalty", category: "regulatory_order", sub_kind: "penalty", priority: 80,
    test: /penalt(?:y|ies)|\bfines?\b[^|]{0,40}?(?:levied|imposed)|(?:levied|imposed)[^|]{0,40}?\bfines?\b|adjudication order|disgorgement|debarr?\w*/ },
  { id: "disruption", category: "disruption", sub_kind: "disruption", priority: 80,
    test: /strikes?\b|lock-?outs?|disturbances?|\bfire\b(?: at| in| incident| broke)|accident|explosion|flood\w*|cyber(?:security)?[ -](?:incident|attack|breach)|ransomware|data breach|(?:plant|factory|unit|operations?) (?:shut ?down|suspended|closure)|suspension of (?:operations|production)|force majeure/ },
  { id: "regulatory_notice", category: "regulatory_order", sub_kind: "regulatory_notice", priority: 75,
    // "SEBI (" is the name of a regulation in nearly every subject, not the regulator acting.
    test: /show[- ]cause|(?:order|notice|demand)[^|]{0,60}?(?:\bsebi\b(?!\s*\()|\brbi\b|\bgst\b|income[- ]tax|customs|enforcement directorate|\bcci\b|nclt|tax authorit|commissioner)|(?:\bsebi\b(?!\s*\()|\brbi\b|\bgst\b|income[- ]tax|tax authorit|enforcement directorate)[^|]{0,60}?(?:order|notice|demand|search|inspection)|action\(?s?\)? taken or orders? passed/ },

  // ── Business events (60) ────────────────────────────────────────────────────
  // 62: a results outcome that also declares a dividend or approves a raise is a results filing.
  // A bare "Outcome of Board Meeting" matches nothing here and goes to the model.
  { id: "financial_results", category: "results", sub_kind: "results", priority: 62,
    test: /financial results?|unaudited.*?results|audited.*?results|results for the (?:quarter|half|year|period)|financial result updates|outcome of (?:the )?board meeting[^|]{0,80}?(?:quarter|half[- ]year|year) ended/ },
  { id: "media_clarification", category: "press_release", sub_kind: "clarification", priority: 60,
    test: /clarification|media reports?|news (?:item|article|report)|rumou?rs?/ },
  { id: "investor_presentation", category: "investor_meetings", sub_kind: "investor_presentation", priority: 65,
    test: /investor presentation|earnings presentation|analyst presentation|investors? (?:\/ analysts? )?presentation|information update for the (?:quarter|half|year)|(?:investor|earnings|quarterly) update/ },
  { id: "call_transcript", category: "earnings_call", sub_kind: "transcript", priority: 65, test: /transcript/ },
  // 64: a press release ABOUT results is still a press release (it folds under the results event).
  { id: "press_release", category: "press_release", sub_kind: "press_release", priority: 64, test: /press release|media release/ },
  { id: "order_win", category: "press_release", sub_kind: "order_win", priority: 60,
    test: /(?:award|receipt|bagging|securing) of (?:an? )?(?:new )?(?:orders?|contracts?)|orders? (?:win|won|received|bagged|secured|worth)|letter of (?:award|intent)|\bloa\b|work order|purchase order/,
    unless: /\btax\b|\bgst\b|penalt|demand|\bsebi\b(?!\s*\()|show[- ]cause/ },
  { id: "fund_raise", category: "fund_raise", sub_kind: "fund_raise", priority: 60,
    test: /\bqip\b|qualified institutions? placement|preferential (?:issue|allotment)|rights issue|fund[- ]?rais\w*|raising of funds|issue of (?:ncds?|non-convertible debentures|bonds|warrants|commercial paper)|allotment of (?:ncds?|non-convertible debentures|bonds|warrants|equity shares)/ },
  { id: "m_and_a", category: "m_and_a", sub_kind: "m_and_a", priority: 60,
    test: /acquisition|amalgamation|merger|scheme of arrangement|demerger|takeover|joint venture|share purchase agreement|divest\w*|stake sale|business transfer/ },
  { id: "capex", category: "capex", sub_kind: "capex", priority: 60,
    test: /capacity expansion|new (?:plant|facility|unit)|\bcapex\b|commissioning|commercial production|greenfield|brownfield/ },
  { id: "dividend", category: "dividend", sub_kind: "dividend", priority: 60, test: /dividend/ },
  { id: "record_date", category: "dividend", sub_kind: "record_date", priority: 50, test: /record date|book closure/ },
  { id: "bonus_split", category: "bonus_split", sub_kind: "bonus_split", priority: 60, test: /\bbonus\b|sub-?division|stock split|split of (?:equity )?shares/ },
  { id: "agm_egm", category: "agm_egm", sub_kind: "shareholder_meeting", priority: 55,
    test: /annual general meeting|\bagm\b|extra-?ordinary general meeting|\begm\b|shareholders? meeting|scrutinizer|voting results/ },
  // 56: "voting results of postal ballot" is a postal ballot, not an AGM.
  { id: "postal_ballot", category: "postal_ballot", sub_kind: "postal_ballot", priority: 56, test: /postal ballot/ },

  // ── Broad (40) ──────────────────────────────────────────────────────────────
  { id: "litigation", category: "litigation", sub_kind: "litigation", priority: 40,
    test: /litigation|lawsuit|arbitra\w*|high court|supreme court|tribunal|legal proceedings|\bdispute\b/ },
];

export type RuleOutcome =
  | { kind: "match"; rule: Rule }
  | { kind: "ambiguous"; candidates: Rule[] }
  | { kind: "none" };

export function classificationText(exchCategory: string, subject: string): string {
  return `${exchCategory} || ${subject}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\(s\)/g, "s") // "Analyst(s)/Investor(s)"
    .replace(/\bun-audited\b/g, "unaudited");
}

export function classifyByRules(exchCategory: string, subject: string): RuleOutcome {
  const text = classificationText(exchCategory, subject);
  const hits = RULES.filter((r) => r.test.test(text) && !(r.unless && r.unless.test(text)));
  if (hits.length === 0) return { kind: "none" };
  const top = Math.max(...hits.map((r) => r.priority));
  const best = hits.filter((r) => r.priority === top);
  const categories = new Set(best.map((r) => r.category));
  return categories.size === 1 ? { kind: "match", rule: best[0]! } : { kind: "ambiguous", candidates: best };
}
