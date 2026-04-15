/**
 * OpenAI provider — implements LLMProvider over the `openai` SDK.
 *
 * Streaming note: chat() wraps chatSync() and yields derived chunks. True
 * streaming via chat.completions.create({stream:true}) is a Phase 2 iteration;
 * the AsyncGenerator contract is honored so callers can migrate later.
 */

import OpenAI from 'openai';
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

export interface OpenAIProviderOptions {
  model: string;
  /** Falls back to OPENAI_API_KEY env var. */
  apiKey?: string;
  baseUrl?: string;
  /** Injected client for tests. */
  client?: OpenAI;
}

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  readonly model: string;
  private readonly client: OpenAI;

  constructor(opts: OpenAIProviderOptions) {
    this.model = opts.model;
    this.client =
      opts.client ??
      new OpenAI({
        apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY,
        baseURL: opts.baseUrl,
      });
  }

  async chatSync(messages: Message[], options: LLMOptions = {}): Promise<LLMResponse> {
    const mapped = mapMessages(messages, options.system);
    try {
      const resp = await this.client.chat.completions.create({
        model: this.model,
        messages: mapped,
        ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.topP !== undefined && { top_p: options.topP }),
        ...(options.stopSequences && { stop: options.stopSequences }),
        ...(options.tools && { tools: options.tools.map(toOpenAITool) }),
        ...(options.toolChoice && { tool_choice: mapToolChoice(options.toolChoice) }),
      });

      const choice = resp.choices[0];
      if (!choice) {
        throw new Hipp0LLMError('OpenAI returned no choices', this.name, 500, false);
      }
      const msg = choice.message;
      const content: ContentBlock[] = [];
      if (msg.content) content.push({ type: 'text', text: msg.content });
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.type !== 'function') continue;
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            // Leave as empty on malformed JSON — the agent loop will handle it.
          }
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
      }

      return {
        content,
        stopReason: mapFinishReason(choice.finish_reason),
        usage: {
          inputTokens: resp.usage?.prompt_tokens ?? 0,
          outputTokens: resp.usage?.completion_tokens ?? 0,
        },
        model: resp.model,
        provider: this.name,
      };
    } catch (err) {
      if (err instanceof Hipp0LLMError) throw err;
      throw mapOpenAIError(err, this.name);
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
    // Rough heuristic: ~4 chars per token. Exact counts need tiktoken.
    return Math.ceil(text.length / 4);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping
// ─────────────────────────────────────────────────────────────────────────────

type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function mapMessages(messages: Message[], systemOverride?: string): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  if (systemOverride) out.push({ role: 'system', content: systemOverride });

  for (const m of messages) {
    if (m.role === 'system') {
      if (!systemOverride) out.push({ role: 'system', content: stringifyContent(m.content) });
      continue;
    }
    if (m.role === 'tool') {
      // Each tool_result block becomes its own role:"tool" message in OpenAI format.
      const blocks = Array.isArray(m.content) ? m.content : [];
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          out.push({
            role: 'tool',
            tool_call_id: b.toolUseId,
            content: b.content,
          });
        }
      }
      continue;
    }
    if (m.role === 'user') {
      out.push({ role: 'user', content: stringifyContent(m.content) });
      continue;
    }
    // assistant
    if (typeof m.content === 'string') {
      out.push({ role: 'assistant', content: m.content });
      continue;
    }
    // Split blocks: text → content; tool_use → tool_calls
    const textBits: string[] = [];
    const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
    for (const b of m.content) {
      if (b.type === 'text') textBits.push(b.text);
      else if (b.type === 'tool_use') {
        toolCalls.push({
          id: b.id,
          type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        });
      }
    }
    const asst: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
      role: 'assistant',
      content: textBits.join('') || null,
    };
    if (toolCalls.length > 0) asst.tool_calls = toolCalls;
    out.push(asst);
  }
  return out;
}

function stringifyContent(c: string | ContentBlock[]): string {
  if (typeof c === 'string') return c;
  return c
    .map((b) => (b.type === 'text' ? b.text : `[${b.type}: ${JSON.stringify(b)}]`))
    .join('\n');
}

function toOpenAITool(t: ToolDef): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  };
}

function mapToolChoice(
  tc: NonNullable<LLMOptions['toolChoice']>,
): OpenAI.Chat.Completions.ChatCompletionToolChoiceOption {
  if (tc === 'auto') return 'auto';
  if (tc === 'any') return 'required';
  if (tc === 'none') return 'none';
  return { type: 'function', function: { name: tc.name } };
}

function mapFinishReason(fr: string | null | undefined): StopReason {
  switch (fr) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
      return 'tool_use';
    case 'content_filter':
      return 'stop_sequence';
    default:
      return 'other';
  }
}

function mapOpenAIError(err: unknown, provider: string): Hipp0LLMError {
  if (err instanceof OpenAI.APIError) {
    const status = typeof err.status === 'number' ? err.status : undefined;
    const retryable =
      status === 408 ||
      status === 429 ||
      (typeof status === 'number' && status >= 500 && status < 600);
    return new Hipp0LLMError(err.message, provider, status, retryable);
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new Hipp0LLMError(msg, provider, undefined, false);
}
