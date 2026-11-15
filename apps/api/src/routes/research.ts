import { Hono, type Context } from "hono";
import {
  BROWSER_HEADERS,
  checkAnnualReportMandate,
  describeError,
  extractDocument,
  fetchScreener,
  governanceStrip,
  parseScreenerDocuments,
  periodLabel,
  PoliteHttp,
  processTranscript,
  recomputeRecord,
  toIst, normalizeQuotes, yahooSymbol, type ChartClient } from "@finn/core";
import type { ApiCtx } from "../ctx";
import { company } from "../data";
import { ApiError, noStore, ok } from "../http";
import { requireCron } from "./cron";

/**
 * Research for any ticker, as resumable steps. Each step is one bounded piece of work and is
 * saved before and after it runs, so a timeout loses at most one step. On Vercel an invocation
 * stops after ~4 minutes and calls /v1/jobs/:id/advance to continue; a poll that finds a job
 * untouched for 2 minutes restarts it.
 */

type StepState = "pending" | "running" | "done" | "failed" | "skipped";
interface Step {
  key: string;
  label: string;
  state: StepState;
  note: string | null;
  started_at: string | null;
  finished_at: string | null;
  args?: Record<string, unknown>;
}
interface Job {
  id: string;
  symbol: string;
  status: "queued" | "running" | "done" | "failed";
  steps: Step[];
  error: string | null;
  updated_at: string;
  created_at: string;
}

const STALL_MS = 2 * 60 * 1000;
const BUDGET_MS = 240 * 1000; // under Vercel's 300 s function limit
const MAX_TRANSCRIPTS = 4;

const step = (key: string, label: string, args?: Record<string, unknown>): Step => ({ key, label, state: "pending", note: null, started_at: null, finished_at: null, ...(args ? { args } : {}) });

async function load(ctx: ApiCtx, id: string): Promise<Job | null> {
  const { data, error } = await ctx.db.from("research_jobs").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`research_jobs: ${error.message}`);
  return data as Job | null;
}

async function save(ctx: ApiCtx, job: Job): Promise<void> {
  const { data, error } = await ctx.db.from("research_jobs").update({ steps: job.steps, status: job.status, error: job.error }).eq("id", job.id).select("updated_at").single();
  if (error) throw new Error(`research_jobs: ${error.message}`);
  job.updated_at = (data as { updated_at: string }).updated_at;
}

async function runStep(ctx: ApiCtx, job: Job, s: Step): Promise<Pick<Step, "state" | "note"> & { args?: Record<string, unknown> }> {
  const deps = ctx.deps;
  const co = (await company(ctx, job.symbol))!;
  const ref = { symbol: co.symbol, bse_code: co.bse_code, is_bank: co.is_bank };
  const kind = s.key.split(":")[0];
  switch (kind) {
    case "find_documents": {
      const http = new PoliteHttp(deps.http, deps.clock, deps.log, {}, deps.random);
      let html = "";
      for (const url of [`https://www.screener.in/company/${encodeURIComponent(job.symbol)}/consolidated/`, `https://www.screener.in/company/${encodeURIComponent(job.symbol)}/`]) {
        const res = await http.request({ url, headers: { ...BROWSER_HEADERS, accept: "text/html" } });
        if (res.status === 200) {
          html = await res.text();
          break;
        }
      }
      if (!html) throw new Error("Screener has no page for this company");
      const docs = parseScreenerDocuments(html);
      await fetchScreener(deps, job.symbol); // actuals for verdicts
      const ar = docs.annual_reports[0] ?? null;
      const calls = docs.transcripts.slice(0, MAX_TRANSCRIPTS).reverse(); // oldest first, so diffs run in order
      const plan: Step[] = [step("prices", "Loading 60 sessions of prices")];
      if (ar) plan.push(step("annual_report", `Downloading ${ar.fy} annual report`, ar), step("mandate", "Checking the segment note against your exclusions", ar));
      for (const t of calls) {
        const label = periodLabel(t.call_period);
        plan.push(step(`read:${t.call_period}`, `Reading ${label} call`, t), step(`guidance:${t.call_period}`, `Extracting guidance from ${label} call`, t));
      }
      plan.push(step("verdicts", "Running verdicts"), step("snapshot", "Building the snapshot"));
      job.steps.push(...plan);
      return { state: "done", note: `Found ${ar ? `${ar.fy} annual report` : "no annual report"} and ${calls.length} call transcript${calls.length === 1 ? "" : "s"}` };
    }
    case "prices": {
      // Straight to the store: a one-company load must not mark the portfolio's prices as refreshed.
      const now = deps.clock.now();
      const quotes = await (deps as typeof deps & { chart: ChartClient }).chart.daily(yahooSymbol(job.symbol), new Date(now.getTime() - 200 * 864e5), now);
      const rows = normalizeQuotes(job.symbol, quotes, now);
      if (rows.length === 0) return { state: "failed", note: "Yahoo has no prices for this symbol" };
      await deps.store.upsertPrices(rows);
      return { state: "done", note: `Loaded ${rows.length} sessions of prices` };
    }
    case "annual_report": {
      const a = s.args as { fy: string; url: string };
      const d = await extractDocument(deps, { symbol: job.symbol, type: "annual_report", period: a.fy, url: a.url });
      if (!d.ok) throw new Error(d.error);
      const pages = d.result.pages ?? (await deps.store.getDocumentText(d.result.sha256))?.length ?? null;
      if (d.result.readable === false) return { state: "done", note: `${a.fy} annual report is a scan; text not readable` };
      return { state: "done", note: `Found ${a.fy} annual report${pages ? ` (${pages} pages)` : ""}` };
    }
    case "mandate": {
      if (!deps.llm) return { state: "skipped", note: "Needs a model key to read the segment note" };
      const a = s.args as { fy: string; url: string };
      const r = await checkAnnualReportMandate(deps, { symbol: job.symbol, url: a.url, period: a.fy });
      if (!r.ok) throw new Error(r.error);
      return { state: "done", note: r.result.line, args: { ...a, result: { clean: r.result.clean, line: r.result.line } } };
    }
    case "read": {
      const t = s.args as { call_period: string; url: string };
      const d = await extractDocument(deps, { symbol: job.symbol, type: "transcript", period: t.call_period, url: t.url });
      if (!d.ok) throw new Error(d.error);
      const pages = d.result.pages ?? (await deps.store.getDocumentText(d.result.sha256))?.length ?? null;
      return { state: "done", note: `Read ${periodLabel(t.call_period)} call${pages ? ` (${pages} pages)` : ""}` };
    }
    case "guidance": {
      if (!deps.llm) return { state: "skipped", note: "Needs a model key to extract guidance" };
      const t = s.args as { call_period: string; url: string };
      const r = await processTranscript(deps, { company: ref, url: t.url, call_period: t.call_period });
      if (!r.ok) throw new Error(r.error);
      const d = r.result.dropped.length;
      return { state: "done", note: `${r.result.kept} target${r.result.kept === 1 ? "" : "s"} from the ${periodLabel(t.call_period)} call${d ? `; ${d} quote${d === 1 ? "" : "s"} failed verification and were dropped` : ""}` };
    }
    case "verdicts": {
      const snap = await recomputeRecord(deps, job.symbol);
      return { state: "done", note: snap.statements.length ? `${snap.statements.length} statements checked. ${snap.credibility.line}` : "No guidance on record yet" };
    }
    case "snapshot": {
      const snap = await recomputeRecord(deps, job.symbol);
      const gov = await governanceStrip(deps, job.symbol);
      const mandateStep = job.steps.find((x) => x.key === "mandate" && x.state === "done");
      const latest = await ctx.db.from("results").select("period, basis").eq("symbol", job.symbol).order("filed_at", { ascending: false }).limit(1);
      const sections = {
        record: { credibility: snap.credibility.line, statements: snap.statements.length },
        governance: { line: gov.line, count: gov.count },
        mandate: (mandateStep?.args?.result as { clean: boolean; line: string } | undefined) ?? null,
        results: latest.data?.[0] ?? null,
        steps: job.steps.filter((x) => x.key !== "snapshot").map((x) => ({ label: x.label, state: x.state, note: x.note })),
      };
      const inputs_hash = await deps.hash.sha256(JSON.stringify(sections));
      const { error } = await ctx.db.from("research_snapshots").upsert({ symbol: job.symbol, sections, inputs_hash, built_at: new Date().toISOString() }, { onConflict: "symbol" });
      if (error) throw new Error(`research_snapshots: ${error.message}`);
      return { state: "done", note: "Research ready" };
    }
    default:
      return { state: "skipped", note: `Unknown step ${s.key}` };
  }
}

/** Run pending steps until done or out of time. Safe to call concurrently: only one caller wins the claim. */
export async function advance(ctx: ApiCtx, id: string): Promise<Job | null> {
  const job = await load(ctx, id);
  if (!job || job.status === "done" || job.status === "failed") return job;
  const claim = await ctx.db.from("research_jobs").update({ status: "running" }).eq("id", id).eq("updated_at", job.updated_at).select("updated_at");
  if (claim.error || !claim.data?.length) return job; // someone else is advancing it
  job.status = "running";
  job.updated_at = (claim.data[0] as { updated_at: string }).updated_at;
  const deadline = Date.now() + (ctx.env.onVercel ? BUDGET_MS : Number.POSITIVE_INFINITY);

  for (;;) {
    const s = job.steps.find((x) => x.state === "pending");
    if (!s) {
      job.status = "done";
      await save(ctx, job);
      return job;
    }
    if (Date.now() > deadline) {
      await save(ctx, job);
      chain(ctx, id);
      return job;
    }
    s.state = "running";
    s.started_at = toIst(new Date());
    await save(ctx, job); // progress is visible while the step runs
    try {
      const r = await runStep(ctx, job, s);
      s.state = r.state;
      s.note = r.note;
      if (r.args) s.args = r.args;
    } catch (err) {
      s.state = "failed";
      s.note = `Could not complete: ${describeError(err).replace(/^\w*Error: /, "").slice(0, 200)}`;
      if (s.key === "find_documents") {
        job.status = "failed";
        job.error = s.note;
      }
    }
    s.finished_at = toIst(new Date());
    await save(ctx, job);
    if (job.status === "failed") return job;
  }
}

function chain(ctx: ApiCtx, id: string): void {
  if (!ctx.env.selfUrl || !ctx.env.cronSecret) {
    ctx.deps.log.warn("research: cannot self-chain (API_URL/VERCEL_URL or CRON_SECRET missing); the next poll will resume it", { id });
    return;
  }
  ctx.background(fetch(`${ctx.env.selfUrl}/v1/jobs/${id}/advance`, { method: "POST", headers: { authorization: `Bearer ${ctx.env.cronSecret}` } }));
}

/** Idempotent: an active job for the symbol is returned instead of starting another. */
export async function startJob(ctx: ApiCtx, symbol: string): Promise<Job> {
  if (!(await company(ctx, symbol))) throw new ApiError(404, "not_found", `No company with symbol ${symbol}`);
  const active = async () =>
    ((await ctx.db.from("research_jobs").select("*").eq("symbol", symbol).in("status", ["queued", "running"]).limit(1)).data?.[0] as Job | undefined) ?? null;
  const existing = await active();
  if (existing) return existing;
  const ins = await ctx.db.from("research_jobs").insert({ symbol, status: "queued", steps: [step("find_documents", "Finding documents")] }).select("*").single();
  if (ins.error) {
    const raced = await active(); // unique index on (symbol) for active jobs
    if (raced) return raced;
    throw new Error(`research_jobs: ${ins.error.message}`);
  }
  const job = ins.data as Job;
  ctx.background(advance(ctx, job.id));
  return job;
}

const jobJson = (j: Job) => ({
  id: j.id,
  symbol: j.symbol,
  status: j.status,
  error: j.error,
  steps: j.steps.map((s) => ({ label: s.label, state: s.state, note: s.note })),
  progress: { done: j.steps.filter((s) => s.state === "done" || s.state === "skipped" || s.state === "failed").length, total: j.steps.length },
});
const nowF = (ctx: ApiCtx) => ({ as_of: toIst(ctx.deps.clock.now()), stale: false, stale_reason: null });

export async function snapshotOrJob(ctx: ApiCtx, c: Context, symbol: string) {
  const snap = await ctx.db.from("research_snapshots").select("sections, built_at").eq("symbol", symbol).maybeSingle();
  if (snap.data) {
    return ok(c, snap.data.sections, { as_of: toIst(new Date(snap.data.built_at)), stale: false, stale_reason: null });
  }
  const job = await startJob(ctx, symbol);
  return ok(c, { job_id: job.id }, nowF(ctx), 202);
}

/** Research status without starting anything: ready (snapshot), running (job), failed or none. */
export async function researchStatus(ctx: ApiCtx, symbol: string) {
  const [snap, job] = await Promise.all([
    ctx.db.from("research_snapshots").select("built_at").eq("symbol", symbol).maybeSingle(),
    ctx.db.from("research_jobs").select("id, status, error, updated_at").eq("symbol", symbol).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const j = job.data as { id: string; status: string; error: string | null } | null;
  if (j && (j.status === "queued" || j.status === "running")) return { status: "running" as const, job_id: j.id, built_at: null, error: null };
  if (snap.data) return { status: "ready" as const, job_id: j?.id ?? null, built_at: toIst(new Date(snap.data.built_at as string)), error: null };
  if (j?.status === "failed") return { status: "failed" as const, job_id: j.id, built_at: null, error: j.error };
  return { status: "none" as const, job_id: null, built_at: null, error: null };
}

/** Companies to try that aren't held: one tap starts research on an unseen ticker. */
const SUGGESTIONS = ["CIPLA", "POLYCAB", "KAYNES", "TRENT", "LT", "SUNPHARMA"];

export function researchRoutes(ctx: ApiCtx) {
  const r = new Hono();

  /** Ready to read: every company with a research snapshot, newest first, plus suggestions. */
  r.get("/research", noStore, async (c) => {
    const snaps = (await ctx.db.from("research_snapshots").select("symbol, sections, built_at, companies!inner(name)").order("built_at", { ascending: false }).limit(50)).data ?? [];
    const held = new Set((await ctx.db.from("holdings").select("symbol").eq("portfolio_id", ctx.env.portfolioId)).data?.map((h) => h.symbol as string) ?? []);
    const ready = snaps.map((x) => {
      const sec = x.sections as { record?: { credibility?: string; statements?: number } };
      const co = x.companies as unknown as { name: string } | { name: string }[];
      return { symbol: x.symbol as string, name: (Array.isArray(co) ? co[0]?.name : co.name) ?? (x.symbol as string), credibility: sec.record?.credibility ?? "No targets due yet", statements: sec.record?.statements ?? 0, built_at: toIst(new Date(x.built_at as string)), held: held.has(x.symbol as string) };
    });
    const done = new Set(ready.map((x) => x.symbol));
    const names = (await ctx.db.from("companies").select("symbol, name").in("symbol", SUGGESTIONS)).data ?? [];
    const suggestions = SUGGESTIONS.filter((x) => !held.has(x) && !done.has(x))
      .slice(0, 3)
      .map((symbol) => ({ symbol, name: (names.find((n) => n.symbol === symbol)?.name as string | undefined) ?? symbol }));
    return ok(c, { ready, suggestions }, nowF(ctx));
  });

  r.post("/research/:symbol", noStore, async (c) => {
    const job = await startJob(ctx, c.req.param("symbol").toUpperCase());
    return ok(c, { job_id: job.id, ...jobJson(job) }, nowF(ctx), 202);
  });
  r.get("/jobs/:id", noStore, async (c) => {
    const id = c.req.param("id");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(400, "bad_request", "job id must be a UUID");
    const job = await load(ctx, id);
    if (!job) throw new ApiError(404, "not_found", "No such job");
    if ((job.status === "running" || job.status === "queued") && Date.now() - Date.parse(job.updated_at) > STALL_MS) {
      ctx.background(advance(ctx, id)); // stalled: pick it up again
    }
    return ok(c, jobJson(job), nowF(ctx));
  });
  r.post("/jobs/:id/advance", noStore, requireCron(ctx), async (c) => {
    const job = await advance(ctx, c.req.param("id"));
    if (!job) throw new ApiError(404, "not_found", "No such job");
    return ok(c, jobJson(job), nowF(ctx), 202);
  });
  return r;
}
