import { z } from 'zod';

import { GroundedClaimSchema } from './extract-schema.js';

const ScoreFactorSchema = z.object({
  score: z.number(),
  max: z.number(),
});

export const ScoreBreakdownSchema = z.object({
  frequency: ScoreFactorSchema,
  painIntensity: ScoreFactorSchema,
  buyerClarity: ScoreFactorSchema,
  monetizationSignal: ScoreFactorSchema,
  buildSimplicity: ScoreFactorSchema,
  novelty: ScoreFactorSchema,
});

export const ScoreOutputSchema = z.object({
  scoredClusters: z.array(
    z.object({
      clusterId: z.string().min(1),
      score: z.number().min(0).max(100),
      rank: z.number().int().min(1),
      scoreBreakdown: ScoreBreakdownSchema,
      whyNow: GroundedClaimSchema,
    }),
  ),
});

export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;
export type ScoreOutput = z.infer<typeof ScoreOutputSchema>;
