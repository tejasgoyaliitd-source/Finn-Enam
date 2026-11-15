import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";
import { ModelRouter, type ChartClient, type CoreDeps } from "@finn/core";
import { consoleLogger, DEMO_PORTFOLIO_ID, fetchHttpClient, nodeHasher, supabaseStore, systemClock, yahooChartClient } from "@finn/adapters";

export interface ApiEnv {
  supabaseUrl: string;
  serviceKey: string;
  cronSecret: string | null;
  /** Allowed browser origins (WEB_ORIGIN, comma separated). Localhost is added outside production. */
  webOrigins: string[];
  production: boolean;
  portfolioId: string;
  /** Public URL of this deployment, for self-chaining research steps. */
  selfUrl: string | null;
  onVercel: boolean;
}

export interface ApiCtx {
  env: ApiEnv;
  /** Read queries the API composes itself. Service role: server side only. */
  db: SupabaseClient;
  /** The same packages/core dependencies the refresher uses, with runner "cron". */
  deps: CoreDeps & { chart: ChartClient };
  /** Keep work alive after the response is sent (Vercel waitUntil; a plain promise locally). */
  background: (p: Promise<unknown>) => void;
}

export function readEnv(e: NodeJS.ProcessEnv = process.env): ApiEnv {
  const supabaseUrl = e.SUPABASE_URL;
  const serviceKey = e.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  return {
    supabaseUrl,
    serviceKey,
    cronSecret: e.CRON_SECRET || null,
    webOrigins: (e.WEB_ORIGIN ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    production: e.NODE_ENV === "production" || e.VERCEL_ENV === "production",
    portfolioId: e.FINN_PORTFOLIO_ID || DEMO_PORTFOLIO_ID,
    selfUrl: e.API_URL || (e.VERCEL_URL ? `https://${e.VERCEL_URL}` : null),
    onVercel: Boolean(e.VERCEL),
  };
}

export function createCtx(env: ApiEnv = readEnv(), e: NodeJS.ProcessEnv = process.env): ApiCtx {
  const base = { http: fetchHttpClient(), clock: systemClock(), hash: nodeHasher(), log: consoleLogger({ quiet: env.production }) };
  const store = supabaseStore(env.supabaseUrl, env.serviceKey);
  const claudeKey = e.CLAUDE_API_KEY || (e as any).claude_api_key || e.ANTHROPIC_API_KEY;
  const llm =
    e.GEMINI_API_KEY || e.GROQ_API_KEY || claudeKey
      ? new ModelRouter({
          ...base,
          store,
          env: {
            ...(e.GEMINI_API_KEY ? { geminiApiKey: e.GEMINI_API_KEY.trim() } : {}),
            ...(e.GROQ_API_KEY ? { groqApiKey: e.GROQ_API_KEY.trim() } : {}),
            ...(claudeKey ? { anthropicApiKey: claudeKey.trim(), claudeApiKey: claudeKey.trim() } : {}),
            ...(e.MODEL_CHEAP ? { modelCheap: e.MODEL_CHEAP.trim() } : {}),
            ...(e.MODEL_MID ? { modelMid: e.MODEL_MID.trim() } : {}),
            ...(e.MODEL_STRONG ? { modelStrong: e.MODEL_STRONG.trim() } : {}),
            ...(e.MODEL_CHEAP_FAILOVER ? { modelCheapFailover: e.MODEL_CHEAP_FAILOVER.trim() } : {}),
            ...(e.MODEL_MID_FAILOVER ? { modelMidFailover: e.MODEL_MID_FAILOVER.trim() } : {}),
            ...(e.MODEL_STRONG_FAILOVER ? { modelStrongFailover: e.MODEL_STRONG_FAILOVER.trim() } : {}),
            ...(e.MODEL_CLAUDE_FAILOVER ? { modelClaudeFailover: e.MODEL_CLAUDE_FAILOVER.trim() } : {}),
          },
        })
      : undefined;
  return {
    env,
    db: createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    deps: { ...base, store, runner: "cron", chart: yahooChartClient(), portfolioId: env.portfolioId, ...(llm ? { llm } : {}) },
    background: (p) => {
      const safe = p.catch((err) => base.log.error("background task failed", { error: String(err).slice(0, 300) }));
      if (env.onVercel) waitUntil(safe);
    },
  };
}
