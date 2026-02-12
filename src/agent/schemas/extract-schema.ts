import { z } from 'zod';

export const PainSignalSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'complaint',
    'urgency',
    'workaround',
    'monetization',
    'buyer',
    'risk',
  ]),
  statement: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
  snippets: z.array(z.string()).optional(),
});

export const GroundedClaimSchema = z.object({
  claim: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
  snippets: z.array(z.string()).optional(),
});

export const ExtractOutputSchema = z.object({
  clusters: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        summary: GroundedClaimSchema,
        keyphrases: z.array(z.string()),
        itemIds: z.array(z.string().min(1)).min(1),
        painSignals: z.array(PainSignalSchema),
      }),
    )
    .min(1),
});

export type PainSignal = z.infer<typeof PainSignalSchema>;
export type GroundedClaim = z.infer<typeof GroundedClaimSchema>;
export type ExtractOutput = z.infer<typeof ExtractOutputSchema>;
