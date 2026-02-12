import { z } from 'zod';

import { GroundedClaimSchema } from './extract-schema.js';

export const OpportunitySchema = z.object({
  id: z.string().min(1),
  clusterId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  targetAudience: z.string().min(1),
  painPoint: z.string().min(1),
  monetizationModel: z.string().min(1),
  mvpScope: z.string().min(1),
  validationSteps: z.array(z.string().min(1)).min(1),
  evidence: z.array(z.string().min(1)).min(1),
});

export const GenerateOutputSchema = z.object({
  opportunities: z.array(OpportunitySchema),
  bestBet: z.object({
    clusterId: z.string().min(1),
    opportunityId: z.string().min(1),
    why: z.array(GroundedClaimSchema),
  }),
});

export type Opportunity = z.infer<typeof OpportunitySchema>;
export type GenerateOutput = z.infer<typeof GenerateOutputSchema>;
