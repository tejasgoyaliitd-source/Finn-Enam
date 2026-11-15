/**
 * Live / Simulation Test:
 * Simulates a 429 Rate Limit from primary provider (Gemini) and verifies
 * that failover to Groq happens automatically, returning valid Zod-parsed
 * data and recording complete metadata in llm_calls.
 *
 * If GROQ_API_KEY is available in process.env, it executes a live call
 * against Groq API with openai/gpt-oss-20b. Otherwise it executes
 * with mock transport.
 *
 * Run with:
 *   pnpm --filter @finn/core exec tsx test/llm/live-failover.ts
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  MemoryStore,
  ModelRouter,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
  type LlmRequest,
} from "../../src/index";

const ClassificationSchema = z.strictObject({
  headline: z.string().min(1),
  category: z.enum(["results", "governance", "material", "routine"]),
  confidence: z.number().min(0).max(1),
  actionRequired: z.boolean(),
});
type Classification = z.infer<typeof ClassificationSchema>;

async function main() {
  console.log("==========================================================");
  console.log("  FINN 4-Tier LLM Router: 429 Failover to Groq Test");
  console.log("==========================================================\n");

  const groqApiKey = process.env.GROQ_API_KEY || "";
  const isLive = Boolean(process.env.TEST_LIVE_GROQ && groqApiKey);

  const store = new MemoryStore();
  const sha256 = async (d: Uint8Array | string) => createHash("sha256").update(d).digest("hex");
  const clock = { now: () => new Date(), sleep: async (_ms: number) => {} };

  // HTTP Client: Intercepts Gemini and forces a 429 error, routes Groq live or mocked
  const http: HttpClient = {
    async request(req: HttpRequest): Promise<HttpResponse> {
      if (req.url.includes("generativelanguage.googleapis.com")) {
        console.log(`[Primary Attempt] URL: ${req.url.slice(0, 80)}...`);
        console.log(`  -> Injecting 429: Rate Limit Exceeded (RESOURCE_EXHAUSTED)\n`);
        const errorBody = JSON.stringify({
          error: {
            code: 429,
            message: "Resource has been exhausted (rate limit quota).",
            status: "RESOURCE_EXHAUSTED",
          },
        });
        return {
          status: 429,
          url: req.url,
          headers: { "content-type": "application/json" },
          setCookies: [],
          text: async () => errorBody,
          bytes: async () => new TextEncoder().encode(errorBody),
        };
      }

      if (req.url.includes("api.groq.com")) {
        const body = JSON.parse(req.body ?? "{}");
        console.log(`[Failover Attempt] Calling Groq with model: "${body.model}"...`);

        if (isLive) {
          // Perform real network request to Groq
          const res = await fetch(req.url, {
            method: req.method,
            headers: req.headers,
            body: req.body,
          });
          const text = await res.text();
          return {
            status: res.status,
            url: req.url,
            headers: {},
            setCookies: [],
            text: async () => text,
            bytes: async () => new TextEncoder().encode(text),
          };
        } else {
          // Mock Groq response with valid schema JSON
          const mockResponse = {
            id: "chatcmpl-mock-groq-20b",
            object: "chat.completion",
            model: body.model,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    headline: "Polycab Q2 FY27 Financial Results Intimation",
                    category: "results",
                    confidence: 0.96,
                    actionRequired: true,
                  }),
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 125,
              completion_tokens: 42,
              total_tokens: 167,
            },
          };
          const text = JSON.stringify(mockResponse);
          return {
            status: 200,
            url: req.url,
            headers: { "content-type": "application/json" },
            setCookies: [],
            text: async () => text,
            bytes: async () => new TextEncoder().encode(text),
          };
        }
      }

      throw new Error(`Unhandled request URL: ${req.url}`);
    },
  };

  const router = new ModelRouter({
    http,
    clock,
    hash: { sha256 },
    log: {
      info: (m) => console.log(`[INFO] ${m}`),
      warn: (m, ctx) => console.log(`[ROUTER INCIDENT LOG] ${m}\n  Context:`, ctx),
      error: (m) => console.error(`[ERROR] ${m}`),
    },
    store,
    env: {
      geminiApiKey: "mock-gemini-key",
      groqApiKey,
    },
  });

  const req: LlmRequest<Classification> = {
    task: "classify_filing",
    tier: "cheap",
    promptVersion: "v1",
    system: "Classify the exchange announcement and return valid JSON matching schema.",
    input: "POLYCAB INDIA LIMITED: Financial Results for Quarter and Half-year ended 30th September 2026",
    schema: ClassificationSchema,
  };

  const startMs = Date.now();
  const res = await router.run(req);
  const elapsedMs = Date.now() - startMs;

  console.log("\n==========================================================");
  console.log("  Result Summary:");
  console.log("==========================================================");
  console.log(`  Serving Model:     ${res.model}`);
  console.log(`  Parsed Valid JSON: `, res.data);
  console.log(`  Failover Latency:  ${elapsedMs}ms`);

  // Assertions
  assert.equal(res.model, "openai/gpt-oss-20b", "Must use mapped Groq failover model openai/gpt-oss-20b");
  assert.equal(res.data.category, "results");
  assert.equal(typeof res.data.actionRequired, "boolean");

  // Verify llm_calls audit ledger
  assert.equal(store.llmCalls.length, 1, "Exactly one serving record in llm_calls");
  const callRecord = store.llmCalls[0]!;
  assert.equal(callRecord.provider, "groq");
  assert.equal(callRecord.model, "openai/gpt-oss-20b");
  assert.equal(callRecord.ok, true);
  assert.ok(callRecord.tokens_in > 0);
  assert.ok(callRecord.tokens_out > 0);
  assert.ok(callRecord.cost_inr > 0);

  console.log("\n  Verified llm_calls Ledger Row:");
  console.log(`    provider:   ${callRecord.provider}`);
  console.log(`    model:      ${callRecord.model}`);
  console.log(`    tokens_in:  ${callRecord.tokens_in}`);
  console.log(`    tokens_out: ${callRecord.tokens_out}`);
  console.log(`    cost_inr:   ₹${callRecord.cost_inr}`);
  console.log(`    ok:         ${callRecord.ok}`);

  console.log("\n[PASS] Verified automatic 429 failover to Groq with Zod schema validation!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
