import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LLMProvider } from '../provider.js';
import { ScoreOutputSchema } from '../schemas/score-schema.js';
import type { ScoreOutput } from '../schemas/score-schema.js';
import type { ExtractOutput } from '../schemas/extract-schema.js';
import { ProviderError } from '../../utils/errors.js';

export interface ScoreInput {
  clusters: ExtractOutput['clusters'];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = resolve(__dirname, '../../../prompts/score-v1.md');

export async function runScoreStage(
  provider: LLMProvider,
  input: ScoreInput
): Promise<ScoreOutput> {
  let systemPrompt: string;
  try {
    systemPrompt = await readFile(PROMPT_PATH, 'utf-8');
  } catch (err) {
    throw new ProviderError(
      `Failed to read score prompt template: ${(err as Error).message}`
    );
  }

  const userContent = JSON.stringify({ clusters: input.clusters });

  try {
    return await provider.call<ScoreOutput>({
      systemPrompt,
      userContent,
      outputSchema: ScoreOutputSchema,
    });
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(
      `Score stage failed: ${(err as Error).message}`
    );
  }
}
