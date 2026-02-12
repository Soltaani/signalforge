import { z } from 'zod';

export const AgentConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic']).default('openai'),
  model: z.string().default('gpt-5.2'),
  temperature: z.number().min(0).max(1).default(0.2),
  endpoint: z.string().nullable().default(null),
  maxTokens: z.number().int().positive().nullable().default(null),
  contextWindowTokens: z.number().int().positive().default(400_000),
  reserveTokens: z.number().int().positive().default(30_000),
});

export const FeedConfigSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  weight: z.number().min(0).max(5),
  enabled: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
});

export const ThresholdsSchema = z.object({
  minScore: z.number().int().min(0).max(100).default(65),
  minClusterSize: z.number().int().min(1).default(2),
  dedupeThreshold: z.number().min(0).max(1).default(0.88),
});

export const SignalForgeConfigSchema = z.object({
  agent: AgentConfigSchema.default({}),
  feeds: z.array(FeedConfigSchema).min(1),
  thresholds: ThresholdsSchema.default({}),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type FeedConfig = z.infer<typeof FeedConfigSchema>;
export type Thresholds = z.infer<typeof ThresholdsSchema>;
export type SignalForgeConfig = z.infer<typeof SignalForgeConfigSchema>;
