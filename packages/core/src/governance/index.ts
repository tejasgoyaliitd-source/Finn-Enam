export {
  computeGovernanceStrip,
  buildGovernanceStripFromFlags,
  detectGovernanceFlagsInFiling,
  formatFlagDate,
  type GovernanceFlag,
  type GovernanceFlagKind,
  type GovernanceStrip,
} from "./strip";

export {
  checkSegmentMandate,
  checkMandateBreachInFiling,
  classifySegmentActivity,
  type MandateBreach,
  type MandateCheckResult,
  type MandateFilingCheck,
  type SegmentInput,
  type SegmentReportInput,
} from "./mandate";

export {
  countSeniorExits,
  extractPeopleFromText,
  ExtractedPerson,
  PeopleAction,
  PeopleExtractionSchema,
  PEOPLE_PROMPT_VERSION,
  PEOPLE_SYSTEM_PROMPT,
  SENIOR_ROLES,
  type PeopleExtraction,
} from "./people";

export { governanceStrip, checkAnnualReportMandate, extractPeopleChange, SegmentExtraction, SEGMENTS_PROMPT_VERSION, type PeopleReport } from "./run";
