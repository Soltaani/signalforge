import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LLMProvider } from '../provider.js';
import { GenerateOutputSchema } from '../schemas/generate-schema.js';
import type { GenerateOutput } from '../schemas/generate-schema.js';
import type { EvidenceItem } from '../../pipeline/evidence-pack.js';
import { ProviderError } from '../../utils/errors.js';

export interface ScoredCluster {
  id: string;
  label: string;
  score: number;
  rank: number;
  scoreBreakdown: Record<string, { score: number; max: number }>;
  summary: { claim: string; evidence: string[]; snippets?: string[] };
  keyphrases: string[];
  painSignals: Array<{
    id: string;
    type: string;
    statement: string;
    evidence: string[];
    snippets?: string[];
  }>;
}

export interface GenerateInput {
  qualifyingClusters: ScoredCluster[];
  items: EvidenceItem[];
  maxIdeasPerCluster: number;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = resolve(__dirname, '../../../prompts/generate-v1.md');

export async function runGenerateStage(
  provider: LLMProvider,
  input: GenerateInput
): Promise<GenerateOutput> {
  let template: string;
  try {
    template = await readFile(PROMPT_PATH, 'utf-8');
  } catch (err) {
    throw new ProviderError(
      `Failed to read generate prompt template: ${(err as Error).message}`
    );
  }

  const systemPrompt = template.replace(
    /\{\{maxIdeasPerCluster\}\}/g,
    String(input.maxIdeasPerCluster)
  );

  const userContent = JSON.stringify({
    qualifyingClusters: input.qualifyingClusters,
    items: input.items,
    maxIdeasPerCluster: input.maxIdeasPerCluster,
  });

  try {
    return await provider.call<GenerateOutput>({
      systemPrompt,
      userContent,
      outputSchema: GenerateOutputSchema,
    });
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(
      `Generate stage failed: ${(err as Error).message}`
    );
  }
}
