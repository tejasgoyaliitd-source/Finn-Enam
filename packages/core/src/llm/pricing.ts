/**
 * Pricing table in INR per 1,000,000 tokens.
 *
 * Current list rates (converted at ~USD 1 = INR 85):
 *   gemini-3.1-flash-lite: in: ₹6.25, out: ₹25.00
 *   gemini-3.5-flash: in: ₹12.50, out: ₹50.00
 *   gemini-2.5-pro: in: ₹106.25, out: ₹850.00
 *   openai/gpt-oss-20b (Groq): in: ₹6.25, out: ₹20.00
 *   qwen/qwen3.8-27b (Groq): in: ₹8.50, out: ₹25.00
 *   openai/gpt-oss-120b (Groq): in: ₹15.00, out: ₹50.00
 *   haiku-5.5 / claude-3-5-haiku: in: ₹68.00, out: ₹340.00
 *   claude-3-5-sonnet: in: ₹250.00, out: ₹1250.00
 */

export interface ModelPricing {
  inrPerMillionInput: number;
  inrPerMillionOutput: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "gemini-3.1-flash-lite": { inrPerMillionInput: 6.25, inrPerMillionOutput: 25.0 },
  "gemini-3.5-flash": { inrPerMillionInput: 12.5, inrPerMillionOutput: 50.0 },
  // Google list price $1.25 / $10 per 1M tokens (prompts ≤200k).
  "gemini-2.5-pro": { inrPerMillionInput: 106.25, inrPerMillionOutput: 850.0 },
  // Groq lightweight failover for tier 1
  "openai/gpt-oss-20b": { inrPerMillionInput: 6.25, inrPerMillionOutput: 20.0 },
  "gpt-oss-20b": { inrPerMillionInput: 6.25, inrPerMillionOutput: 20.0 },
  "qwen/qwen3.8-27b": { inrPerMillionInput: 8.5, inrPerMillionOutput: 25.0 },
  // Groq high reasoning failover for tier 2 & 3
  "openai/gpt-oss-120b": { inrPerMillionInput: 15.0, inrPerMillionOutput: 50.0 },
  "gpt-oss-120b": { inrPerMillionInput: 15.0, inrPerMillionOutput: 50.0 },
  // Claude / Anthropic tier 2 failover: Claude 3.5 Haiku ($0.80 / $4.00 per 1M tokens @ USD 1 = INR 85)
  "haiku-5.5": { inrPerMillionInput: 68.0, inrPerMillionOutput: 340.0 },
  "claude-3-5-haiku-20241022": { inrPerMillionInput: 68.0, inrPerMillionOutput: 340.0 },
  "claude-3-5-haiku": { inrPerMillionInput: 68.0, inrPerMillionOutput: 340.0 },
  "claude-3-5-sonnet": { inrPerMillionInput: 250.0, inrPerMillionOutput: 1250.0 },
};

const DEFAULT_PRICING: ModelPricing = { inrPerMillionInput: 12.5, inrPerMillionOutput: 50.0 };

/**
 * Calculates estimated cost in INR for an LLM call.
 * Cache hits cost exactly ₹0.
 */
export function estimateCostInr(model: string, tokensIn: number, tokensOut: number, cached = false): number {
  if (cached) return 0;
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  const cost = (tokensIn * pricing.inrPerMillionInput + tokensOut * pricing.inrPerMillionOutput) / 1_000_000;
  return Math.round(cost * 10000) / 10000;
}
