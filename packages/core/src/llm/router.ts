import { z, type ZodType } from "zod";
import type { Clock, Hasher, HttpClient, LlmClient, LlmRequest, LlmTask, Logger, Store } from "../ports";
import { estimateCostInr } from "./pricing";
import { DEFAULT_MODELS, TASK_CONFIG } from "./tasks";

export interface RouterEnv {
  geminiApiKey?: string;
  groqApiKey?: string;
  anthropicApiKey?: string;
  claudeApiKey?: string;
  modelCheap?: string;
  modelMid?: string;
  modelStrong?: string;
  modelCheapFailover?: string;
  modelMidFailover?: string;
  modelStrongFailover?: string;
  modelClaudeFailover?: string;
}

export interface ProviderCall {
  provider: "gemini" | "groq" | "anthropic";
  model: string;
  system: string;
  prompt: string;
}

export interface ProviderResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export type ProviderTransport = (call: ProviderCall) => Promise<ProviderResponse>;

export interface ModelRouterDeps {
  http: HttpClient;
  clock: Clock;
  hash: Hasher;
  log: Logger;
  store?: Store;
  env?: RouterEnv;
  /** Injected transport for unit testing or custom provider dispatch. */
  transport?: ProviderTransport;
}

/** Moderation filters from Groq account that must be explicitly ignored for general generation. */
export const IGNORED_MODELS = [
  "llama-prompt-guard",
  "gpt-oss-safeguard",
  "meta-llama/llama-prompt-guard-2-22m",
  "meta-llama/llama-prompt-guard-2-86m",
  "openai/gpt-oss-safeguard-20b",
] as const;

export function isModerationModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes("prompt-guard") || m.includes("safeguard") || m.includes("moderation");
}

/**
 * Checks if an error is a 429 rate limit, 503 service unavailable, timeout, or transient network error.
 */
export function isTransientOrRateLimit(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as any)?.status;
  if (status === 429 || status === 503 || status === 504 || status === 502 || status === 408) return true;
  return (
    /429|rate limit|quota|resource[_\s]+exhausted|exhausted|too many requests/i.test(msg) ||
    /503|service unavailable|overloaded|bad gateway|502|504/i.test(msg) ||
    /timeout|timed out|abort|etimedout|econnreset|fetch failed|network|socket/i.test(msg) ||
    /not configured/i.test(msg)
  );
}

export class ModelRouter implements LlmClient {
  constructor(private readonly deps: ModelRouterDeps) {}

  /**
   * Resolves the primary, Groq failover, and Claude failover models for a given task and tier.
   * Explicitly ignores moderation filters (llama-prompt-guard, gpt-oss-safeguard).
   */
  resolveModels(task: LlmTask, tier: "cheap" | "mid" | "strong"): {
    primaryModel: string;
    failoverModel?: string;
    claudeModel?: string;
    provider: "gemini" | "groq" | "anthropic";
  } {
    const config = TASK_CONFIG[task];
    const env = this.deps.env ?? {};

    let primaryModel = config?.defaultModel ?? DEFAULT_MODELS[tier];
    if (tier === "cheap" && env.modelCheap) primaryModel = env.modelCheap;
    if (tier === "mid" && env.modelMid) primaryModel = env.modelMid;
    if (tier === "strong" && env.modelStrong) primaryModel = env.modelStrong;

    // Reject moderation models if accidentally configured
    if (isModerationModel(primaryModel)) {
      primaryModel = DEFAULT_MODELS[tier];
    }

    let failoverModel = config?.failoverModel ?? (tier === "cheap" ? DEFAULT_MODELS.cheapFailover : DEFAULT_MODELS.midFailover);
    if (tier === "cheap" && env.modelCheapFailover) failoverModel = env.modelCheapFailover;
    if (tier === "mid" && env.modelMidFailover) failoverModel = env.modelMidFailover;
    if (tier === "strong" && env.modelStrongFailover) failoverModel = env.modelStrongFailover;

    // Explicitly ignore moderation filters (llama-prompt-guard, gpt-oss-safeguard)
    if (failoverModel && isModerationModel(failoverModel)) {
      failoverModel = tier === "cheap" ? DEFAULT_MODELS.cheapFailover : DEFAULT_MODELS.midFailover;
    }

    let claudeModel = config?.claudeModel ?? DEFAULT_MODELS.claudeFailover;
    if (env.modelClaudeFailover) claudeModel = env.modelClaudeFailover;

    return {
      primaryModel,
      failoverModel,
      claudeModel,
      provider: providerFor(primaryModel),
    };
  }

  /**
   * Deterministic cache key = SHA-256(task + ":" + promptVersion + ":" + model + ":" + normalizedInput).
   */
  async computeCacheKey(task: string, promptVersion: string, model: string, input: string): Promise<string> {
    const seed = `${task}:${promptVersion}:${model}:${input.trim()}`;
    return this.deps.hash.sha256(seed);
  }

  /**
   * Executes an LLM request through the 4-tier router:
   *   1. Checks deterministic cache (llm_cache) -> zero tokens/cost on hit
   *   2. Dispatches to primary model tier with structured JSON output
   *   3. Validates against Zod schema
   *   4. Single repair retry on schema failure before failing closed
   *   5. Fast failover to Groq on 429/503/timeout (<200ms, no blocking sleeps)
   *   6. Logs token usage, serving provider, serving model, latency, and list price in INR to llm_calls
   */
  async run<T>(req: LlmRequest<T>): Promise<{ data: T; model: string; cached?: boolean }> {
    const { primaryModel, failoverModel, claudeModel, provider } = this.resolveModels(req.task, req.tier);
    const cacheKey = await this.computeCacheKey(req.task, req.promptVersion, primaryModel, req.input);

    // 1. Check Cache
    if (this.deps.store?.getLlmCache) {
      try {
        const cached = await this.deps.store.getLlmCache(cacheKey);
        if (cached !== null && cached !== undefined) {
          const parsed = req.schema.safeParse(cached);
          if (parsed.success) {
            // Log cache hit
            if (this.deps.store?.logLlmCall) {
              await this.safe("call log", () => this.deps.store!.logLlmCall!({
                task: req.task,
                provider,
                model: primaryModel,
                tokens_in: 0,
                tokens_out: 0,
                cached: true,
                latency_ms: 0,
                cost_inr: 0,
                ok: true,
                error: null,
              }));
            }
            return { data: parsed.data, model: primaryModel, cached: true };
          }
        }
      } catch (err) {
        this.deps.log.warn("llm router: cache read failed, proceeding with model call", { task: req.task, error: String(err) });
      }
    }

    // 2. Dispatch Call with 3-tier Failover (Gemini -> Groq -> Claude) & Retry
    const start = this.deps.clock.now().getTime();
    let lastError: Error | null = null;
    let selectedModel = primaryModel;
    let selectedProvider = provider;
    let spentIn = 0;
    let spentOut = 0;
    let spentInr = 0;

    // Try primary (Gemini), then Groq failover, then Claude failover (haiku-5.5)
    const attempts: Array<{ model: string; provider: "gemini" | "groq" | "anthropic" }> = [
      { model: primaryModel, provider },
      ...(failoverModel && failoverModel !== primaryModel
        ? [{ model: failoverModel, provider: providerFor(failoverModel) }]
        : []),
      ...(claudeModel && claudeModel !== primaryModel && claudeModel !== failoverModel
        ? [{ model: claudeModel, provider: providerFor(claudeModel) }]
        : []),
    ];

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i]!;
      selectedModel = attempt.model;
      selectedProvider = attempt.provider;

      try {
        const result = await this.callWithRepairRetry(attempt.provider, attempt.model, req);
        const latencyMs = this.deps.clock.now().getTime() - start;
        const costInr = estimateCostInr(attempt.model, result.tokensIn, result.tokensOut, false);

        // Save to cache (bookkeeping never fails a successful call)
        if (this.deps.store?.setLlmCache) {
          await this.safe("cache write", () => this.deps.store!.setLlmCache!(cacheKey, {
            task: req.task,
            model: attempt.model,
            prompt_version: req.promptVersion,
            output: result.data,
          }));
        }

        // Log call metrics: records which provider actually served the request (gemini, groq, or anthropic),
        // the exact model used, latency in ms, tokens, and inr cost
        if (this.deps.store?.logLlmCall) {
          await this.safe("call log", () => this.deps.store!.logLlmCall!({
            task: req.task,
            provider: attempt.provider,
            model: attempt.model,
            tokens_in: result.tokensIn,
            tokens_out: result.tokensOut,
            cached: false,
            latency_ms: latencyMs,
            cost_inr: costInr,
            ok: true,
            error: null,
          }));
        }

        return { data: result.data, model: attempt.model, cached: false };
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const used = (err as { tokensIn?: number; tokensOut?: number }) ?? {};
        spentIn += used.tokensIn ?? 0;
        spentOut += used.tokensOut ?? 0;
        spentInr += estimateCostInr(attempt.model, used.tokensIn ?? 0, used.tokensOut ?? 0, false);

        const hasNext = i + 1 < attempts.length;
        if (hasNext) {
          const nextAttempt = attempts[i + 1]!;
          const isTransient = isTransientOrRateLimit(lastError);
          this.deps.log.warn(
            `llm router: ${i === 0 ? "primary " : ""}provider ${attempt.provider} (${attempt.model}) failed (${lastError.message}), failing over immediately to ${nextAttempt.provider} (${nextAttempt.model})`,
            {
              task: req.task,
              failedModel: attempt.model,
              failedProvider: attempt.provider,
              primaryModel: attempt.model,
              primaryProvider: attempt.provider,
              failoverModel: nextAttempt.model,
              failoverProvider: nextAttempt.provider,
              isRateLimit: isTransient,
              error: lastError.message,
            }
          );
        } else {
          this.deps.log.warn(`llm router: call failed on ${attempt.model}`, {
            task: req.task,
            provider: attempt.provider,
            error: lastError.message,
          });
        }
      }
    }

    // Failed both primary and failover
    const latencyMs = this.deps.clock.now().getTime() - start;
    if (this.deps.store?.logLlmCall) {
      await this.safe("call log", () => this.deps.store!.logLlmCall!({
        task: req.task,
        provider: selectedProvider,
        model: selectedModel,
        // Failed calls still cost money: log what the failed attempts used.
        tokens_in: spentIn,
        tokens_out: spentOut,
        cached: false,
        latency_ms: latencyMs,
        cost_inr: spentInr,
        ok: false,
        error: lastError?.message ?? "unknown failure",
      }));
    }

    throw lastError ?? new Error(`LLM task "${req.task}" failed on model ${selectedModel}`);
  }

  /**
   * Calls the provider and performs a single repair retry if JSON parsing or Zod validation fails.
   */
  private async callWithRepairRetry<T>(
    provider: "gemini" | "groq" | "anthropic",
    model: string,
    req: LlmRequest<T>,
  ): Promise<{ data: T; tokensIn: number; tokensOut: number }> {
    let tokensIn = 0;
    let tokensOut = 0;

    const system = withSchema(req.system, req.schema);
    // Initial attempt
    const res1 = await this.dispatch(provider, model, system, req.input);
    tokensIn += res1.tokensIn;
    tokensOut += res1.tokensOut;

    const parsed1 = this.parseAndValidate(res1.text, req.schema);
    if (parsed1.ok) {
      return { data: parsed1.data, tokensIn, tokensOut };
    }

    // Single repair retry
    this.deps.log.warn("llm router: output validation failed, attempting repair retry", {
      task: req.task,
      error: parsed1.error,
    });

    const repairPrompt = [
      "Your previous output was invalid according to the required schema.",
      `Validation error: ${parsed1.error}`,
      "Here is your previous output:",
      res1.text,
      "Please return ONLY a corrected, strictly valid JSON object matching the required schema.",
    ].join("\n\n");

    const res2 = await this.dispatch(provider, model, system, `${repairPrompt}\n\nOriginal input:\n${req.input}`);
    tokensIn += res2.tokensIn;
    tokensOut += res2.tokensOut;

    const parsed2 = this.parseAndValidate(res2.text, req.schema);
    if (parsed2.ok) {
      return { data: parsed2.data, tokensIn, tokensOut };
    }

    throw Object.assign(new Error(`Output failed schema validation after repair retry: ${parsed2.error}`), { tokensIn, tokensOut });
  }

  /**
   * Parses JSON string and validates with Zod.
   */
  private parseAndValidate<T>(rawText: string, schema: ZodType<T>): { ok: true; data: T } | { ok: false; error: string } {
    let json: unknown;
    try {
      // Strip markdown code fences if model enclosed in ```json ... ```
      const cleaned = rawText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      json = JSON.parse(cleaned);
    } catch (e: any) {
      return { ok: false, error: `Malformed JSON: ${e.message}` };
    }

    const result = schema.safeParse(json);
    if (!result.success) {
      return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    }

    return { ok: true, data: result.data };
  }

  /**
   * Dispatches the call via injected transport or standard HTTP API.
   */
  private async dispatch(
    provider: "gemini" | "groq" | "anthropic",
    model: string,
    system: string,
    prompt: string,
  ): Promise<ProviderResponse> {
    if (this.deps.transport) {
      return this.deps.transport({ provider, model, system, prompt });
    }

    if (provider === "gemini") {
      return this.callGeminiApi(model, system, prompt);
    } else if (provider === "groq") {
      return this.callGroqApi(model, system, prompt);
    } else if (provider === "anthropic") {
      return this.callAnthropicApi(model, system, prompt);
    }

    throw new Error(`Unsupported provider: ${provider}`);
  }

  private async callGeminiApi(model: string, system: string, prompt: string): Promise<ProviderResponse> {
    const apiKey = this.deps.env?.geminiApiKey;
    if (!apiKey) {
      const err: any = new Error("GEMINI_API_KEY is not configured");
      err.status = 401;
      throw err;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
      },
    };

    const res = await this.deps.http.request({
      url,
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      timeoutMs: 30_000,
    });

    if (res.status < 200 || res.status >= 300) {
      const errText = (await res.text().catch(() => "")).slice(0, 300);
      const error: any = new Error(`Gemini API error (${res.status}): ${errText}`);
      error.status = res.status;
      throw error;
    }

    const raw = await res.text();
    const data: any = JSON.parse(raw);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const tokensIn = data.usageMetadata?.promptTokenCount ?? Math.ceil(prompt.length / 4);
    const tokensOut = data.usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4);

    return { text, tokensIn, tokensOut };
  }

  private async safe(what: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.deps.log.warn(`llm router: ${what} failed (result still returned)`, { error: String(err).slice(0, 200) });
    }
  }

  private async callAnthropicApi(model: string, system: string, prompt: string): Promise<ProviderResponse> {
    const apiKey = (this.deps.env?.claudeApiKey || this.deps.env?.anthropicApiKey)?.trim();
    if (!apiKey) {
      const err: any = new Error("CLAUDE_API_KEY / ANTHROPIC_API_KEY is not configured");
      err.status = 401;
      throw err;
    }
    // Map haiku-5.5 shorthand to Anthropic's official API model identifier
    const apiModel = model === "haiku-5.5" ? "claude-3-5-haiku-20241022" : model;
    const res = await this.deps.http.request({
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: apiModel, max_tokens: 8192, system, messages: [{ role: "user", content: prompt }] }),
      timeoutMs: 60_000,
    });
    if (res.status < 200 || res.status >= 300) {
      const errText = (await res.text().catch(() => "")).slice(0, 300);
      const error: any = new Error(`Anthropic API error (${res.status}): ${errText}`);
      error.status = res.status;
      throw error;
    }
    const data: any = JSON.parse(await res.text());
    const text = (data.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    return { text, tokensIn: data.usage?.input_tokens ?? Math.ceil(prompt.length / 4), tokensOut: data.usage?.output_tokens ?? Math.ceil(text.length / 4) };
  }

  private async callGroqApi(model: string, system: string, prompt: string): Promise<ProviderResponse> {
    const apiKey = this.deps.env?.groqApiKey;
    if (!apiKey) {
      const err: any = new Error("GROQ_API_KEY is not configured");
      err.status = 401;
      throw err;
    }

    const url = "https://api.groq.com/openai/v1/chat/completions";
    const body = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    };

    const res = await this.deps.http.request({
      url,
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      timeoutMs: 30_000,
    });

    if (res.status < 200 || res.status >= 300) {
      const errText = (await res.text().catch(() => "")).slice(0, 300);
      const error: any = new Error(`Groq API error (${res.status}): ${errText}`);
      error.status = res.status;
      throw error;
    }

    const raw = await res.text();
    const data: any = JSON.parse(raw);
    const text = data.choices?.[0]?.message?.content ?? "";
    const tokensIn = data.usage?.prompt_tokens ?? Math.ceil(prompt.length / 4);
    const tokensOut = data.usage?.completion_tokens ?? Math.ceil(text.length / 4);

    return { text, tokensIn, tokensOut };
  }
}

/** Provider follows the model name: claude-* / haiku-* → Anthropic, gemini-* → Google, anything else → Groq. */
export function providerFor(model: string): "gemini" | "groq" | "anthropic" {
  if (/^(claude|haiku)/i.test(model)) return "anthropic";
  if (/^gemini/i.test(model)) return "gemini";
  return "groq";
}

/** The system prompt plus the exact JSON Schema the output is validated against. */
export function withSchema(system: string, schema: ZodType<unknown>): string {
  let json: string;
  try {
    json = JSON.stringify(z.toJSONSchema(schema, { unrepresentable: "any" }));
  } catch {
    return system;
  }
  return `${system}\n\nReturn ONLY a JSON value that validates against this JSON Schema:\n${json}`;
}
