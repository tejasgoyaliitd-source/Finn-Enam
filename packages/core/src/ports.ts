/**
 * Everything packages/core needs from the outside world. Core never performs I/O itself:
 * no fetch, no fs, no database client. Callers (apps/api, tools/refresher) inject
 * implementations from @finn/adapters, and tests inject fakes.
 */
import type { ZodType } from "zod";
import type { AnalysisMethod, Basis, FilingCategory, FilingTier, GuidanceStatement, IstDateTime, NormalizedFiling, ResultsCard, Verdict } from "@finn/shared";

// ─── HTTP ───────────────────────────────────────────────────────────────────

export interface HttpRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  /** Final URL after redirects. */
  url: string;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  /** Each Set-Cookie header separately (they can't be joined safely). */
  setCookies: string[];
  text(): Promise<string>;
  bytes(): Promise<Uint8Array>;
}

/** A thin transport. Throttling, retries and cookies are handled in core (see http/polite.ts). */
export interface HttpClient {
  request(req: HttpRequest): Promise<HttpResponse>;
}

// ─── Time, hashing, logging ─────────────────────────────────────────────────

export interface Clock {
  now(): Date;
  sleep(ms: number): Promise<void>;
}

export interface Hasher {
  /** Lowercase hex SHA-256. */
  sha256(data: Uint8Array | string): Promise<string>;
}

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

// ─── Persistence ────────────────────────────────────────────────────────────

export type IngestSource = "nse" | "bse" | "yahoo" | "screener" | "documents" | "results" | "guidance" | "nse_equity_list";
export type IngestRunner = "cron" | "pinger" | "refresher" | "manual";
export type IngestStatus = "ok" | "partial" | "failed";

export interface CompanyRef {
  symbol: string;
  bse_code: string | null;
  is_bank: boolean;
}

export interface PriceRow {
  symbol: string;
  /** IST trading date, YYYY-MM-DD. */
  date: string;
  close: number;
  volume: number;
}

export interface FilingRow extends NormalizedFiling {
  /** The exchange's original record. */
  raw: Record<string, unknown>;
}

export interface ActualRow {
  symbol: string;
  period: string;
  metric: string;
  basis: Basis;
  value: number;
  unit: "pct" | "inr_cr" | "other";
  /** screener: FINN standard lines; transcript: figures management reported on a call (canonical metric key). */
  source: "screener" | "transcript";
}

export interface DocumentRow {
  /** Stable id derived from the SHA-256, so other rows can reference the document. */
  id: string;
  symbol: string;
  type: "annual_report" | "transcript" | "results" | "filing" | "presentation";
  period: string | null;
  url: string;
  sha256: string;
  pages: number | null;
  storage_path: string | null;
  readable: boolean;
}

export interface NewFilingRow extends FilingRow {
  /** Id of the original this repeats, or null. */
  duplicate_of: number | null;
}

/** A filing already in the database, with its analysis if it has one. */
export interface StoredFiling {
  id: number;
  symbol: string;
  exchange: "NSE" | "BSE";
  exch_category: string;
  subject: string;
  filed_at: IstDateTime;
  dedupe_key: string;
  subject_hash: string | null;
  duplicate_of: number | null;
  analysis: { category: FilingCategory; sub_kind: string | null; tier: FilingTier; event_id: number | null; headline: string | null } | null;
}

export interface EventRow {
  id: number;
  symbol: string;
  kind: FilingCategory;
  primary_filing_id: number;
  filed_at: IstDateTime;
}

export interface AnalysisRow {
  filing_id: number;
  category: FilingCategory;
  sub_kind: string | null;
  tier: FilingTier;
  score: number;
  reasons: string[];
  headline: string;
  method: AnalysisMethod;
  model: string | null;
  event_id: number | null;
}

export interface Store {
  startRun(source: IngestSource, runner: IngestRunner): Promise<number>;
  finishRun(id: number, r: { status: IngestStatus; rows_ingested: number; error: string | null; cursor?: string | null }): Promise<void>;

  listHoldings(portfolioId?: string): Promise<CompanyRef[]>;
  getCompany(symbol: string): Promise<CompanyRef | null>;
  /** Add listed companies; rows already present are kept as they are. Returns how many were new. */
  upsertCompanies?(rows: { symbol: string; name: string; isin: string; is_bank: boolean }[]): Promise<number>;
  /** symbol → weight_pct for a portfolio (default: the demo portfolio). */
  positionWeights(portfolioId?: string): Promise<Record<string, number>>;

  /** Upsert on (symbol, date). Returns rows written. */
  upsertPrices(rows: PriceRow[]): Promise<number>;

  /** Filings for these symbols filed at or after `since`, with their analysis. */
  recentFilings(symbols: string[], since: Date): Promise<StoredFiling[]>;
  /** Insert, skipping rows whose dedupe_key already exists. Returns the rows actually inserted. */
  insertFilings(rows: NewFilingRow[]): Promise<{ id: number; dedupe_key: string }[]>;
  recentEvents(symbols: string[], since: Date): Promise<EventRow[]>;
  createEvent(e: Omit<EventRow, "id">): Promise<number>;
  setEventPrimary(eventId: number, primaryFilingId: number, filedAt: IstDateTime): Promise<void>;
  /** Upsert on filing_id. */
  upsertAnalyses(rows: AnalysisRow[]): Promise<number>;

  /** Upsert on (symbol, period, metric, basis). Returns rows written. */
  upsertActuals(rows: ActualRow[]): Promise<number>;
  /** All stored actuals for one company and period (both bases). */
  getActuals(symbol: string, period: string): Promise<ActualRow[]>;
  /** Upsert on (symbol, period, basis). */
  upsertResultsCard(card: ResultsCard, filingId: number | null): Promise<void>;
  /** Every stored actual for a company (all periods, both bases, all sources). */
  listActuals(symbol: string): Promise<ActualRow[]>;

  /** Upsert on id (ids are stable per document + page + quote). */
  upsertGuidance(rows: GuidanceStatement[]): Promise<number>;
  listGuidance(symbol: string): Promise<GuidanceStatement[]>;
  /** Quarters of the earnings calls stored for a company (transcript documents). */
  listCalls(symbol: string): Promise<string[]>;
  /** Upsert on statement_id. */
  upsertVerdicts(rows: Verdict[]): Promise<number>;

  documentExists(sha256: string): Promise<boolean>;
  /** Page texts stored for a document, or null. */
  getDocumentText(sha256: string): Promise<string[] | null>;
  /** Stores page texts (gzip JSON) in the documents bucket; returns the storage path. */
  saveDocumentText(sha256: string, pages: string[]): Promise<string>;
  insertDocument(row: DocumentRow): Promise<void>;

  /** Governance flags */
  listGovernanceFlags?(symbol: string, since?: Date): Promise<GovernanceFlagRow[]>;
  upsertGovernanceFlags?(rows: GovernanceFlagRow[]): Promise<number>;

  /** People events */
  listPeopleEvents?(symbol: string, since?: Date): Promise<PeopleEventRow[]>;
  upsertPeopleEvents?(rows: PeopleEventRow[]): Promise<number>;

  /** LLM caching and call accounting */
  getLlmCache?(key: string): Promise<unknown | null>;
  setLlmCache?(key: string, row: { task: string; model: string; prompt_version: string; output: unknown }): Promise<void>;
  logLlmCall?(row: LlmCallRow): Promise<void>;
}

export interface GovernanceFlagRow {
  symbol: string;
  filing_id: number | null;
  kind:
    | "auditor_change"
    | "auditor_resignation"
    | "auditor_qualification"
    | "pledge_created"
    | "pledge_increased"
    | "pledge_released"
    | "promoter_buy"
    | "promoter_sell"
    | "senior_exit"
    | "regulatory_order"
    | "related_party";
  detail: string;
  filed_at: IstDateTime;
}

export interface PeopleEventRow {
  filing_id: number;
  symbol: string;
  name: string;
  role: string;
  action: "appointed" | "resigned" | "retired" | "removed" | "redesignated" | "ceased";
  effective_date: string | null;
  prior_roles: string[];
  tenure_months: number | null;
  stated_reason: string | null;
  source_page: number | null;
  created_at?: string;
}

export interface LlmCacheRow {
  key: string;
  task: string;
  model: string;
  prompt_version: string;
  output: unknown;
  created_at?: string;
}

export interface LlmCallRow {
  task: string;
  provider: "gemini" | "groq" | "anthropic";
  model: string;
  tokens_in: number;
  tokens_out: number;
  cached: boolean;
  latency_ms: number;
  cost_inr: number;
  ok: boolean;
  error: string | null;
  created_at?: string;
}

// ─── Market data ────────────────────────────────────────────────────────────

export interface ChartQuote {
  date: Date;
  close: number | null;
  volume: number | null;
}

/** Daily OHLCV provider. Implemented with yahoo-finance2's chart module in @finn/adapters. */
export interface ChartClient {
  daily(yahooSymbol: string, from: Date, to: Date): Promise<ChartQuote[]>;
}

// ─── Models ─────────────────────────────────────────────────────────────────

export type LlmTask =
  | "classify_filing"
  | "rewrite_headline"
  | "read_meeting_date"
  | "tag_segments"
  | "extract_results"
  | "extract_people"
  | "extract_guidance"
  | "answer_scoped"
  | "write_risks"
  | "write_questions";

/**
 * Prompts and output schemas live in core (versioned, testable). The client is transport:
 * pick a model for the tier, call it, validate against `schema`, and use llm_cache. It throws
 * on failure; callers always have a deterministic fallback.
 */
export interface LlmRequest<T> {
  task: LlmTask;
  tier: "cheap" | "mid" | "strong";
  promptVersion: string;
  system: string;
  input: string;
  schema: ZodType<T>;
}

export interface LlmClient {
  run<T>(req: LlmRequest<T>): Promise<{ data: T; model: string }>;
}

// ─── Bundle ─────────────────────────────────────────────────────────────────

export interface CoreDeps {
  http: HttpClient;
  clock: Clock;
  hash: Hasher;
  log: Logger;
  store: Store;
  runner: IngestRunner;
  /** Optional tier-1 model. Without it, classification and headlines use rules and templates only. */
  llm?: LlmClient;
  /** Portfolio whose weights drive scoring. Default: the demo portfolio. */
  portfolioId?: string;
  /** Injected so tests are deterministic. Defaults to Math.random. */
  random?: () => number;
}
