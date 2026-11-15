/** Regression tests for the gaps patched after review: router plumbing, mandate wiring, orchestration. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  checkAnnualReportMandate,
  checkMandateBreachInFiling,
  classifySegmentActivity,
  extractPeopleChange,
  governanceStrip,
  ingestFilings,
  MemoryStore,
  ModelRouter,
  normalizeNse,
  providerFor,
  type HttpRequest,
  type LlmClient,
  type LlmRequest,
} from "../../src/index";
import { FakeClock, FakeLog, makeDeps, makePdf } from "../fakes";

const hash = { sha256: async (d: Uint8Array | string) => createHash("sha256").update(d).digest("hex") };

// ─── Router ──────────────────────────────────────────────────────────────────

function geminiHttp(texts: string[]) {
  const requests: HttpRequest[] = [];
  return {
    requests,
    request: async (req: HttpRequest) => {
      requests.push(req);
      const text = texts.shift() ?? "{}";
      const body = JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 } });
      return { status: 200, url: req.url, headers: {}, setCookies: [], text: async () => body, bytes: async () => new TextEncoder().encode(body) };
    },
  };
}
const Out = z.strictObject({ headline: z.string().min(3) });
const req = { task: "rewrite_headline" as const, tier: "cheap" as const, promptVersion: "v1", system: "Rewrite the headline.", input: "Resignation of CFO", schema: Out };

test("router: API key goes in a header, never the URL; the model is shown the JSON Schema", async () => {
  const http = geminiHttp(['{"headline":"CFO resigned"}']);
  const r = new ModelRouter({ http, clock: new FakeClock(), hash, log: new FakeLog(), env: { geminiApiKey: "SECRET-KEY" } });
  const out = await r.run(req);
  assert.equal(out.data.headline, "CFO resigned");
  const sent = http.requests[0]!;
  assert.ok(!sent.url.includes("SECRET-KEY"), "key must not be in the URL");
  assert.equal(sent.headers!["x-goog-api-key"], "SECRET-KEY");
  const body = JSON.parse(sent.body!);
  assert.match(body.systemInstruction.parts[0].text, /JSON Schema[\s\S]*"headline"/);
});

test("router: a failing cache write or call log never turns a paid, valid answer into an error", async () => {
  const store = new MemoryStore();
  store.setLlmCache = async () => { throw new Error("value too long for llm_cache.output"); };
  store.logLlmCall = async () => { throw new Error("db down"); };
  const log = new FakeLog();
  const r = new ModelRouter({ http: geminiHttp(['{"headline":"CFO resigned"}']), clock: new FakeClock(), hash, log, store, env: { geminiApiKey: "k" } });
  assert.equal((await r.run(req)).data.headline, "CFO resigned");
  assert.ok(log.lines.some((l) => l.includes("cache write failed (result still returned)")));
});

test("router: failed attempts still log the tokens and rupees they used", async () => {
  const store = new MemoryStore();
  const calls: { ok: boolean; tokens_in: number; cost_inr: number }[] = [];
  store.logLlmCall = async (row) => void calls.push(row as never);
  const r = new ModelRouter({ http: geminiHttp(["not json", "still not json"]), clock: new FakeClock(), hash, log: new FakeLog(), store, env: { geminiApiKey: "k" } });
  await assert.rejects(r.run({ ...req, task: "extract_guidance", tier: "mid" }));
  const failed = calls.find((c) => !c.ok)!;
  assert.equal(failed.tokens_in, 2000, "initial call + repair retry");
  assert.ok(failed.cost_inr > 0);
});

test("router: provider follows the model name, so MODEL_STRONG=claude-… goes to Anthropic", () => {
  assert.equal(providerFor("claude-sonnet-5-5"), "anthropic");
  assert.equal(providerFor("gemini-2.5-pro"), "gemini");
  assert.equal(providerFor("openai/gpt-oss-120b"), "groq");
});

// ─── Mandate ─────────────────────────────────────────────────────────────────

test("exclusion patterns: no false positives from 'team spirit', fermentation or non-alcoholic drinks", () => {
  assert.equal(classifySegmentActivity("Biotech fermentation products"), null);
  assert.equal(classifySegmentActivity("Non-alcoholic beverages"), null);
  assert.equal(checkMandateBreachInFiling({ subject: "Acquisition of a design studio known for its entrepreneurial spirit" }).is_breach, false);
  assert.equal(classifySegmentActivity("Spirits"), "alcohol");
  assert.equal(classifySegmentActivity("Beer and wines"), "alcohol");
});

test("an acquisition into an excluded business is forced to Act by the triage pipeline", async () => {
  const store = new MemoryStore([{ symbol: "MARICO", bse_code: null, is_bank: false }], { MARICO: 4.5 });
  const deps = { http: { request: async () => { throw new Error("offline"); } }, clock: new FakeClock(), hash, log: new FakeLog(), store, runner: "manual" as const };
  const n = await normalizeNse(hash, "MARICO", {
    symbol: "MARICO", desc: "Acquisition",
    attchmntText: "Marico Limited has informed the Exchange about Acquisition of 51% stake in a craft brewery company",
    an_dt: "14-Nov-2026 18:00:00", attchmntFile: "https://nsearchives.nseindia.com/a.pdf", seq_id: "1",
  });
  assert.ok(n.ok);
  const report = await ingestFilings(deps, [n.filing]);
  const a = [...store.analyses.values()][0]!;
  assert.equal(a.tier, "act");
  assert.ok(a.reasons.some((r) => /Mandate breach: acquisition in alcoholic beverages/.test(r)), JSON.stringify(a.reasons));
  assert.equal(report.always_act.length, 1);
});

const SEGMENT_PAGE = [
  "Notes to the consolidated financial statements",
  "Note 42 Segment information (Ind AS 108)",
  "Segment revenue (Rs in crores) Consumer products 9,120.50 Beverage alcohol 1,250.25",
  "Packaging 630.00 Total revenue from operations 11,000.75",
  "Segment results 1,210.10 140.20 52.10 Unallocated 10.00 Interest 12.30 Tax 300.40",
].join("\n");

function arDeps(llmOut: unknown) {
  const pdf = makePdf(["Annual Report 2025-26 cover page with enough words to be readable text on this page here", SEGMENT_PAGE]);
  const { deps, store } = makeDeps(() => ({ body: pdf }));
  const llm: LlmClient = { run: async <T,>(r: LlmRequest<T>) => ({ data: r.schema.parse(llmOut), model: "gemini-flash-lite-test" }) };
  return { deps: { ...deps, llm }, store };
}

test("annual report: segment figures traced to the page, percentage computed in code, with a citation", async () => {
  const { deps } = arDeps({
    unit: "crores", total_revenue: 11000.75, total_page: 2,
    segments: [
      { name: "Consumer products", revenue: 9120.5, page: 2, activity: null },
      { name: "Beverage alcohol", revenue: 1250.25, page: 2, activity: "alcohol" },
      { name: "Packaging", revenue: 630, page: 2, activity: null },
    ],
  });
  const o = await checkAnnualReportMandate(deps, { symbol: "MARICO", url: "https://example.com/ar.pdf", period: "FY26" });
  assert.ok(o.ok, !o.ok ? o.error : "");
  assert.equal(o.result.line, "About 11% of revenue from Beverage alcohol (AR FY26, p.2)");
});

test("annual report: a segment figure that isn't on the page fails closed", async () => {
  const { deps } = arDeps({ unit: "crores", total_revenue: 11000.75, total_page: 2, segments: [{ name: "Beverage alcohol", revenue: 2500, page: 2, activity: "alcohol" }] });
  const o = await checkAnnualReportMandate(deps, { symbol: "MARICO", url: "https://example.com/ar.pdf", period: "FY26" });
  assert.equal(o.ok, false);
  assert.match(!o.ok ? o.error : "", /not found on the cited page: Beverage alcohol 2500 \(p\.2\)/);
});

// ─── People and governance orchestration ─────────────────────────────────────

test("people: a name the model gives that isn't in the filing is dropped", async () => {
  const pdf = makePdf(["Disclosure under Regulation 30: Resignation of Mr. Rakesh Sharma as Chief Financial Officer with effect from 30 November 2026 due to personal reasons."]);
  const { deps } = makeDeps(() => ({ body: pdf }));
  const person = (name: string) => ({ name, role: "Chief Financial Officer", action: "resigned", effective_date: "2026-11-30", prior_roles: [], tenure_months: null, stated_reason: "personal reasons", source_page: 1 });
  const llm: LlmClient = { run: async <T,>(r: LlmRequest<T>) => ({ data: r.schema.parse({ events: [person("Rakesh Sharma"), person("Anil Mehta")] }), model: "m" }) };
  const o = await extractPeopleChange({ ...deps, llm }, { symbol: "POLYCAB", filing_id: 1, pdf_url: "https://example.com/p.pdf" });
  assert.ok(o.ok, !o.ok ? o.error : "");
  assert.deepEqual(o.result.events.map((e) => e.name), ["Rakesh Sharma"]);
  assert.equal(o.status, "partial");
});

test("governance strip reads stored filings and stays quiet when there is nothing", async () => {
  const { deps } = makeDeps(() => ({}), [{ symbol: "ASTRAL", bse_code: null, is_bank: false }]);
  const strip = await governanceStrip(deps, "ASTRAL");
  assert.equal(strip.line, "No governance flags in 12 months");
});
