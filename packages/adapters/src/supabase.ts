import { gunzipSync, gzipSync } from "node:zlib";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GuidanceStatement } from "@finn/shared";
import { toIst, type CompanyRef, type EventRow, type Store, type StoredFiling } from "@finn/core";

export const DEMO_PORTFOLIO_ID = "00000000-0000-4000-8000-000000000001";
const CHUNK = 500;

/** Service-role store. Only finn-api and the refresher hold this key; RLS blocks everyone else. */
export function supabaseStore(url: string, serviceKey: string): Store {
  const db: SupabaseClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
    if (r.error) {
      const hint = /schema cache|does not exist/i.test(r.error.message) ? " (database tables missing: apply supabase/migrations, e.g. `supabase db push`)" : "";
      throw new Error(`supabase ${what}: ${r.error.message}${hint}`);
    }
    return r.data;
  };

  const chunked = async <T>(rows: T[], write: (batch: T[]) => Promise<number>) => {
    let n = 0;
    for (let i = 0; i < rows.length; i += CHUNK) n += await write(rows.slice(i, i + CHUNK));
    return n;
  };

  const toRef = (c: { symbol: string; bse_code: string | null; is_bank: boolean }): CompanyRef => ({
    symbol: c.symbol,
    bse_code: c.bse_code,
    is_bank: c.is_bank,
  });

  return {
    async startRun(source, runner) {
      const data = must(
        await db.from("ingest_runs").insert({ source, runner, status: "running" }).select("id").single(),
        "start ingest run",
      );
      return (data as { id: number }).id;
    },

    async finishRun(id, r) {
      must(
        await db
          .from("ingest_runs")
          .update({ status: r.status, rows_ingested: r.rows_ingested, error: r.error, cursor: r.cursor ?? null, finished_at: new Date().toISOString() })
          .eq("id", id),
        "finish ingest run",
      );
    },

    async listHoldings(portfolioId = DEMO_PORTFOLIO_ID) {
      const data = must(
        await db
          .from("holdings")
          .select("weight_pct, companies!inner(symbol, bse_code, is_bank)")
          .eq("portfolio_id", portfolioId)
          .order("weight_pct", { ascending: false }),
        "list holdings",
      ) as unknown as { companies: { symbol: string; bse_code: string | null; is_bank: boolean } }[];
      return data.map((h) => toRef(h.companies));
    },

    async getCompany(symbol) {
      const data = must(
        await db.from("companies").select("symbol, bse_code, is_bank").eq("symbol", symbol).maybeSingle(),
        "get company",
      );
      return data ? toRef(data) : null;
    },

    async upsertCompanies(rows) {
      // ignoreDuplicates: a symbol already on file keeps its BSE code, sector and bank flag.
      // A new symbol whose ISIN is already on file (a renamed company) is skipped, not merged.
      const known = new Set<string>();
      for (let from = 0; ; from += 1000) {
        const page = must(await db.from("companies").select("symbol, isin").range(from, from + 999), "list companies") as { symbol: string; isin: string }[];
        for (const c of page) known.add(c.symbol).add(c.isin);
        if (page.length < 1000) break;
      }
      const fresh = rows.filter((r) => !known.has(r.symbol) && !known.has(r.isin));
      for (let i = 0; i < fresh.length; i += 500) {
        const { error } = await db.from("companies").upsert(fresh.slice(i, i + 500), { onConflict: "symbol", ignoreDuplicates: true });
        if (error) throw new Error(`upsert companies: ${error.message}`);
      }
      return fresh.length;
    },

    upsertPrices: (rows) =>
      chunked(rows, async (b) => {
        must(await db.from("prices_daily").upsert(b, { onConflict: "symbol,date" }), "upsert prices");
        return b.length;
      }),

    async positionWeights(portfolioId = DEMO_PORTFOLIO_ID) {
      const data = must(
        await db.from("holdings").select("symbol, weight_pct").eq("portfolio_id", portfolioId),
        "position weights",
      ) as { symbol: string; weight_pct: number | string }[];
      return Object.fromEntries(data.map((h) => [h.symbol, Number(h.weight_pct)]));
    },

    async recentFilings(symbols, since) {
      if (symbols.length === 0) return [];
      const data = must(
        await db
          .from("filings")
          .select("id, symbol, exchange, exch_category, subject, filed_at, dedupe_key, subject_hash, duplicate_of, filing_analysis(category, sub_kind, tier, event_id, headline)")
          .in("symbol", symbols)
          .gte("filed_at", since.toISOString()),
        "recent filings",
      ) as unknown as (Omit<StoredFiling, "analysis" | "filed_at"> & { filed_at: string; filing_analysis: StoredFiling["analysis"] | StoredFiling["analysis"][] })[];
      return data.map(({ filing_analysis, ...f }) => ({
        ...f,
        filed_at: toIst(new Date(f.filed_at)),
        // filing_id is the PK, so PostgREST returns an object (or null); older versions return an array.
        analysis: Array.isArray(filing_analysis) ? (filing_analysis[0] ?? null) : filing_analysis,
      }));
    },

    insertFilings: async (rows) => {
      const map = new Map<string, (typeof rows)[number]>();
      for (const r of rows) map.set(r.dedupe_key, r);
      const deduped = Array.from(map.values());
      const out: { id: number; dedupe_key: string }[] = [];
      await chunked(deduped, async (b) => {
        // ON CONFLICT (dedupe_key) DO NOTHING; returns only rows actually inserted.
        const data = must(
          await db.from("filings").upsert(b, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id, dedupe_key"),
          "insert filings",
        ) as { id: number; dedupe_key: string }[] | null;
        out.push(...(data ?? []));
        return data?.length ?? 0;
      });
      return out;
    },

    async recentEvents(symbols, since) {
      if (symbols.length === 0) return [];
      const data = must(
        await db.from("events").select("id, symbol, kind, primary_filing_id, filed_at").in("symbol", symbols).gte("filed_at", since.toISOString()),
        "recent events",
      ) as (Omit<EventRow, "filed_at"> & { filed_at: string })[];
      return data.map((e) => ({ ...e, filed_at: toIst(new Date(e.filed_at)) }));
    },

    async createEvent(e) {
      const data = must(await db.from("events").insert(e).select("id").single(), "create event");
      return (data as { id: number }).id;
    },

    async setEventPrimary(eventId, primaryFilingId, filedAt) {
      must(await db.from("events").update({ primary_filing_id: primaryFilingId, filed_at: filedAt }).eq("id", eventId), "set event primary");
    },

    upsertAnalyses: (rows) => {
      const map = new Map<number, (typeof rows)[number]>();
      for (const r of rows) map.set(r.filing_id, r);
      const deduped = Array.from(map.values());
      return chunked(deduped, async (b) => {
        const stamped = b.map((r) => ({ ...r, analysed_at: new Date().toISOString() }));
        must(await db.from("filing_analysis").upsert(stamped, { onConflict: "filing_id" }), "upsert analyses");
        return b.length;
      });
    },

    upsertActuals: (rows) => {
      const map = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        const key = `${r.symbol}|${r.period}|${r.metric}|${r.basis}`;
        map.set(key, r);
      }
      const deduped = Array.from(map.values());
      return chunked(deduped, async (b) => {
        const stamped = b.map((r) => ({ ...r, updated_at: new Date().toISOString() }));
        must(await db.from("actuals").upsert(stamped, { onConflict: "symbol,period,metric,basis" }), "upsert actuals");
        return b.length;
      });
    },

    async documentExists(sha256) {
      const data = must(await db.from("documents").select("id").eq("sha256", sha256).limit(1), "check document");
      return (data?.length ?? 0) > 0;
    },

    async saveDocumentText(sha256, pages) {
      const path = `${sha256}.json.gz`;
      const body = gzipSync(JSON.stringify({ pages }));
      const { error } = await db.storage
        .from("documents")
        .upload(path, body, { contentType: "application/gzip", upsert: true });
      if (error) throw new Error(`supabase storage upload: ${error.message}`);
      return path;
    },

    async insertDocument(row) {
      must(await db.from("documents").upsert(row, { onConflict: "sha256", ignoreDuplicates: true }), "insert document");
    },

    async getActuals(symbol, period) {
      const data = must(
        await db.from("actuals").select("symbol, period, metric, basis, value, unit, source").eq("symbol", symbol).eq("period", period),
        "get actuals",
      ) as { symbol: string; period: string; metric: string; basis: "consolidated" | "standalone"; value: number | string; unit: "pct" | "inr_cr" | "other"; source: "screener" | "transcript" }[];
      return data.map((a) => ({ ...a, value: Number(a.value) }));
    },

    async listActuals(symbol) {
      const data = must(
        await db.from("actuals").select("symbol, period, metric, basis, value, unit, source").eq("symbol", symbol).limit(5000),
        "list actuals",
      ) as { symbol: string; period: string; metric: string; basis: "consolidated" | "standalone"; value: number | string; unit: "pct" | "inr_cr" | "other"; source: "screener" | "transcript" }[];
      return data.map((a) => ({ ...a, value: Number(a.value) }));
    },

    async getDocumentText(sha256) {
      const { data, error } = await db.storage.from("documents").download(`${sha256}.json.gz`);
      if (error || !data) return null;
      const json = JSON.parse(gunzipSync(Buffer.from(await data.arrayBuffer())).toString("utf8")) as { pages: string[] };
      return json.pages;
    },

    upsertGuidance: (rows) => {
      const map = new Map<string, (typeof rows)[number]>();
      for (const r of rows) map.set(r.id, r);
      const deduped = Array.from(map.values());
      return chunked(deduped, async (b) => {
        must(await db.from("guidance_statements").upsert(b.map(guidanceRow), { onConflict: "id" }), "upsert guidance");
        return b.length;
      });
    },

    async listGuidance(symbol) {
      const data = must(await db.from("guidance_statements").select("*").eq("symbol", symbol), "list guidance") as GuidanceDbRow[];
      return data.map(fromGuidanceRow);
    },

    async listCalls(symbol) {
      const data = must(
        await db.from("documents").select("period").eq("symbol", symbol).eq("type", "transcript").not("period", "is", null),
        "list calls",
      ) as { period: string }[];
      return data.map((d) => d.period);
    },

    upsertVerdicts: (rows) => {
      const map = new Map<string, (typeof rows)[number]>();
      for (const r of rows) map.set(r.statement_id, r);
      const deduped = Array.from(map.values());
      return chunked(deduped, async (b) => {
        must(await db.from("verdicts").upsert(b, { onConflict: "statement_id" }), "upsert verdicts");
        return b.length;
      });
    },

    async upsertResultsCard(card, filingId) {
      const { current, prior_quarter, year_ago, growth, cash_conversion } = card;
      must(
        await db.from("results").upsert(
          {
            symbol: card.symbol,
            period: card.period,
            basis: card.basis,
            unit: card.unit,
            is_bank: card.is_bank,
            metrics: { current, prior_quarter, year_ago, growth, cash_conversion },
            checks: card.checks,
            comparable: card.comparable,
            comparability_note: card.comparability_note,
            source: card.source.kind,
            source_url: card.source.url,
            page: card.source.page,
            ebitda_formula: card.ebitda_formula,
            filing_id: filingId,
            filed_at: card.filed_at,
          },
          { onConflict: "symbol,period,basis" },
        ),
        "upsert results card",
      );
    },

    async listGovernanceFlags(symbol, since) {
      let q = db.from("governance_flags").select("symbol, filing_id, kind, detail, filed_at").eq("symbol", symbol);
      if (since) q = q.gte("filed_at", since.toISOString());
      const data = must(await q.order("filed_at", { ascending: false }), "list governance flags") as any[];
      return data.map((f) => ({ ...f, filed_at: toIst(new Date(f.filed_at)) }));
    },

    upsertGovernanceFlags: (rows) => {
      const map = new Map<string, (typeof rows)[number]>();
      for (const r of rows) map.set(`${r.filing_id}|${r.kind}`, r);
      const deduped = Array.from(map.values());
      return chunked(deduped, async (b) => {
        must(await db.from("governance_flags").upsert(b, { onConflict: "filing_id,kind" }), "upsert governance flags");
        return b.length;
      });
    },

    async listPeopleEvents(symbol, since) {
      let q = db.from("people_events").select("*").eq("symbol", symbol);
      if (since) q = q.gte("effective_date", since.toISOString().slice(0, 10));
      const data = must(await q.order("effective_date", { ascending: false }), "list people events") as any[];
      return data;
    },

    upsertPeopleEvents: (rows) => {
      const map = new Map<string, (typeof rows)[number]>();
      for (const r of rows) map.set(`${r.filing_id}|${r.name}|${r.action}`, r);
      const deduped = Array.from(map.values());
      return chunked(deduped, async (b) => {
        must(await db.from("people_events").upsert(b, { onConflict: "filing_id,name,action" }), "upsert people events");
        return b.length;
      });
    },

    async getLlmCache(key) {
      const data = must(await db.from("llm_cache").select("output, storage_path").eq("key", key).maybeSingle(), "get llm cache") as
        | { output: unknown; storage_path: string | null }
        | null;
      if (!data) return null;
      if (data.storage_path) {
        const { data: blob, error } = await db.storage.from("llm-outputs").download(data.storage_path);
        if (error || !blob) return null;
        return JSON.parse(gunzipSync(Buffer.from(await blob.arrayBuffer())).toString("utf8"));
      }
      return data.output ?? null;
    },

    async setLlmCache(key, row) {
      // llm_cache.output is capped at 8 KB in Postgres; bigger outputs (results, guidance) go to Storage.
      const json = JSON.stringify(row.output);
      if (Buffer.byteLength(json) <= 7000) {
        must(await db.from("llm_cache").upsert({ key, ...row, storage_path: null }, { onConflict: "key" }), "set llm cache");
        return;
      }
      const path = `${key}.json.gz`;
      const { error } = await db.storage.from("llm-outputs").upload(path, gzipSync(json), { contentType: "application/gzip", upsert: true });
      if (error) throw new Error(`supabase storage upload (llm-outputs): ${error.message}`);
      must(
        await db.from("llm_cache").upsert({ key, task: row.task, model: row.model, prompt_version: row.prompt_version, output: null, storage_path: path }, { onConflict: "key" }),
        "set llm cache",
      );
    },

    async logLlmCall(row) {
      must(await db.from("llm_calls").insert(row), "log llm call");
    },
  };
}

// ─── guidance_statements ⇄ GuidanceStatement ────────────────────────────────

interface GuidanceDbRow {
  id: string; symbol: string; doc_id: string; call_period: string; metric: string; metric_label: string;
  metric_kind: GuidanceStatement["metric_kind"]; scope: "company" | "segment"; segment: string | null;
  target_kind: "range" | "point" | "direction" | "none"; target_low: number | string | null; target_high: number | string | null;
  direction: "up" | "down" | "flat" | null; unit: GuidanceStatement["unit"]; period_target: string | null;
  hedges: string[]; quote: string; page: number; quote_match: number | string;
}

/** The DB flattens the target union into target_kind / target_low / target_high / direction. */
export function guidanceRow(s: GuidanceStatement): GuidanceDbRow {
  const t = s.target;
  return {
    id: s.id, symbol: s.symbol, doc_id: s.doc_id, call_period: s.call_period, metric: s.metric, metric_label: s.metric_label,
    metric_kind: s.metric_kind, scope: s.scope, segment: s.segment, target_kind: t.kind,
    target_low: t.kind === "range" ? t.low : t.kind === "point" ? t.value : null,
    target_high: t.kind === "range" ? t.high : t.kind === "point" ? t.value : null,
    direction: t.kind === "direction" ? t.direction : null,
    unit: s.unit, period_target: s.period_target, hedges: s.hedges, quote: s.quote, page: s.page, quote_match: s.quote_match,
  };
}

export function fromGuidanceRow(r: GuidanceDbRow): GuidanceStatement {
  const low = r.target_low === null ? null : Number(r.target_low);
  const high = r.target_high === null ? null : Number(r.target_high);
  const target: GuidanceStatement["target"] =
    r.target_kind === "range" ? { kind: "range", low: low!, high: high! }
    : r.target_kind === "point" ? { kind: "point", value: low! }
    : r.target_kind === "direction" ? { kind: "direction", direction: r.direction! }
    : { kind: "none" };
  return {
    id: r.id, symbol: r.symbol, doc_id: r.doc_id, call_period: r.call_period, metric: r.metric, metric_label: r.metric_label,
    metric_kind: r.metric_kind, scope: r.scope, segment: r.segment, target, unit: r.unit, period_target: r.period_target,
    hedges: r.hedges, quote: r.quote, page: r.page, quote_match: Number(r.quote_match),
  };
}
