import type {
  ActualRow,
  AnalysisRow,
  CompanyRef,
  DocumentRow,
  EventRow,
  GovernanceFlagRow,
  IngestRunner,
  IngestSource,
  IngestStatus,
  LlmCallRow,
  NewFilingRow,
  PeopleEventRow,
  PriceRow,
  Store,
  StoredFiling,
} from "./ports";
import type { GuidanceStatement, ResultsCard, Verdict } from "@finn/shared";
import { istToEpochMs } from "./time";

export interface MemoryRun {
  id: number;
  source: IngestSource;
  runner: IngestRunner;
  status: IngestStatus | "running";
  rows_ingested: number;
  error: string | null;
  cursor: string | null;
}

export type MemoryFiling = NewFilingRow & { id: number };

/**
 * In-memory Store with the same semantics as the database (upsert keys, unique dedupe_key,
 * duplicates never analysed, documents unique by sha256). Used by `refresh --dry-run` and tests.
 */
export class MemoryStore implements Store {
  readonly runs: MemoryRun[] = [];
  readonly prices = new Map<string, PriceRow>();
  /** Keyed by filing id. */
  readonly filings = new Map<number, MemoryFiling>();
  readonly analyses = new Map<number, AnalysisRow>();
  readonly events = new Map<number, EventRow>();
  readonly actuals = new Map<string, ActualRow>();
  readonly documents = new Map<string, DocumentRow>();
  readonly texts = new Map<string, string[]>();
  /** Keyed by symbol|period|basis. */
  readonly results = new Map<string, { card: ResultsCard; filing_id: number | null }>();
  readonly guidance = new Map<string, GuidanceStatement>();
  readonly verdicts = new Map<string, Verdict>();
  readonly governanceFlags: GovernanceFlagRow[] = [];
  readonly peopleEvents: PeopleEventRow[] = [];
  readonly llmCache = new Map<string, { task: string; model: string; prompt_version: string; output: unknown }>();
  readonly llmCalls: LlmCallRow[] = [];
  private nextFilingId = 1;

  constructor(
    readonly companies: CompanyRef[] = [],
    private readonly weights: Record<string, number> = Object.fromEntries(companies.map((c) => [c.symbol, 0])),
  ) {}

  async startRun(source: IngestSource, runner: IngestRunner) {
    const id = this.runs.length + 1;
    this.runs.push({ id, source, runner, status: "running", rows_ingested: 0, error: null, cursor: null });
    return id;
  }
  async finishRun(id: number, r: { status: IngestStatus; rows_ingested: number; error: string | null; cursor?: string | null }) {
    Object.assign(this.runs[id - 1]!, { ...r, cursor: r.cursor ?? null });
  }
  async listHoldings() {
    return this.companies.filter((c) => c.symbol in this.weights);
  }
  async getCompany(symbol: string) {
    return this.companies.find((c) => c.symbol === symbol) ?? null;
  }
  async positionWeights() {
    return { ...this.weights };
  }
  async upsertPrices(rows: PriceRow[]) {
    for (const r of rows) this.prices.set(`${r.symbol}|${r.date}`, r);
    return rows.length;
  }

  async recentFilings(symbols: string[], since: Date): Promise<StoredFiling[]> {
    return [...this.filings.values()]
      .filter((f) => symbols.includes(f.symbol) && istToEpochMs(f.filed_at) >= since.getTime())
      .map((f) => {
        const a = this.analyses.get(f.id);
        return {
          id: f.id,
          symbol: f.symbol,
          exchange: f.exchange,
          exch_category: f.exch_category,
          subject: f.subject,
          filed_at: f.filed_at,
          dedupe_key: f.dedupe_key,
          subject_hash: f.subject_hash,
          duplicate_of: f.duplicate_of,
          analysis: a ? { category: a.category, sub_kind: a.sub_kind, tier: a.tier, event_id: a.event_id, headline: a.headline } : null,
        };
      });
  }
  async insertFilings(rows: NewFilingRow[]) {
    const out: { id: number; dedupe_key: string }[] = [];
    const keys = new Set([...this.filings.values()].map((f) => f.dedupe_key));
    for (const r of rows) {
      if (keys.has(r.dedupe_key)) continue;
      if (r.duplicate_of !== null && this.filings.get(r.duplicate_of)?.duplicate_of != null) {
        throw new Error(`filing ${r.dedupe_key} would point at another duplicate`);
      }
      const id = this.nextFilingId++;
      this.filings.set(id, { ...r, id });
      keys.add(r.dedupe_key);
      out.push({ id, dedupe_key: r.dedupe_key });
    }
    return out;
  }
  async recentEvents(symbols: string[], since: Date) {
    return [...this.events.values()].filter((e) => symbols.includes(e.symbol) && istToEpochMs(e.filed_at) >= since.getTime());
  }
  async createEvent(e: Omit<EventRow, "id">) {
    const id = this.events.size + 1;
    this.events.set(id, { ...e, id });
    return id;
  }
  async setEventPrimary(eventId: number, primaryFilingId: number, filedAt: EventRow["filed_at"]) {
    const e = this.events.get(eventId)!;
    this.events.set(eventId, { ...e, primary_filing_id: primaryFilingId, filed_at: filedAt });
  }
  async upsertAnalyses(rows: AnalysisRow[]) {
    for (const r of rows) {
      if (this.filings.get(r.filing_id)?.duplicate_of != null) throw new Error(`filing ${r.filing_id} is a duplicate; analyse its original`);
      this.analyses.set(r.filing_id, r);
    }
    return rows.length;
  }

  async upsertActuals(rows: ActualRow[]) {
    for (const r of rows) this.actuals.set(`${r.symbol}|${r.period}|${r.metric}|${r.basis}`, r);
    return rows.length;
  }
  async getActuals(symbol: string, period: string) {
    return [...this.actuals.values()].filter((a) => a.symbol === symbol && a.period === period);
  }
  async upsertResultsCard(card: ResultsCard, filing_id: number | null) {
    this.results.set(`${card.symbol}|${card.period}|${card.basis}`, { card, filing_id });
  }
  async listActuals(symbol: string) {
    return [...this.actuals.values()].filter((a) => a.symbol === symbol);
  }
  async getDocumentText(sha256: string) {
    return this.texts.get(sha256) ?? null;
  }
  async upsertGuidance(rows: GuidanceStatement[]) {
    for (const r of rows) {
      const doc = [...this.documents.values()].find((d) => d.id === r.doc_id);
      if (!doc) throw new Error(`guidance ${r.id}: document ${r.doc_id} does not exist`);
      this.guidance.set(r.id, r);
    }
    return rows.length;
  }
  async listGuidance(symbol: string) {
    return [...this.guidance.values()].filter((g) => g.symbol === symbol);
  }
  async listCalls(symbol: string) {
    return [...this.documents.values()].filter((d) => d.symbol === symbol && d.type === "transcript" && d.period).map((d) => d.period!);
  }
  async upsertVerdicts(rows: Verdict[]) {
    for (const v of rows) {
      if (!this.guidance.has(v.statement_id)) throw new Error(`verdict for unknown statement ${v.statement_id}`);
      this.verdicts.set(v.statement_id, v);
    }
    return rows.length;
  }
  async documentExists(sha256: string) {
    return this.documents.has(sha256);
  }
  async saveDocumentText(sha256: string, pages: string[]) {
    this.texts.set(sha256, pages);
    return `${sha256}.json.gz`;
  }
  async insertDocument(row: DocumentRow) {
    if (!this.documents.has(row.sha256)) this.documents.set(row.sha256, row);
  }

  async listGovernanceFlags(symbol: string, since?: Date): Promise<GovernanceFlagRow[]> {
    return this.governanceFlags.filter((f) => {
      if (f.symbol !== symbol) return false;
      if (since && new Date(f.filed_at).getTime() < since.getTime()) return false;
      return true;
    });
  }

  async upsertGovernanceFlags(rows: GovernanceFlagRow[]): Promise<number> {
    for (const r of rows) {
      const idx = this.governanceFlags.findIndex((f) => f.symbol === r.symbol && f.filing_id === r.filing_id && f.kind === r.kind);
      if (idx >= 0) this.governanceFlags[idx] = r;
      else this.governanceFlags.push(r);
    }
    return rows.length;
  }

  async listPeopleEvents(symbol: string, since?: Date): Promise<PeopleEventRow[]> {
    return this.peopleEvents.filter((e) => {
      if (e.symbol !== symbol) return false;
      if (since && e.effective_date && new Date(e.effective_date).getTime() < since.getTime()) return false;
      return true;
    });
  }

  async upsertPeopleEvents(rows: PeopleEventRow[]): Promise<number> {
    for (const r of rows) {
      const idx = this.peopleEvents.findIndex((e) => e.filing_id === r.filing_id && e.name === r.name && e.action === r.action);
      if (idx >= 0) this.peopleEvents[idx] = r;
      else this.peopleEvents.push(r);
    }
    return rows.length;
  }

  async getLlmCache(key: string): Promise<unknown | null> {
    return this.llmCache.get(key)?.output ?? null;
  }

  async setLlmCache(key: string, row: { task: string; model: string; prompt_version: string; output: unknown }): Promise<void> {
    this.llmCache.set(key, row);
  }

  async logLlmCall(row: LlmCallRow): Promise<void> {
    this.llmCalls.push(row);
  }
}
