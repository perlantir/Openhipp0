import { describe, expect, it, vi } from 'vitest';
import { Hipp0LLMError, OllamaProvider, type FetchFn } from '../../src/llm/index.js';

function mockFetch(response: { status?: number; body: unknown }): FetchFn {
  const status = response.status ?? 200;
  const fn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    return new Response(
      typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
      {
        status,
        headers: { 'content-type': 'application/json' },
      },
    );
  });
  return fn as unknown as FetchFn;
}

describe('OllamaProvider', () => {
  it('maps a text-only response', async () => {
    const fetchFn = mockFetch({
      body: {
        model: 'llama3',
        message: { role: 'assistant', content: 'Hello world' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 10,
        eval_count: 5,
      },
    });

    const provider = new OllamaProvider({ model: 'llama3', fetchFn });
    const resp = await provider.chatSync([{ role: 'user', content: 'Hi' }]);

    expect(resp.provider).toBe('ollama');
    expect(resp.model).toBe('llama3');
    expect(resp.content).toEqual([{ type: 'text', text: 'Hello world' }]);
    expect(resp.stopReason).toBe('end_turn');
    expect(resp.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('maps tool_calls into tool_use blocks', async () => {
    const fetchFn = mockFetch({
      body: {
        model: 'llama3',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'shell_execute', arguments: { cmd: 'ls' } } }],
        },
        done: true,
        done_reason: 'stop',
      },
    });

    const provider = new OllamaProvider({ model: 'llama3', fetchFn });
    const resp = await provider.chatSync([{ role: 'user', content: 'list files' }]);

    const toolUse = resp.content.find((b) => b.type === 'tool_use');
    expect(toolUse).toBeDefined();
    if (toolUse?.type === 'tool_use') {
      expect(toolUse.name).toBe('shell_execute');
      expect(toolUse.input).toEqual({ cmd: 'ls' });
    }
  });

  it('throws retryable Hipp0LLMError on HTTP 5xx', async () => {
    const fetchFn = mockFetch({ status: 503, body: { error: 'overloaded' } });
    const provider = new OllamaProvider({ model: 'llama3', fetchFn });

    await expect(provider.chatSync([{ role: 'user', content: 'x' }])).rejects.toSatisfy(
      (err) => err instanceof Hipp0LLMError && err.retryable && err.httpStatus === 503,
    );
  });

  it('throws non-retryable Hipp0LLMError on HTTP 404', async () => {
    const fetchFn = mockFetch({ status: 404, body: { error: 'model not found' } });
    const provider = new OllamaProvider({ model: 'missing-model', fetchFn });

    await expect(provider.chatSync([{ role: 'user', content: 'x' }])).rejects.toSatisfy(
      (err) => err instanceof Hipp0LLMError && !err.retryable && err.httpStatus === 404,
    );
  });

  it('wraps fetch network errors as retryable', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as FetchFn;
    const provider = new OllamaProvider({ model: 'llama3', fetchFn });

    await expect(provider.chatSync([{ role: 'user', content: 'x' }])).rejects.toSatisfy(
      (err) => err instanceof Hipp0LLMError && err.retryable,
    );
  });

  it('sends messages with system override when provided', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string }> };
      expect(body.messages[0]!.role).toBe('system');
      return new Response(
        JSON.stringify({
          model: 'llama3',
          message: { role: 'assistant', content: 'ok' },
          done: true,
          done_reason: 'stop',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as FetchFn;

    const provider = new OllamaProvider({ model: 'llama3', fetchFn });
    await provider.chatSync([{ role: 'user', content: 'hi' }], { system: 'You are helpful.' });
  });

  it('countTokens is the 4-chars-per-token heuristic', () => {
    const provider = new OllamaProvider({ model: 'llama3', fetchFn: mockFetch({ body: {} }) });
    expect(provider.countTokens('abcd')).toBe(1);
    expect(provider.countTokens('abcdefgh')).toBe(2);
    expect(provider.countTokens('abc')).toBe(1);
    expect(provider.countTokens('')).toBe(0);
  });

  it('chat() yields derived chunks and returns LLMResponse', async () => {
    const fetchFn = mockFetch({
      body: {
        model: 'llama3',
        message: { role: 'assistant', content: 'Hello' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 3,
        eval_count: 2,
      },
    });
    const provider = new OllamaProvider({ model: 'llama3', fetchFn });

    const gen = provider.chat([{ role: 'user', content: 'hi' }]);
    const chunks = [];
    let result = await gen.next();
    while (!result.done) {
      chunks.push(result.value);
      result = await gen.next();
    }
    const final = result.value;
    expect(chunks).toContainEqual({ type: 'text_delta', delta: 'Hello' });
    expect(chunks[chunks.length - 1]!.type).toBe('message_stop');
    expect(final.content).toEqual([{ type: 'text', text: 'Hello' }]);
  });
});
