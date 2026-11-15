/**
 * Test script: Simulates a 429 Rate Limit from primary provider (Gemini)
 * and verifies that failover to Groq happens automatically, returning
 * valid Zod-parsed data and recording complete metadata in llm_calls.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  MemoryStore,
  ModelRouter,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
  type LlmRequest,
} from "../../src/index";

// Schema to validate
const ClassificationSchema = z.strictObject({
  headline: z.string().min(1),
  category: z.enum(["results", "governance", "material", "routine"]),
  confidence: z.number().min(0).max(1),
  actionRequired: z.boolean(),
});
type Classification = z.infer<typeof ClassificationSchema>;

test("429 rate limit simulation: fails over from Gemini to Groq (openai/gpt-oss-20b) and parses with Zod", async () => {
  const store = new MemoryStore();
  const sha256 = async (d: Uint8Array | string) => createHash("sha256").update(d).digest("hex");
  const clock = { now: () => new Date(), sleep: async (_ms: number) => {} };
  const logs: string[] = [];
  const logger = {
    info: (m: string) => logs.push(`[INFO] ${m}`),
    warn: (m: string, ctx?: any) => {
      logs.push(`[WARN] ${m} ${JSON.stringify(ctx ?? {})}`);
    },
    error: (m: string) => logs.push(`[ERROR] ${m}`),
  };

  const requestsMade: { url: string; model?: string; provider?: string }[] = [];

  // Mock HTTP client that simulates Gemini 429 Rate Limit, and Groq 200 OK
  const mockHttp: HttpClient = {
    async request(req: HttpRequest): Promise<HttpResponse> {
      if (req.url.includes("generativelanguage.googleapis.com")) {
        requestsMade.push({ url: req.url, provider: "gemini" });
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

  // Assertions
  assert.equal(requestsMade.length, 2, "Must make exactly 2 requests: Gemini then Groq");
  assert.equal(requestsMade[0]?.provider, "gemini");
  assert.equal(requestsMade[1]?.provider, "groq");
  assert.equal(requestsMade[1]?.model, "openai/gpt-oss-20b", "Cheap tier must failover to openai/gpt-oss-20b");
  assert.equal(result.model, "openai/gpt-oss-20b");
  assert.equal(result.data.headline, "Polycab Q2 Financial Results Approved");
  assert.equal(result.data.category, "results");
  assert.equal(result.data.actionRequired, true);

  // Verify warning was logged about the 429 and failover
  assert.ok(logs.some((l) => l.includes("primary provider gemini") && l.includes("failing over immediately to groq")));

  // Verify llm_calls entry in store
  assert.equal(store.llmCalls.length, 1, "Winning call must be logged in llm_calls");
  const callLog = store.llmCalls[0]!;
  assert.equal(callLog.ok, true);
  assert.equal(callLog.provider, "groq");
  assert.equal(callLog.model, "openai/gpt-oss-20b");
  assert.equal(callLog.tokens_in, 110);
  assert.equal(callLog.tokens_out, 38);
  assert.ok(callLog.cost_inr > 0, "INR cost must be calculated");
  assert.ok(totalElapsed < 200, "Failover must execute in under 200ms");
});
