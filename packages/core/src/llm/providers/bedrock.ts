/**
 * AWS Bedrock — targets the Anthropic Messages runtime
 * (`anthropic.claude-*-v2:0`, `anthropic.claude-3-5-sonnet-*`).
 *
 * Structural: caller supplies an `invokeModel` function (AWS SDK v3's
 * `BedrockRuntimeClient.send(InvokeModelCommand)` or a sigv4-capable
 * fetch wrapper). No AWS SDK dep on this package.
 */

import {
  Hipp0LLMError,
  type ContentBlock,
  type LLMOptions,
  type LLMProvider,
  type LLMResponse,
  type Message,
  type StopReason,
  type StreamChunk,
} from '../types.js';

export interface BedrockInvokeInput {
  readonly modelId: string;
  readonly body: string;
  readonly contentType?: string;
  readonly accept?: string;
}

export interface BedrockInvokeResponse {
  readonly statusCode?: number;
  readonly body: string;
}

export type BedrockInvoker = (input: BedrockInvokeInput) => Promise<BedrockInvokeResponse>;

export interface BedrockProviderOptions {
  readonly model: string;
  readonly invoke: BedrockInvoker;
}

export class BedrockProvider implements LLMProvider {
  readonly name = 'bedrock';
  readonly model: string;
  readonly #invoke: BedrockInvoker;

  constructor(opts: BedrockProviderOptions) {
    this.model = opts.model;
    this.#invoke = opts.invoke;
  }

  async chatSync(messages: Message[], options: LLMOptions = {}): Promise<LLMResponse> {
    const anthropicBody: Record<string, unknown> = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: options.maxTokens ?? 4096,
      messages: mapMessages(messages),
      ...(options.system ? { system: options.system } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.topP !== undefined ? { top_p: options.topP } : {}),
      ...(options.stopSequences ? { stop_sequences: options.stopSequences } : {}),
      ...(options.tools
        ? {
            tools: options.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema as Record<string, unknown>,
            })),
          }
        : {}),
    };
    const response = await this.#invoke({
      modelId: this.model,
      body: JSON.stringify(anthropicBody),
      contentType: 'application/json',
      accept: 'application/json',
    });
    if (response.statusCode && response.statusCode >= 400) {
      const retryable = response.statusCode === 429 || response.statusCode >= 500;
      throw new Hipp0LLMError(`Bedrock ${response.statusCode}`, this.name, response.statusCode, retryable);
    }
    const parsed = JSON.parse(response.body) as {
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      >;
      stop_reason: string;
      usage?: { input_tokens: number; output_tokens: number };
    };
    const content: ContentBlock[] = parsed.content.map((b) => {
      if (b.type === 'text') return { type: 'text', text: b.text };
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
    });
    const stop: StopReason =
      parsed.stop_reason === 'end_turn'
        ? 'end_turn'
        : parsed.stop_reason === 'max_tokens'
          ? 'max_tokens'
          : parsed.stop_reason === 'tool_use'
            ? 'tool_use'
            : parsed.stop_reason === 'stop_sequence'
              ? 'stop_sequence'
              : 'other';
    return {
      content,
      stopReason: stop,
      usage: parsed.usage
        ? { inputTokens: parsed.usage.input_tokens, outputTokens: parsed.usage.output_tokens }
        : { inputTokens: 0, outputTokens: 0 },
      model: this.model,
      provider: this.name,
    };
  }

  async *chat(messages: Message[], options: LLMOptions = {}): AsyncGenerator<StreamChunk, LLMResponse> {
    const resp = await this.chatSync(messages, options);
    for (const block of resp.content) {
      if (block.type === 'text') yield { type: 'text_delta', delta: block.text };
      if (block.type === 'tool_use') {
        yield { type: 'tool_use_start', id: block.id, name: block.name };
        yield { type: 'tool_use_delta', id: block.id, inputDelta: JSON.stringify(block.input) };
      }
    }
    yield { type: 'message_stop', stopReason: resp.stopReason, usage: resp.usage };
    return resp;
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

function mapMessages(messages: Message[]): Array<{ role: 'user' | 'assistant'; content: unknown[] }> {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: normalize(m.content),
    }));
}

function normalize(content: Message['content']): unknown[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content.map((b) => {
    if (b.type === 'tool_result') return { type: 'tool_result', tool_use_id: b.toolUseId, content: b.content };
    if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
    return { type: 'text', text: b.text };
  });
}
