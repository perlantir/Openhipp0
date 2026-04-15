/**
 * Anthropic provider — implements LLMProvider over @anthropic-ai/sdk.
 *
 * Streaming note: chat() wraps chatSync() and yields derived chunks. True
 * incremental streaming (via messages.stream) is an iteration target for
 * Phase 2; the AsyncGenerator contract is honored so callers can migrate
 * without changing shape.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  Hipp0LLMError,
  type ContentBlock,
  type LLMOptions,
  type LLMProvider,
  type LLMResponse,
  type Message,
  type StopReason,
  type StreamChunk,
  type ToolDef,
} from './types.js';

export interface AnthropicProviderOptions {
  model: string;
  /** Falls back to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  baseUrl?: string;
  /** Injected client for tests. */
  client?: Anthropic;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;

  constructor(opts: AnthropicProviderOptions) {
    this.model = opts.model;
    this.client =
      opts.client ??
      new Anthropic({
        apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY,
        baseURL: opts.baseUrl,
      });
  }

  async chatSync(messages: Message[], options: LLMOptions = {}): Promise<LLMResponse> {
    const { system, mapped } = splitSystemAndMap(messages);
    try {
      const resp = await this.client.messages.create({
        model: this.model,
        max_tokens: options.maxTokens ?? 4096,
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.topP !== undefined && { top_p: options.topP }),
        ...(options.stopSequences && { stop_sequences: options.stopSequences }),
        ...((options.system ?? system) ? { system: options.system ?? system } : {}),
        ...(options.tools && { tools: options.tools.map(toAnthropicTool) }),
        ...(options.toolChoice && { tool_choice: mapToolChoice(options.toolChoice) }),
        messages: mapped,
      });

      return {
        content: resp.content.map(fromAnthropicBlock),
        stopReason: mapStopReason(resp.stop_reason),
        usage: {
          inputTokens: resp.usage.input_tokens,
          outputTokens: resp.usage.output_tokens,
        },
        model: resp.model,
        provider: this.name,
      };
    } catch (err) {
      throw mapAnthropicError(err, this.name);
    }
  }

  async *chat(
    messages: Message[],
    options: LLMOptions = {},
  ): AsyncGenerator<StreamChunk, LLMResponse> {
    const resp = await this.chatSync(messages, options);
    for (const block of resp.content) {
      if (block.type === 'text') {
        yield { type: 'text_delta', delta: block.text };
      } else if (block.type === 'tool_use') {
        yield { type: 'tool_use_start', id: block.id, name: block.name };
        yield { type: 'tool_use_delta', id: block.id, inputDelta: JSON.stringify(block.input) };
      }
    }
    yield { type: 'message_stop', stopReason: resp.stopReason, usage: resp.usage };
    return resp;
  }

  countTokens(text: string): number {
    // Rough heuristic: ~4 chars per token for English. For exact counts use
    // anthropic.messages.countTokens({...}) — async, not wired here.
    return Math.ceil(text.length / 4);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping helpers
// ─────────────────────────────────────────────────────────────────────────────

interface MappedMessages {
  system: string | undefined;
  mapped: Anthropic.MessageParam[];
}

function splitSystemAndMap(messages: Message[]): MappedMessages {
  let system: string | undefined;
  const mapped: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system = typeof m.content === 'string' ? m.content : stringifyBlocks(m.content);
      continue;
    }
    if (m.role === 'tool') {
      // Tool results are modeled as a user-role message with tool_result blocks.
      mapped.push({
        role: 'user',
        content: Array.isArray(m.content) ? m.content.map(toAnthropicBlock) : [],
      });
      continue;
    }
    mapped.push({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content.map(toAnthropicBlock),
    } as Anthropic.MessageParam);
  }
  return { system, mapped };
}

function stringifyBlocks(blocks: ContentBlock[]): string {
  return blocks.map((b) => (b.type === 'text' ? b.text : JSON.stringify(b))).join('\n');
}

function toAnthropicBlock(b: ContentBlock): Anthropic.ContentBlockParam {
  if (b.type === 'text') return { type: 'text', text: b.text };
  if (b.type === 'tool_use') {
    return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
  }
  return {
    type: 'tool_result',
    tool_use_id: b.toolUseId,
    content: b.content,
    ...(b.isError && { is_error: true }),
  };
}

function fromAnthropicBlock(b: Anthropic.ContentBlock): ContentBlock {
  if (b.type === 'text') return { type: 'text', text: b.text };
  if (b.type === 'tool_use') {
    return {
      type: 'tool_use',
      id: b.id,
      name: b.name,
      input: (b.input ?? {}) as Record<string, unknown>,
    };
  }
  // Thinking / other block types — flatten to text.
  return { type: 'text', text: JSON.stringify(b) };
}

function toAnthropicTool(t: ToolDef): Anthropic.Tool {
  return {
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  };
}

function mapToolChoice(tc: NonNullable<LLMOptions['toolChoice']>): Anthropic.ToolChoice {
  if (tc === 'auto') return { type: 'auto' };
  if (tc === 'any') return { type: 'any' };
  if (tc === 'none') return { type: 'auto', disable_parallel_tool_use: true };
  return { type: 'tool', name: tc.name };
}

function mapStopReason(sr: string | null): StopReason {
  switch (sr) {
    case 'end_turn':
      return 'end_turn';
    case 'max_tokens':
      return 'max_tokens';
    case 'tool_use':
      return 'tool_use';
    case 'stop_sequence':
      return 'stop_sequence';
    default:
      return 'other';
  }
}

function mapAnthropicError(err: unknown, provider: string): Hipp0LLMError {
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    const retryable = status === 408 || status === 429 || (status >= 500 && status < 600);
    return new Hipp0LLMError(err.message, provider, status, retryable);
  }
  // Unknown — wrap as non-retryable to be safe.
  const msg = err instanceof Error ? err.message : String(err);
  return new Hipp0LLMError(msg, provider, undefined, false);
}
