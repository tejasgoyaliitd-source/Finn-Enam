import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  estimateCostInr,
  MemoryStore,
  ModelRouter,
  TASK_CONFIG,
  IGNORED_MODELS,
  isModerationModel,
  isTransientOrRateLimit,
  type LlmRequest,
  type ProviderCall,
  type ProviderResponse,
} from "../../src/index";
import { FakeClock, FakeLog } from "../fakes";

const hash = { sha256: async (d: Uint8Array | string) => createHash("sha256").update(d).digest("hex") };
const dummyHttp = {
  request: async () => ({
    status: 200,
    url: "",
    headers: {},
    setCookies: [],
    text: async () => "{}",
    bytes: async () => new Uint8Array(),
  }),
};
const log = new FakeLog();
const clock = new FakeClock();

const TestSchema = z.strictObject({
  headline: z.string().min(1),
  category: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
type TestSchema = z.infer<typeof TestSchema>;

test("LLM Router: maps tasks to correct default tiers and providers", () => {
  // Tier 1 (cheap)
  assert.equal(TASK_CONFIG.classify_filing.tier, 1);
  assert.equal(TASK_CONFIG.rewrite_headline.tier, 1);
  assert.equal(TASK_CONFIG.read_meeting_date.tier, 1);
  assert.equal(TASK_CONFIG.tag_segments.tier, 1);
  assert.equal(TASK_CONFIG.classify_filing.defaultModel, "gemini-3.1-flash-lite");
  assert.equal(TASK_CONFIG.classify_filing.failoverModel, "openai/gpt-oss-20b");
  assert.equal(TASK_CONFIG.classify_filing.claudeModel, "haiku-5.5");

  // Tier 2 (mid)
  assert.equal(TASK_CONFIG.extract_results.tier, 2);
  assert.equal(TASK_CONFIG.extract_people.tier, 2);
  assert.equal(TASK_CONFIG.extract_guidance.tier, 2);
  assert.equal(TASK_CONFIG.answer_scoped.tier, 2);
  assert.equal(TASK_CONFIG.extract_results.defaultModel, "gemini-3.5-flash");
  assert.equal(TASK_CONFIG.extract_results.failoverModel, "openai/gpt-oss-120b");
  assert.equal(TASK_CONFIG.extract_results.claudeModel, "haiku-5.5");

  // Tier 3 (strong)
  assert.equal(TASK_CONFIG.write_risks.tier, 3);
  assert.equal(TASK_CONFIG.write_questions.tier, 3);
  assert.equal(TASK_CONFIG.write_risks.defaultModel, "gemini-2.5-pro");
  assert.equal(TASK_CONFIG.write_risks.failoverModel, "openai/gpt-oss-120b");
  assert.equal(TASK_CONFIG.write_risks.claudeModel, "haiku-5.5");
});

test("LLM Router: explicitly ignores moderation models (llama-prompt-guard, gpt-oss-safeguard)", () => {
  assert.equal(isTransientOrRateLimit(new Error("429 Rate Limit Exceeded")), true);
  assert.equal(isTransientOrRateLimit(new Error("Resource has been exhausted")), true);
  assert.equal(isTransientOrRateLimit(new Error("503 Service Unavailable")), true);
  assert.equal(isTransientOrRateLimit(new Error("Connection timed out")), true);
  assert.equal(isTransientOrRateLimit({ status: 429 }), true);
  assert.equal(isTransientOrRateLimit(new Error("Invalid schema syntax")), false);

  assert.ok(IGNORED_MODELS.includes("llama-prompt-guard" as any));
  assert.ok(IGNORED_MODELS.includes("gpt-oss-safeguard" as any));
  assert.equal(isModerationModel("meta-llama/llama-prompt-guard-2-22m"), true);
  assert.equal(isModerationModel("openai/gpt-oss-safeguard-20b"), true);
  assert.equal(isModerationModel("llama-prompt-guard"), true);
  assert.equal(isModerationModel("openai/gpt-oss-20b"), false);
  assert.equal(isModerationModel("openai/gpt-oss-120b"), false);
  assert.equal(isModerationModel("gemini-3.1-flash-lite"), false);

  const router = new ModelRouter({
    http: dummyHttp,
    clock,
    hash,
    log,
    env: {
      modelCheapFailover: "openai/gpt-oss-safeguard-20b",
      modelMidFailover: "meta-llama/llama-prompt-guard-2-86m",
    },
  });

  // When moderation models are passed in env, resolveModels ignores them and falls back to safe models
  const cheapResolved = router.resolveModels("classify_filing", "cheap");
  assert.equal(cheapResolved.failoverModel, "openai/gpt-oss-20b");

  const midResolved = router.resolveModels("extract_results", "mid");
  assert.equal(midResolved.failoverModel, "openai/gpt-oss-120b");
});

test("LLM Router: cache miss calls provider, stores in cache, logs to llm_calls; cache hit costs 0 tokens and ₹0", async () => {
  const store = new MemoryStore();
  let providerCalls = 0;

  const transport = async (_call: ProviderCall): Promise<ProviderResponse> => {
    providerCalls++;
    return {
      text: JSON.stringify({ headline: "Polycab Q2 Results", category: "results", confidence: 0.98 }),
      tokensIn: 120,
      tokensOut: 35,
    };
  };

  const router = new ModelRouter({
    http: dummyHttp,
    clock,
    hash,
    log,
    store,
    transport,
  });

  const req: LlmRequest<TestSchema> = {
    task: "rewrite_headline",
    tier: "cheap",
    promptVersion: "v1",
    system: "Return json",
    input: "Polycab unaudited standalone and consolidated financial results",
    schema: TestSchema,
  };

  // 1. First invocation: cache miss
  const res1 = await router.run(req);
  assert.equal(providerCalls, 1);
  assert.equal(res1.cached, false);
  assert.equal(res1.data.headline, "Polycab Q2 Results");

  // Verify stored in llm_cache and logged in llm_calls
  assert.equal(store.llmCache.size, 1);
  assert.equal(store.llmCalls.length, 1);
  const call1 = store.llmCalls[0]!;
  assert.equal(call1.cached, false);
  assert.equal(call1.tokens_in, 120);
  assert.equal(call1.tokens_out, 35);
  assert.ok(call1.cost_inr > 0, "first call has positive cost in INR");

  // 2. Second invocation with identical request: cache hit!
  const res2 = await router.run(req);
  assert.equal(providerCalls, 1, "provider transport was NOT called on cache hit");
  assert.equal(res2.cached, true);
  assert.equal(res2.data.headline, "Polycab Q2 Results");

  // Verify cache hit logging
  assert.equal(store.llmCalls.length, 2);
  const call2 = store.llmCalls[1]!;
  assert.equal(call2.cached, true);
  assert.equal(call2.tokens_in, 0);
  assert.equal(call2.tokens_out, 0);
  assert.equal(call2.cost_inr, 0, "cache hits cost exactly ₹0");
});

test("LLM Router: single repair retry recovers from malformed output before failing closed", async () => {
  const store = new MemoryStore();
  let attempt = 0;

  const transport = async (_call: ProviderCall): Promise<ProviderResponse> => {
    attempt++;
    if (attempt === 1) {
      // First attempt returns malformed json (missing quote)
      return { text: `{ "headline": "Bad JSON, "category": "results" }`, tokensIn: 50, tokensOut: 15 };
    }
    // Repair attempt returns valid json matching schema
    return {
      text: JSON.stringify({ headline: "Repaired Headline", category: "results", confidence: 0.95 }),
      tokensIn: 80,
      tokensOut: 25,
    };
  };

  const router = new ModelRouter({
    http: dummyHttp,
    clock,
    hash,
    log,
    store,
    transport,
  });

  const req: LlmRequest<TestSchema> = {
    task: "rewrite_headline",
    tier: "cheap",
    promptVersion: "v1",
    system: "Return json",
    input: "Sample input",
    schema: TestSchema,
  };

  const res = await router.run(req);
  assert.equal(attempt, 2, "repair retry was triggered");
  assert.equal(res.data.headline, "Repaired Headline");
  assert.equal(res.data.confidence, 0.95);
});

test("LLM Router: fails closed if repair retry still fails schema validation", async () => {
  const store = new MemoryStore();

  const transport = async (): Promise<ProviderResponse> => {
    // Repeatedly returns data violating confidence bounds
    return {
      text: JSON.stringify({ headline: "Headline", category: "results", confidence: 999 }),
      tokensIn: 50,
      tokensOut: 20,
    };
  };

  const router = new ModelRouter({
    http: dummyHttp,
    clock,
    hash,
    log,
    store,
    transport,
  });

  const req: LlmRequest<TestSchema> = {
    task: "rewrite_headline",
    tier: "cheap",
    promptVersion: "v1",
    system: "Return json",
    input: "Sample input",
    schema: TestSchema,
  };

  await assert.rejects(async () => {
    await router.run(req);
  }, /failed schema validation after repair retry/);

  // Failed call logged
  assert.equal(store.llmCalls.length, 1);
  assert.equal(store.llmCalls[0]?.ok, false);
});

test("LLM Router: 429 rate limit triggers immediate failover to Groq with full metadata logging", async () => {
  const store = new MemoryStore();
  const calls: ProviderCall[] = [];

  const transport = async (call: ProviderCall): Promise<ProviderResponse> => {
    calls.push(call);
    if (call.model === "gemini-3.1-flash-lite") {
      const err: any = new Error("Gemini API error (429): Resource has been exhausted (rate limit)");
      err.status = 429;
      throw err;
    }
    // Groq failover succeeds with valid json
    return {
      text: JSON.stringify({ headline: "Groq Fast Headline", category: "results", confidence: 0.94 }),
      tokensIn: 95,
      tokensOut: 22,
    };
  };

  const router = new ModelRouter({
    http: dummyHttp,
    clock,
    hash,
    log,
    store,
    transport,
  });

  const req: LlmRequest<TestSchema> = {
    task: "classify_filing",
    tier: "cheap",
    promptVersion: "v1",
    system: "Return json",
    input: "Filing subject",
    schema: TestSchema,
  };

  const res = await router.run(req);
  // Verify fast failover to mapped Groq model: openai/gpt-oss-20b
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.model, "gemini-3.1-flash-lite");
  assert.equal(calls[0]?.provider, "gemini");
  assert.equal(calls[1]?.model, "openai/gpt-oss-20b");
  assert.equal(calls[1]?.provider, "groq");

  // Returned data is parsed and validated by Zod
  assert.equal(res.model, "openai/gpt-oss-20b");
  assert.equal(res.data.headline, "Groq Fast Headline");
  assert.equal(res.data.confidence, 0.94);

  // Verify llm_calls logged entry records Groq as serving provider with exact model, tokens, and INR cost
  assert.equal(store.llmCalls.length, 1);
  const logged = store.llmCalls[0]!;
  assert.equal(logged.ok, true);
  assert.equal(logged.provider, "groq");
  assert.equal(logged.model, "openai/gpt-oss-20b");
  assert.equal(logged.tokens_in, 95);
  assert.equal(logged.tokens_out, 22);
  assert.ok(logged.cost_inr > 0, "Groq call has computed INR cost");
});

test("LLM Router: 503 service unavailable and connection timeouts trigger failover to Groq", async () => {
  const store = new MemoryStore();
  const modelsCalled: string[] = [];

  const transport = async (call: ProviderCall): Promise<ProviderResponse> => {
    modelsCalled.push(call.model);
    if (call.model === "gemini-3.5-flash") {
      const err: any = new Error("Gemini API error (503): The model is overloaded");
      err.status = 503;
      throw err;
    }
    return {
      text: JSON.stringify({ headline: "Mid Tier Result", category: "results", confidence: 0.91 }),
      tokensIn: 250,
      tokensOut: 45,
    };
  };

  const router = new ModelRouter({
    http: dummyHttp,
    clock,
    hash,
    log,
    store,
    transport,
  });

  const req: LlmRequest<TestSchema> = {
    task: "extract_results",
    tier: "mid",
    promptVersion: "v1",
    system: "Return json",
    input: "Results statement",
    schema: TestSchema,
  };

  const res = await router.run(req);
  assert.deepEqual(modelsCalled, ["gemini-3.5-flash", "openai/gpt-oss-120b"]);
  assert.equal(res.model, "openai/gpt-oss-120b");
  assert.equal(res.data.headline, "Mid Tier Result");
});

test("LLM Pricing: computes accurate token costs in INR", () => {
  // Gemini 3.1 Flash-Lite: ₹6.25 in / ₹25 out per 1M tokens
  const costCheap = estimateCostInr("gemini-3.1-flash-lite", 10_000, 2_000);
  assert.equal(costCheap, 0.1125);

  // Groq openai/gpt-oss-20b: ₹6.25 in / ₹20 out per 1M tokens
  const costGroq20b = estimateCostInr("openai/gpt-oss-20b", 10_000, 2_000);
  assert.equal(costGroq20b, 0.1025);

  // Groq openai/gpt-oss-120b: ₹15.00 in / ₹50 out per 1M tokens
  const costGroq120b = estimateCostInr("openai/gpt-oss-120b", 10_000, 2_000);
  assert.equal(costGroq120b, 0.25);

  // Cache hit is always ₹0
  assert.equal(estimateCostInr("gemini-3.1-flash-lite", 10_000, 2_000, true), 0);
});
