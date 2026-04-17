/**
 * Google Gemini direct-API provider. Minimal fetch-based — no SDK dep.
 * Covers Gemini 2.5 Pro / Flash / Flash-Lite. Vision + tools supported.
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

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiProviderOptions {
  readonly model: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof globalThis.fetch;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<
    | { text: string }
    | { functionCall: { name: string; args: Record<string, unknown> } }
    | { functionResponse: { name: string; response: Record<string, unknown> } }
  >;
}

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  readonly model: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(opts: GeminiProviderOptions) {
    this.model = opts.model;
    this.#apiKey = opts.apiKey ?? process.env['GOOGLE_API_KEY'] ?? process.env['GEMINI_API_KEY'] ?? '';
    this.#baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.#fetch = opts.fetchImpl ?? globalThis.fetch;
  }

  async chatSync(messages: Message[], options: LLMOptions = {}): Promise<LLMResponse> {
    if (!this.#apiKey) throw new Hipp0LLMError('missing GEMINI_API_KEY', this.name, 401, false);
    const body: Record<string, unknown> = {
      contents: mapMessages(messages, options.system),
      ...(options.maxTokens !== undefined
        ? { generationConfig: { maxOutputTokens: options.maxTokens, ...(options.temperature !== undefined ? { temperature: options.temperature } : {}) } }
        : options.temperature !== undefined
          ? { generationConfig: { temperature: options.temperature } }
          : {}),
    };
    if (options.tools?.length) {
      body['tools'] = [
        {
          functionDeclarations: options.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema as Record<string, unknown>,
          })),
        },
      ];
    }
    const url = `${this.#baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.#apiKey)}`;
    const resp = await this.#fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      const retryable = resp.status === 429 || resp.status >= 500;
      throw new Hipp0LLMError(`Gemini ${resp.status}: ${text || resp.statusText}`, this.name, resp.status, retryable);
    }
    const json = (await resp.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> };
        finishReason?: string;
      }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const candidate = json.candidates?.[0];
    if (!candidate) throw new Hipp0LLMError('Gemini returned no candidates', this.name, 500, false);
    const parts = candidate.content?.parts ?? [];
    const content: ContentBlock[] = [];
    for (const part of parts) {
      if (typeof part.text === 'string') content.push({ type: 'text', text: part.text });
      if (part.functionCall) {
        content.push({
          type: 'tool_use',
          id: `gemini-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          name: part.functionCall.name,
          input: part.functionCall.args ?? {},
        });
      }
    }
    const stop = mapStop(candidate.finishReason);
    const usage = {
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    };
    return {
      content,
      stopReason: stop,
      usage,
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

function mapMessages(messages: Message[], system?: string): GeminiContent[] {
  const out: GeminiContent[] = [];
  if (system) out.push({ role: 'user', parts: [{ text: `SYSTEM:\n${system}` }] });
  for (const msg of messages) {
    if (msg.role === 'system') continue; // merged into first user turn
    const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
    const parts: GeminiContent['parts'] = [];
    const blocks = typeof msg.content === 'string' ? [{ type: 'text' as const, text: msg.content }] : msg.content;
    for (const block of blocks) {
      if (block.type === 'text') parts.push({ text: block.text });
      if (block.type === 'tool_use')
        parts.push({ functionCall: { name: block.name, args: block.input } });
      if (block.type === 'tool_result')
        parts.push({
          functionResponse: {
            name: block.toolUseId,
            response: { result: block.content },
          },
        });
    }
    if (parts.length > 0) out.push({ role, parts });
  }
  return out;
}

function mapStop(finishReason: string | undefined): StopReason {
  switch (finishReason) {
    case 'STOP':
      return 'end_turn';
    case 'MAX_TOKENS':
      return 'max_tokens';
    case 'SAFETY':
      return 'stop_sequence';
    default:
      return 'end_turn';
  }
}
