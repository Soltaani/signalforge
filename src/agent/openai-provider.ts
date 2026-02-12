import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { AgentConfig } from '../config/schema.js';
import { ProviderError } from '../utils/errors.js';
import type { LLMProvider, LLMCallParams } from './provider.js';

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  readonly name = 'openai' as const;
  readonly model: string;

  constructor(private config: AgentConfig) {
    this.model = config.model;
    this.client = new OpenAI({
      ...(config.endpoint ? { baseURL: config.endpoint } : {}),
    });
  }

  async call<T>(params: LLMCallParams<T>): Promise<T> {
    const firstAttempt = await this.attempt(params);
    if (firstAttempt.ok) {
      return firstAttempt.value;
    }

    const retryParams: LLMCallParams<T> = {
      ...params,
      userContent: `${params.userContent}\n\n[RETRY] Your previous response failed validation:\n${firstAttempt.reason}\n\nPlease fix the output to match the required schema exactly.`,
    };

    const secondAttempt = await this.attempt(retryParams);
    if (secondAttempt.ok) {
      return secondAttempt.value;
    }

    throw new ProviderError(
      `OpenAI call failed after retry: ${secondAttempt.reason}`
    );
  }

  private async attempt<T>(
    params: LLMCallParams<T>
  ): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
    try {
      const completion = await this.client.chat.completions.parse({
        model: this.model,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userContent },
        ],
        response_format: zodResponseFormat(params.outputSchema, 'stage_output'),
        temperature: params.temperature ?? 0.2,
        max_tokens: params.maxTokens ?? 8192,
      });

      const message = completion.choices[0]?.message;
      if (!message) {
        return { ok: false, reason: 'No message in OpenAI response' };
      }

      if (message.refusal) {
        return { ok: false, reason: `Model refused: ${message.refusal}` };
      }

      const parsed = message.parsed;
      if (!parsed) {
        return { ok: false, reason: 'No parsed response from OpenAI' };
      }

      return { ok: true, value: parsed as T };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: message };
    }
  }
}
