import type { LlmTask } from "../ports";

export type TierLevel = 0 | 1 | 2 | 3;

export interface TaskTierConfig {
  tier: TierLevel;
  tierName: "code" | "cheap" | "mid" | "strong";
  defaultModel: string;
  failoverModel?: string;
  provider: "gemini" | "groq" | "anthropic";
}

export const DEFAULT_MODELS = {
  cheap: "gemini-3.1-flash-lite",
  mid: "gemini-3.5-flash",
  strong: "gemini-2.5-pro",
  cheapFailover: "openai/gpt-oss-20b",
  midFailover: "openai/gpt-oss-120b",
  strongFailover: "openai/gpt-oss-120b",
} as const;

export const TASK_CONFIG: Record<LlmTask, TaskTierConfig> = {
  // Tier 1: cheap high volume short tasks
  classify_filing: {
    tier: 1,
    tierName: "cheap",
    defaultModel: DEFAULT_MODELS.cheap,
    failoverModel: DEFAULT_MODELS.cheapFailover,
    provider: "gemini",
  },
  rewrite_headline: {
    tier: 1,
    tierName: "cheap",
    defaultModel: DEFAULT_MODELS.cheap,
    failoverModel: DEFAULT_MODELS.cheapFailover,
    provider: "gemini",
  },
  read_meeting_date: {
    tier: 1,
    tierName: "cheap",
    defaultModel: DEFAULT_MODELS.cheap,
    failoverModel: DEFAULT_MODELS.cheapFailover,
    provider: "gemini",
  },
  tag_segments: {
    tier: 1,
    tierName: "cheap",
    defaultModel: DEFAULT_MODELS.cheap,
    failoverModel: DEFAULT_MODELS.cheapFailover,
    provider: "gemini",
  },

  // Tier 2: mid long-context & structured extraction
  extract_results: {
    tier: 2,
    tierName: "mid",
    defaultModel: DEFAULT_MODELS.mid,
    failoverModel: DEFAULT_MODELS.midFailover,
    provider: "gemini",
  },
  extract_people: {
    tier: 2,
    tierName: "mid",
    defaultModel: DEFAULT_MODELS.mid,
    failoverModel: DEFAULT_MODELS.midFailover,
    provider: "gemini",
  },
  extract_guidance: {
    tier: 2,
    tierName: "mid",
    defaultModel: DEFAULT_MODELS.mid,
    failoverModel: DEFAULT_MODELS.midFailover,
    provider: "gemini",
  },
  answer_scoped: {
    tier: 2,
    tierName: "mid",
    defaultModel: DEFAULT_MODELS.mid,
    failoverModel: DEFAULT_MODELS.midFailover,
    provider: "gemini",
  },

  // Tier 3: strong synthesis & reasoning
  write_risks: {
    tier: 3,
    tierName: "strong",
    defaultModel: DEFAULT_MODELS.strong,
    failoverModel: DEFAULT_MODELS.strongFailover,
    provider: "gemini",
  },
  write_questions: {
    tier: 3,
    tierName: "strong",
    defaultModel: DEFAULT_MODELS.strong,
    failoverModel: DEFAULT_MODELS.strongFailover,
    provider: "gemini",
  },
};
