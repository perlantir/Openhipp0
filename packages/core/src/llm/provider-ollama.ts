/**
 * Ollama provider — implements LLMProvider over the local Ollama HTTP API.
 *
 * Default baseUrl: http://localhost:11434. No SDK needed; raw fetch.
 * Ollama's /api/chat format:
 *   request: { model, messages: [{role, content}], stream, tools?, options? }
 *   response (non-streaming): { model, message: {role, content, tool_calls?}, done, prompt_eval_count?, eval_count? }
 *
 * Tool use support depends on the underlying model; not all Ollama models
 * handle tools well. Tests cover the happy path with mocked fetch.
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
  type ToolDef,
} from './types.js';

export type FetchFn = typeof fetch;

export interface OllamaProviderOptions {
  model: string;
  /** Default: http://localhost:11434 */
  baseUrl?: string;
  /** Injected fetch for tests. */
  fetchFn?: FetchFn;
}

interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

interface OllamaChatResponse {
  model: string;
  message: {
    role: 'assistant';
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn;

  constructor(opts: OllamaProviderOptions) {
    this.model = opts.model;
    this.baseUrl = opts.baseUrl ?? 'http://localhost:11434';
    this.fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  async chatSync(messages: Message[], options: LLMOptions = {}): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      stream: false,
      messages: mapMessages(messages, options.system),
    };

    const modelOpts: Record<string, unknown> = {};
    if (options.temperature !== undefined) modelOpts.temperature = options.temperature;
    if (options.topP !== undefined) modelOpts.top_p = options.topP;
    if (options.maxTokens !== undefined) modelOpts.num_predict = options.maxTokens;
    if (options.stopSequences) modelOpts.stop = options.stopSequences;
    if (Object.keys(modelOpts).length > 0) body.options = modelOpts;

    if (options.tools) body.tools = options.tools.map(toOllamaTool);

    let resp: Response;
    try {
      resp = await this.fetchFn(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        ...(options.signal && { signal: options.signal }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Network-level failure — retryable.
      throw new Hipp0LLMError(msg, this.name, undefined, true);
    }

    if (!resp.ok) {
      const text = await safeText(resp);
      const retryable = resp.status === 408 || resp.status === 429 || resp.status >= 500;
      throw new Hipp0LLMError(
        `Ollama HTTP ${resp.status}: ${text.slice(0, 200)}`,
        this.name,
        resp.status,
        retryable,
      );
    }

    const data = (await resp.json()) as OllamaChatResponse;
    const content: ContentBlock[] = [];
    if (data.message.content) content.push({ type: 'text', text: data.message.content });
    if (data.message.tool_calls) {
      for (const tc of data.message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: `ollama_tc_${Math.random().toString(36).slice(2, 10)}`,
          name: tc.function.name,
          input: tc.function.arguments,
        });
      }
    }

    return {
      content,
      stopReason: mapDoneReason(data.done_reason),
      usage: {
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
      },
      model: data.model,
      provider: this.name,
    };
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
    return Math.ceil(text.length / 4);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping
// ─────────────────────────────────────────────────────────────────────────────

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

function mapMessages(messages: Message[], systemOverride?: string): OllamaMessage[] {
  const out: OllamaMessage[] = [];
  if (systemOverride) out.push({ role: 'system', content: systemOverride });

  for (const m of messages) {
    if (m.role === 'system') {
      if (!systemOverride) out.push({ role: 'system', content: stringifyContent(m.content) });
      continue;
    }
    if (m.role === 'tool') {
      const blocks = Array.isArray(m.content) ? m.content : [];
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          out.push({ role: 'tool', content: b.content, tool_name: b.toolUseId });
        }
      }
      continue;
    }
    if (m.role === 'user') {
      out.push({ role: 'user', content: stringifyContent(m.content) });
      continue;
    }
    // assistant — flatten to a text message; collect any tool_use blocks
    if (typeof m.content === 'string') {
      out.push({ role: 'assistant', content: m.content });
      continue;
    }
    const text = m.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');
    const tcs = m.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => {
        const tu = b as { id: string; name: string; input: Record<string, unknown> };
        return { function: { name: tu.name, arguments: tu.input } };
      });
    const msg: OllamaMessage = { role: 'assistant', content: text };
    if (tcs.length > 0) msg.tool_calls = tcs;
    out.push(msg);
  }
  return out;
}

function stringifyContent(c: string | ContentBlock[]): string {
  if (typeof c === 'string') return c;
  return c
    .map((b) => (b.type === 'text' ? b.text : `[${b.type}: ${JSON.stringify(b)}]`))
    .join('\n');
}

function toOllamaTool(t: ToolDef): {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
} {
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  };
}

function mapDoneReason(reason: string | undefined): StopReason {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    default:
      return reason ? 'other' : 'end_turn';
  }
}

async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return '';
  }
}
