import Anthropic from '@anthropic-ai/sdk';
import type { Tool, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages/messages.js';
import { zodToJsonSchema } from 'openai/_vendor/zod-to-json-schema/zodToJsonSchema.mjs';
import type { AgentConfig } from '../config/schema.js';
import { ProviderError } from '../utils/errors.js';
import type { LLMProvider, LLMCallParams } from './provider.js';

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  readonly name = 'anthropic' as const;
  readonly model: string;

  constructor(private config: AgentConfig) {
    this.model = config.model;
    this.client = new Anthropic({
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
      `Anthropic call failed after retry: ${secondAttempt.reason}`
    );
  }

  private async attempt<T>(
    params: LLMCallParams<T>
  ): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
    try {
      const jsonSchema = zodToJsonSchema(params.outputSchema, {
        $refStrategy: 'none',
      });

      const tool: Tool = {
        name: 'submit_output',
        description: 'Submit structured analysis output',
        input_schema: jsonSchema as Tool.InputSchema,
      };

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: params.maxTokens ?? 8192,
        temperature: params.temperature ?? 0.2,
        messages: [
          {
            role: 'user',
            content: `${params.systemPrompt}\n\n${params.userContent}`,
          },
        ],
        tools: [tool],
        tool_choice: { type: 'tool', name: 'submit_output' },
      });

      const toolUseBlock = response.content.find(
        (block): block is ToolUseBlock => block.type === 'tool_use'
      );

      if (!toolUseBlock) {
        return { ok: false, reason: 'No tool use in Anthropic response' };
      }

      const parsed = params.outputSchema.safeParse(toolUseBlock.input);
      if (!parsed.success) {
        const errors = parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        return { ok: false, reason: `Zod validation failed: ${errors}` };
      }

      return { ok: true, value: parsed.data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: message };
    }
  }
}
