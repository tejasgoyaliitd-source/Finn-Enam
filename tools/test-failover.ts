/**
 * Test script: Simulates a 429 Rate Limit from primary provider (Gemini)
 * and verifies that failover to Groq happens automatically, returning
 * valid Zod-parsed data and recording complete metadata in llm_calls.
 *
 * Usage:
 *   npx tsx tools/test-failover.ts
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
} from "../packages/core/src/index";

// Schema to validate
const ClassificationSchema = z.strictObject({
  headline: z.string().min(1),
  category: z.enum(["results", "governance", "material", "routine"]),
  confidence: z.number().min(0).max(1),
  actionRequired: z.boolean(),
});
type Classification = z.infer<typeof ClassificationSchema>;

async function runTest() {
  console.log("=== Testing 429 Failover: Gemini -> Groq ===");

  const store = new MemoryStore();
  const sha256 = async (d: Uint8Array | string) => createHash("sha256").update(d).digest("hex");
  const clock = { now: () => new Date() };
  const logs: string[] = [];
  const logger = {
    info: (m: string) => logs.push(`[INFO] ${m}`),
    warn: (m: string, ctx?: any) => {
      console.log(`  [Router Warning] ${m}`);
      if (ctx?.primaryModel) console.log(`    Primary failed: ${ctx.primaryProvider} (${ctx.primaryModel})`);
      if (ctx?.failoverModel) console.log(`    Failover target: ${ctx.failoverProvider} (${ctx.failoverModel})`);
      logs.push(`[WARN] ${m}`);
    },
    error: (m: string) => logs.push(`[ERROR] ${m}`),
  };

  // Mock HTTP client that simulates Gemini 429 Rate Limit, and Groq 200 OK
  const requestsMade: { url: string; model?: string; provider?: string }[] = [];

  const mockHttp: HttpClient = {
    async request(req: HttpRequest): Promise<HttpResponse> {
      if (req.url.includes("generativelanguage.googleapis.com")) {
        requestsMade.push({ url: req.url, provider: "gemini" });
        console.log(`1. Primary call dispatched to Gemini: ${req.url.split("/models/")[1]?.split(":")[0]}`);
        console.log("   -> Simulating HTTP 429: Rate Limit Exceeded (RESOURCE_EXHAUSTED)");
        const errorBody = JSON.stringify({
          error: {
            code: 429,
            message: "Resource has been exhausted (e.g. check quota).",
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
        requestsMade.push({ url: req.url, model: body.model, provider: "groq" });
        console.log(`2. Failover call dispatched to Groq: ${body.model}`);

        const mockGroqResponse = {
          id: "chatcmpl-test-failover",
          object: "chat.completion",
          model: body.model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify({
                  headline: "Polycab Q2 Financial Results Approved",
                  category: "results",
                  confidence: 0.98,
                  actionRequired: true,
                }),
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 110,
            completion_tokens: 38,
            total_tokens: 148,
          },
        };

        return {
          status: 200,
          url: req.url,
          headers: { "content-type": "application/json" },
          setCookies: [],
          text: async () => JSON.stringify(mockGroqResponse),
          bytes: async () => new TextEncoder().encode(JSON.stringify(mockGroqResponse)),
        };
      }

      throw new Error(`Unexpected request to ${req.url}`);
    },
  };

  const router = new ModelRouter({
    http: mockHttp,
    clock,
    hash: { sha256 },
    log: logger,
    store,
    env: {
      geminiApiKey: "mock-gemini-key",
      groqApiKey: "mock-groq-key",
    },
  });

  const request: LlmRequest<Classification> = {
    task: "classify_filing",
    tier: "cheap",
    promptVersion: "v1",
    system: "Classify the exchange announcement.",
    input: "POLYCAB INDIA LIMITED - Unaudited Financial Results for the quarter ended September 30, 2026",
    schema: ClassificationSchema,
  };

  const startTime = Date.now();
  const result = await router.run(request);
  const totalElapsed = Date.now() - startTime;

  console.log(`\n3. Router Result returned successfully in ${totalElapsed}ms!`);
  console.log(`   Serving Model: ${result.model}`);
  console.log(`   Parsed Data:`, result.data);

  // Assertions
  assert.equal(requestsMade.length, 2, "Must make exactly 2 requests: Gemini then Groq");
  assert.equal(requestsMade[0]?.provider, "gemini");
  assert.equal(requestsMade[1]?.provider, "groq");
  assert.equal(requestsMade[1]?.model, "openai/gpt-oss-20b", "Cheap tier must failover to openai/gpt-oss-20b");
  assert.equal(result.model, "openai/gpt-oss-20b");
  assert.equal(result.data.headline, "Polycab Q2 Financial Results Approved");
  assert.equal(result.data.category, "results");
  assert.equal(result.data.actionRequired, true);

  // Verify llm_calls entry in store
  assert.equal(store.llmCalls.length, 1, "Winning call must be logged in llm_calls");
  const callLog = store.llmCalls[0]!;
  assert.equal(callLog.ok, true);
  assert.equal(callLog.provider, "groq");
  assert.equal(callLog.model, "openai/gpt-oss-20b");
  assert.equal(callLog.tokens_in, 110);
  assert.equal(callLog.tokens_out, 38);
  assert.ok(callLog.cost_inr > 0, "INR cost must be calculated");

  console.log(`\n4. Verified llm_calls ledger record:`);
  console.log(`   Provider: ${callLog.provider}`);
  console.log(`   Model: ${callLog.model}`);
  console.log(`   Tokens: In ${callLog.tokens_in}, Out ${callLog.tokens_out}`);
  console.log(`   Cost: ₹${callLog.cost_inr}`);
  console.log(`   Latency: ${callLog.latency_ms}ms`);

  console.log("\n[PASS] All 429 failover assertions passed successfully!");
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
