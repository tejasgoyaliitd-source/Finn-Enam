export type * from "./ports";
export * from "./time";
export { PoliteHttp, CookieJar, HttpError, RequestBudgetExceeded, BROWSER_HEADERS, type PoliteOptions } from "./http/polite";
export { runIngest, describeError, type RunOutcome, type RunBody } from "./ingest/run";

export { normalizeSubject, dedupeKey, subjectHash, buildFiling } from "./sources/normalize";
export { NseClient, NseBlockedError, NseAnnouncement, normalizeNse } from "./sources/nse";
export { BseClient, BseAnnouncement, normalizeBse, bseSubject } from "./sources/bse";
export { fetchAnnouncements, type AnnouncementsSummary, type SourceTally } from "./sources/announcements";
export { fetchPrices, normalizeQuotes, yahooSymbol, MIN_SESSIONS, type PricesSummary } from "./sources/prices";
export { loadCompanyList, parseNseEquityList, NSE_EQUITY_LIST_URL } from "./sources/companies";
export { fetchScreener, parseScreenerPage, parseNumber, toActuals, type ScreenerFinancials, type ScreenerTable } from "./sources/screener";
export { extractDocument, extractPdfPages, isPdf, MIN_CHARS_PER_PAGE, type DocumentInput, type DocumentResult } from "./sources/documents";
export { refresh, type RefreshPart, type RefreshRequest, type RefreshReport } from "./refresh";
export { MemoryStore, type MemoryRun, type MemoryFiling } from "./memory-store";

// Push triage pipeline
export { ingestFilings, type PipelineReport } from "./pipeline/index";
export { classifyByRules, classificationText, RULES, type Rule, type RuleOutcome } from "./pipeline/rules";
export { classify, CLASSIFY_PROMPT_VERSION, type Classification } from "./pipeline/classify";
export { detectAlwaysAct, ratingMove, type Trigger, type TriggerId, type AlwaysActResult } from "./pipeline/always-act";
export { scoreFiling, ACT_THRESHOLD, CATEGORY_BASE, type ScoreResult } from "./pipeline/score";
export { templateHeadline, acceptableHeadline, cleanSubject, HEADLINE_PROMPT_VERSION } from "./pipeline/headline";
export { findDuplicate, DUPLICATE_WINDOW_MS } from "./pipeline/dedupe";
export { groupFilings, familyOf } from "./pipeline/group";
export { foldFeed, type Feed, type FeedCard, type FeedItem } from "./pipeline/feed";
export { canonicalSubject, signals } from "./pipeline/text";
export { parseMeetingDate } from "./pipeline/dates";

// Results engine
export { extractResults, screenerQuarter, type ResultsJob } from "./results/index";
export { buildResultsCard, preferConsolidated, ebitdaFormula, fmtCr, ResultsError, type BuildInput, type ScreenerQuarter } from "./results/card";
export { parseResultsXbrl, XbrlError } from "./results/xbrl";
export { detectComparability, type ComparabilityFinding } from "./results/comparability";
export { ResultsExtraction, RESULTS_PROMPT_VERSION, statementPages, toStatement, normalizeNumbers, onPage, CORE_FIELDS, type TraceResult } from "./results/pdf";
export { pickPeriods, toCrore, unitFromLabel, monthsBetween, TO_CRORE, FIELDS, type Statement, type Column, type Field, type Unit } from "./results/statement";

// Management record
export { processTranscript, recomputeRecord, type RecordSnapshot, type TranscriptReport } from "./record/index";
export { computeVerdicts, credibilityLine, threadKey, fmtTarget, fmtValue, RULE_VERSION, type VerdictContext } from "./record/verdict";
export { diffCalls, compareTargets, describeItem, type ConcallCard, type DiffItem, type DiffStatus } from "./record/diff";
export { GuidanceExtraction, processExtraction, extractGuidance, stableUuid, GUIDANCE_PROMPT_VERSION, type Processed, type Dropped } from "./record/extract";
export { quoteMatchRatio, verifyQuote, findHedges, words } from "./record/quotes";
export { ActualsBook } from "./record/actuals";
export { canonicalMetric, tolerance, MEASURABLE } from "./record/metrics";
export { normalizePeriod, periodQuarters, quarterOrdinal, priorYear, periodLabel } from "./record/periods";

// Governance and ethics
export {
  computeGovernanceStrip,
  buildGovernanceStripFromFlags,
  detectGovernanceFlagsInFiling,
  formatFlagDate,
  checkSegmentMandate,
  checkMandateBreachInFiling,
  classifySegmentActivity,
  countSeniorExits,
  extractPeopleFromText,
  ExtractedPerson,
  PeopleAction,
  PeopleExtractionSchema,
  PEOPLE_PROMPT_VERSION,
  PEOPLE_SYSTEM_PROMPT,
  SENIOR_ROLES,
  governanceStrip,
  checkAnnualReportMandate,
  extractPeopleChange,
  SegmentExtraction,
  SEGMENTS_PROMPT_VERSION,
  type GovernanceFlag,
  type GovernanceFlagKind,
  type GovernanceStrip,
  type MandateBreach,
  type MandateCheckResult,
  type MandateFilingCheck,
  type SegmentInput,
  type SegmentReportInput,
  type PeopleExtraction,
  type PeopleReport,
} from "./governance/index";

// LLM 4-Tier Router
export {
  ModelRouter,
  providerFor,
  withSchema,
  estimateCostInr,
  MODEL_PRICING,
  DEFAULT_MODELS,
  TASK_CONFIG,
  IGNORED_MODELS,
  isModerationModel,
  isTransientOrRateLimit,
  type ModelRouterDeps,
  type ProviderCall,
  type ProviderResponse,
  type ProviderTransport,
  type RouterEnv,
  type TaskTierConfig,
  type TierLevel,
} from "./llm/index";

// API & Research support
export { parseScreenerDocuments, callQuarter, bseAttachmentUrl, type ListedDocuments } from "./research/documents";
export { scanPriceAlerts, describeAlert, describeAlerts, type AlertEvent, type PricePoint, type ScanOptions } from "./alerts/scan";
