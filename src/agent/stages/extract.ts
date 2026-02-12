import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LLMProvider } from '../provider.js';
import { ExtractOutputSchema } from '../schemas/extract-schema.js';
import type { ExtractOutput } from '../schemas/extract-schema.js';
import type { EvidencePack } from '../../pipeline/evidence-pack.js';
import { ProviderError } from '../../utils/errors.js';

export interface ExtractInput {
  evidencePack: EvidencePack;
  maxClusters: number;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = resolve(__dirname, '../../../prompts/extract-v1.md');

export async function runExtractStage(
  provider: LLMProvider,
  input: ExtractInput
): Promise<ExtractOutput> {
  let template: string;
  try {
    template = await readFile(PROMPT_PATH, 'utf-8');
  } catch (err) {
    throw new ProviderError(
      `Failed to read extract prompt template: ${(err as Error).message}`
    );
  }

  const minClusterSize =
    input.evidencePack.metadata.thresholds.minClusterSize ?? 2;

  const systemPrompt = template
    .replace(/\{\{maxClusters\}\}/g, String(input.maxClusters))
    .replace(/\{\{minClusterSize\}\}/g, String(minClusterSize));

  const userContent = JSON.stringify(input.evidencePack);

  try {
    return await provider.call<ExtractOutput>({
      systemPrompt,
      userContent,
      outputSchema: ExtractOutputSchema,
    });
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(
      `Extract stage failed: ${(err as Error).message}`
    );
  }
}
