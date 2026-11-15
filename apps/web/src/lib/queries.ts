import { queryOptions } from "@tanstack/react-query";
import { api } from "./api";
import { windowFromParams, windowQuery, type BriefWindow } from "./window";

/** Response shapes from finn-api, the subset the web app uses. */
export type Tier = "act" | "read" | "routine";
export type VerdictCode = "met" | "missed" | "behind" | "revised" | "too_early" | "not_measurable" | "not_mentioned_since";
export interface RecordStripData {
  marks: { verdict: VerdictCode; glyph: string }[];
  line: string;
  /** The full sentence for screen readers. */
  label: string;
}
export interface BriefItem {
  event_id: number | null;
  filing_id: number;
  symbol: string;
  name: string;
  weight_pct: number | null;
  category: string;
  record: RecordStripData | null;
  tier: Tier;
  headline: string;
  reasons: string[];
  filed_at: string;
  attachment_url: string | null;
  related: { headline: string; tier: Tier; filed_at: string; attachment_url: string | null }[];
}
export interface BriefData {
  window_used: { from: string; to: string; kind: "since" | "results" };
  widened: boolean;
  message: string | null;
  counts: Record<Tier, number>;
  items: BriefItem[];
  next_cursor: string | null;
  total: number;
  facets: { categories: string[]; symbols: string[] };
  segments: Record<Tier, BriefItem[]> | null;
  routine_summary: { count: number; groups: { label: string; count: number }[] };
  coming_up: { symbol: string; name: string; date: string; label: string; headline: string }[];
}
export type CheckStatus = "pass" | "flag" | "fail" | "skipped";
export interface SourceRef {
  label: string;
  url: string;
  page: number | null;
}
export interface ResultsDetail {
  period: string;
  basis: string | null;
  is_bank: boolean;
  from: "filing" | "screener" | "none";
  rows: { label: string; kind: "cr" | "margin"; value: number | null; qoq: number | null; yoy: number | null }[];
  judgement: string | null;
  checks: { status: CheckStatus; text: string; page: number | null }[];
  source: SourceRef | null;
}
export interface PeopleDetail {
  people: { name: string; role: string; action: string; effective_date: string | null; prior_roles: string[]; tenure_months: number | null; stated_reason: string | null; page: number | null }[];
  senior_exits_12m: number;
  senior_exit_line: string;
  note: string | null;
}
export interface ConcallDetail {
  call: string;
  previous_call: string | null;
  credibility: string;
  revisions: { status: "new" | "unchanged" | "raised" | "lowered" | "changed" | "dropped"; metric: string; period: string | null; from: string | null; to: string | null; quote: string; page: number; call: string }[];
  quotes: { quote: string; page: number; metric: string; target: string }[];
  transcript_url: string | null;
  note: string | null;
}
export interface ItemData {
  filing_id: number;
  kind: "results" | "people" | "concall" | "filing";
  symbol: string;
  name: string;
  weight_pct: number | null;
  tier: Tier;
  headline: string;
  reasons: string[];
  filed_at: string;
  subject: string;
  record: RecordStripData | null;
  credibility: string;
  sources: SourceRef[];
  related: { id: number; headline: string; filed_at: string; url: string | null }[];
  results?: ResultsDetail;
  people?: PeopleDetail;
  concall?: ConcallDetail;
}
export interface AskData {
  refused: boolean;
  reason?: string;
  answer?: string;
  citations?: { n: number; kind: string; label: string; url: string | null; page: number | null }[];
}
export type HoldingState = "Concern" | "Watch" | "On track";
export interface Holding {
  symbol: string;
  name: string;
  sector: string | null;
  weight_pct: number;
  state: HoldingState;
  state_reasons: string[];
  reaction: { change_pct: number; date: string; close: number } | null;
  last_close?: number | null;
  change_abs?: number | null;
  change_pct?: number | null;
  inv_price?: number | null;
  qty?: number | null;
  inv_value?: number | null;
  current_value?: number | null;
  gain_abs?: number | null;
  gain_pct?: number | null;
  credibility: string;
  record: RecordStripData | null;
  mandate: { status: string; line: string };
}
export interface HoldingsData {
  counts: { concern: number; watch: number; on_track: number };
  items: Holding[];
  mandate: { status: "within" | "outside"; line: string; outside: string[] };
}
export interface Delivery {
  connected: boolean;
  sent_today: number;
  budget: number;
  line: string;
  connect_url: string | null;
}
export interface AlertItem {
  id: number;
  symbol: string;
  name: string;
  weight_pct: number | null;
  kinds: ("move_sigma" | "volume_x")[];
  move_pct: number;
  text: string;
  explanation: { filing_id: number; headline: string; filed_at: string; attachment_url: string | null } | null;
  explanation_text: string;
}
export interface AlertsData {
  days: { date: string; items: AlertItem[] }[];
  delivery: Delivery;
}
export const ALERT_CATEGORIES = ["results", "m_and_a", "capex", "fund_raise", "management_change", "earnings_call", "dividend", "credit_rating", "litigation", "bonus_split", "disruption"] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];
export interface CustomAlert {
  id: string;
  symbol: string;
  company_name: string;
  metric: string;
  condition: string;
  threshold: string;
  unit: string;
  summary: string;
  current_value?: string | null;
  status: "pending" | "triggered" | "watching";
  created_at: string;
}
export interface CustomAlertsData {
  pending: CustomAlert[];
}
export interface AlertRules {
  move_sigma: number;
  volume_x: number;
  categories: Record<AlertCategory, boolean>;
  always_first: string;
  delivery?: Delivery;
  rebuilt_alerts?: number;
}
export interface PreviewData {
  move_sigma: number;
  volume_x: number;
  would_have_fired_30d: number;
  by_kind: { move_sigma: number; volume_x: number };
  examples: { symbol: string; date: string; text: string; explanation: string }[];
}
export interface SaveHoldingsData {
  saved: number;
  total_pct: number;
  mandate: HoldingsData["mandate"];
  warnings: string[];
}
export interface SearchData {
  items: { symbol: string; name: string }[];
}
export interface Cite {
  label: string;
  url: string | null;
  page: number | null;
}
export interface ResearchStatus {
  status: "ready" | "running" | "failed" | "none";
  job_id: string | null;
  built_at: string | null;
  error: string | null;
}
export interface CompanyData {
  header: {
    symbol: string;
    name: string;
    sector: string | null;
    weight_pct: number | null;
    held: boolean;
    last_close: number | null;
    change_pct: number | null;
    price_date: string | null;
    sparkline: number[];
    state: HoldingState | null;
    state_reason: string | null;
    record: RecordStripData | null;
    credibility: string;
  };
  research: ResearchStatus;
  latest_event: { filing_id: number; headline: string; tier: Tier; filed_at: string; reasons: string[] } | null;
  record: { credibility: string; statements: number };
  governance: { line: string; count: number; checked?: boolean; flags: { kind: string; detail: string; date: string; filing_id: number | null }[] };
  mandate: { status: "excluded" | "breach" | "clean" | "not_checked"; line: string };
  questions: { text: string; why: string; source: Cite }[];
}
export interface RecordItem {
  id: string;
  call: string;
  metric: string;
  scope: string | null;
  period_target: string | null;
  target: string;
  quote: string;
  page: number;
  source_url: string | null;
  verdict: VerdictCode | null;
  verdict_label: string | null;
  reason: string | null;
  pace_note: string | null;
  delivered: string | null;
}
export interface RecordData {
  credibility: string;
  items: RecordItem[];
}
export interface CompanyResults {
  periods: { value: string; label: string }[];
  period: string | null;
  card: ResultsDetail | null;
  filing_id?: number | null;
  note?: string;
}
export interface CompanyFilings {
  events: { filing_id: number; headline: string; tier: Tier; reasons: string[]; filed_at: string; filings: number; attachment_url: string | null }[];
  total: number;
  page: number;
  pages: number;
  note: string | null;
}
export interface Financials {
  basis: string;
  source: { label: string; url: string };
  cash: { fy: string; cfo: number | null; pat: number | null; ratio: number | null }[];
  trajectory: { fy: string; revenue: number | null; ebitda_margin: number | null; roce: number | null }[];
  roce_note: string;
  risks: { down: { text: string; source: Cite }[]; up: { text: string; source: Cite }[] } | null;
  risks_note: string | null;
  annual_report: { label: string; url: string } | null;
}
export interface ResearchList {
  ready: { symbol: string; name: string; credibility: string; statements: number; built_at: string; held: boolean }[];
  suggestions: { symbol: string; name: string }[];
}
export interface JobData {
  id: string;
  symbol: string;
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  steps: { label: string; state: "pending" | "running" | "done" | "skipped" | "failed"; note: string | null }[];
  progress: { done: number; total: number };
}
export interface SettingsData {
  house_view: {
    mandate: {
      excluded_activities: string[];
      excluded_symbols: string[];
    };
    push: {
      channel: string;
      max_per_day: number;
      digest_time_ist: string;
    };
    muted_sub_kinds: string[];
  };
  materiality: {
    act_threshold: number;
    always_act: string[];
  };
}

export interface MethodData {
  formulas: { ebitda: string; pat_check: string; screener_check: string; cash_conversion: string };
  verdicts: { tolerance: string; quote_check: string; credibility: string };
  model_routing: { tiers: { task: string; tier: number; tier_name: string; default_model: string }[] };
  costs: { calls: number; cached_calls: number; total_inr: number };
}
export interface HealthData {
  status: "ok" | "degraded" | "down";
  sources: { source: string; degraded: boolean; note: string }[];
}

/** The default Feed window (since last results), for the shell's prefetch and badge. */
let bust = 0;
/** Call after saving holdings or rules: the next reads bypass the CDN's cached copy. */
export const bustCache = () => {
  bust = Date.now();
};
const bustQuery = () => (bust && Date.now() - bust < 120_000 ? `?v=${bust}` : "");

export const defaultWindow = (): BriefWindow => windowFromParams(new URLSearchParams());

export interface ListFilters {
  category?: string | null;
  symbol?: string | null;
}

export const q = {
  health: () => queryOptions({ queryKey: ["health"], queryFn: () => api<HealthData>("/v1/health"), staleTime: 30_000 }),
  brief: (w: BriefWindow = defaultWindow()) =>
    queryOptions({ queryKey: ["brief", w.kind, w.since, w.until], queryFn: () => api<BriefData>(`/v1/brief?${windowQuery(w)}`) }),
  briefList: (segment: Tier, cursor: string | null, w: BriefWindow, f: ListFilters = {}) =>
    queryOptions({
      queryKey: ["brief-list", segment, cursor, w.kind, w.since, w.until, f.category ?? null, f.symbol ?? null],
      queryFn: () => {
        const p = new URLSearchParams(windowQuery(w));
        p.set("segment", segment);
        p.set("limit", "20");
        if (cursor) p.set("cursor", cursor);
        if (f.category) p.set("category", f.category);
        if (f.symbol) p.set("symbol", f.symbol);
        return api<BriefData>(`/v1/brief?${p}`);
      },
      placeholderData: (prev) => prev,
    }),
  item: (id: number) => queryOptions({ queryKey: ["item", id], queryFn: () => api<ItemData>(`/v1/items/${id}`), staleTime: 5 * 60_000 }),
  // After a write, `bust` skips the 60-second CDN copy so the change shows at once.
  holdings: () => queryOptions({ queryKey: ["holdings"], queryFn: () => api<HoldingsData>(`/v1/holdings${bustQuery()}`) }),
  alerts: () => queryOptions({ queryKey: ["alerts"], queryFn: () => api<AlertsData>(`/v1/alerts${bustQuery()}`) }),
  customAlerts: () => queryOptions({ queryKey: ["custom-alerts"], queryFn: () => api<CustomAlertsData>("/v1/alerts/custom"), staleTime: 0 }),
  holdingsHistory: () =>
    queryOptions({
      queryKey: ["holdings", "history"],
      queryFn: () => api<{ points: { date: string; index: number }[]; covered: number; holdings: number; weight_covered_pct: number; method: string }>(`/v1/holdings/history${bustQuery()}`),
    }),
  alertRules: () => queryOptions({ queryKey: ["alert-rules"], queryFn: () => api<AlertRules>("/v1/alerts/rules"), staleTime: 0 }),
  preview: (move_sigma: number, volume_x: number) =>
    queryOptions({
      queryKey: ["alerts-preview", move_sigma, volume_x],
      queryFn: () => api<PreviewData>(`/v1/alerts/preview?move_sigma=${move_sigma}&volume_x=${volume_x}`),
      placeholderData: (prev) => prev,
      staleTime: 5 * 60_000,
    }),
  search: (term: string) =>
    queryOptions({ queryKey: ["search", term], queryFn: () => api<SearchData>(`/v1/search?q=${encodeURIComponent(term)}`), enabled: term.length > 0, staleTime: 24 * 3600_000, placeholderData: (prev) => prev }),
  company: (symbol: string) => queryOptions({ queryKey: ["company", symbol], queryFn: () => api<CompanyData>(`/v1/companies/${encodeURIComponent(symbol)}${bustQuery()}`) }),
  record: (symbol: string) => queryOptions({ queryKey: ["company", symbol, "record"], queryFn: () => api<RecordData>(`/v1/companies/${encodeURIComponent(symbol)}/record${bustQuery()}`) }),
  results: (symbol: string, period: string | null) =>
    queryOptions({
      queryKey: ["company", symbol, "results", period],
      queryFn: () => api<CompanyResults>(`/v1/companies/${encodeURIComponent(symbol)}/results${period ? `?period=${period}` : ""}`),
      placeholderData: (prev) => prev,
    }),
  filings: (symbol: string, page: number) =>
    queryOptions({ queryKey: ["company", symbol, "filings", page], queryFn: () => api<CompanyFilings>(`/v1/companies/${encodeURIComponent(symbol)}/filings?page=${page}`), placeholderData: (prev) => prev }),
  financials: (symbol: string) => queryOptions({ queryKey: ["company", symbol, "financials"], queryFn: () => api<Financials>(`/v1/companies/${encodeURIComponent(symbol)}/financials${bustQuery()}`) }),
  researchList: () => queryOptions({ queryKey: ["research-list"], queryFn: () => api<ResearchList>("/v1/research") }),
  job: (id: string) => queryOptions({ queryKey: ["job", id], queryFn: () => api<JobData>(`/v1/jobs/${id}`), staleTime: 0, gcTime: 60_000 }),
  method: () => queryOptions({ queryKey: ["method"], queryFn: () => api<MethodData>("/v1/method") }),
  settings: () => queryOptions({ queryKey: ["settings"], queryFn: () => api<SettingsData>(`/v1/settings${bustQuery()}`) }),
};
