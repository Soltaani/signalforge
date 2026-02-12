import type { ZodType } from 'zod';
import type { AgentConfig } from '../config/schema.js';
import { ProviderError } from '../utils/errors.js';

export interface LLMCallParams<T> {
  systemPrompt: string;
  userContent: string;
  outputSchema: ZodType<T>;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMProvider {
  call<T>(params: LLMCallParams<T>): Promise<T>;
  readonly name: string;
  readonly model: string;
}

export async function createProvider(config: AgentConfig): Promise<LLMProvider> {
  switch (config.provider) {
    case 'openai': {
      const { OpenAIProvider } = await import('./openai-provider.js');
      return new OpenAIProvider(config);
    }
    case 'anthropic': {
      const { AnthropicProvider } = await import('./anthropic-provider.js');
      return new AnthropicProvider(config);
    }
    default:
      throw new ProviderError(`Unknown provider: ${config.provider as string}`);
  }
}
