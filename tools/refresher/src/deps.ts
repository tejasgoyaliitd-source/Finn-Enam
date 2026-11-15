import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryStore, ModelRouter, type CompanyRef, type CoreDeps, type ChartClient, type Store } from "@finn/core";
import { consoleLogger, fetchHttpClient, nodeHasher, supabaseStore, systemClock, yahooChartClient } from "@finn/adapters";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/** Loads <repo>/.env if present. Real environment variables win. */
export function loadEnv(): void {
  const file = resolve(REPO_ROOT, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

/**
 * Demo companies parsed from supabase/seed.sql, so --dry-run works with no database.
 * Matches lines like: ('HDFCBANK', 'HDFC Bank Ltd', 'INE040A01034', '500180', '...', true),
 */
export function seedCompanies(): CompanyRef[] {
  const sql = readFileSync(resolve(REPO_ROOT, "supabase/seed.sql"), "utf8");
  const re = /\(\s*'([A-Z0-9&-]+)',\s*'[^']*',\s*'IN[A-Z0-9]{10}',\s*'(\d{6})',\s*'[^']*',\s*(true|false)\s*\)/g;
  return [...sql.matchAll(re)].map((m) => ({ symbol: m[1]!, bse_code: m[2]!, is_bank: m[3] === "true" }));
}

/** Demo portfolio weights from supabase/seed.sql lines like: ('HDFCBANK',   9.00), */
export function seedWeights(): Record<string, number> {
  const sql = readFileSync(resolve(REPO_ROOT, "supabase/seed.sql"), "utf8");
  return Object.fromEntries([...sql.matchAll(/\(\s*'([A-Z0-9&-]+)',\s*(\d{1,3}\.\d{2})\s*\)/g)].map((m) => [m[1]!, Number(m[2])]));
}

export function buildDeps(opts: { dryRun: boolean; quiet?: boolean }): CoreDeps & { chart: ChartClient; memory?: MemoryStore } {
  let store: Store;
  let memory: MemoryStore | undefined;
  if (opts.dryRun) {
    memory = new MemoryStore(seedCompanies(), seedWeights());
    store = memory;
  } else {
    // SUPABASE_URL, or the project origin from SUPABASE_JWKS_URL (https://<ref>.supabase.co/auth/v1/...).
    const jwks = process.env.SUPABASE_JWKS_URL;
    const url = process.env.SUPABASE_URL ?? (jwks && /^https:\/\/[a-z0-9]+\.supabase\.co\//.test(jwks) ? new URL(jwks).origin : undefined);
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set (copy .env.example to .env), or pass --dry-run");
    }
    store = supabaseStore(url, key);
  }
  const base = { http: fetchHttpClient(), clock: systemClock(), hash: nodeHasher(), log: consoleLogger({ quiet: opts.quiet }) };
  const e = process.env;
  const claudeKey = e.CLAUDE_API_KEY || (e as any).claude_api_key || e.ANTHROPIC_API_KEY;
  // The model router is on as soon as any provider key is set; without one, model steps fall back or fail closed.
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
    ...base,
    store,
    runner: "refresher",
    chart: yahooChartClient(),
    ...(llm ? { llm } : {}),
    ...(memory ? { memory } : {}),
  };
}
