import { describe, expect, it } from 'vitest';

import { GeminiProvider } from '../../../src/llm/providers/gemini.js';

function mockFetch(body: unknown, status = 200): typeof globalThis.fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof globalThis.fetch;
}

describe('GeminiProvider', () => {
  it('roundtrips a text-only response', async () => {
    const provider = new GeminiProvider({
      model: 'gemini-2.5-flash',
      apiKey: 'abc',
      fetchImpl: mockFetch({
        candidates: [{ content: { parts: [{ text: 'hello' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }),
    });
    const resp = await provider.chatSync([{ role: 'user', content: 'hi' }]);
    expect(resp.content).toEqual([{ type: 'text', text: 'hello' }]);
    expect(resp.stopReason).toBe('end_turn');
    expect(resp.usage?.inputTokens).toBe(10);
    expect(resp.provider).toBe('gemini');
  });

  it('surfaces tool calls from functionCall parts', async () => {
    const provider = new GeminiProvider({
      model: 'gemini-2.5-pro',
      apiKey: 'abc',
      fetchImpl: mockFetch({
        candidates: [
          {
            content: {
              parts: [
                { text: 'calling tool' },
                { functionCall: { name: 'search', args: { q: 'x' } } },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      }),
    });
    const resp = await provider.chatSync([{ role: 'user', content: 'search' }]);
    const toolUse = resp.content.find((b) => b.type === 'tool_use');
    expect(toolUse).toBeTruthy();
  });

  it('throws a retryable error on 429', async () => {
    const provider = new GeminiProvider({
      model: 'x',
      apiKey: 'abc',
      fetchImpl: mockFetch({ error: 'rate limit' }, 429),
    });
    await expect(provider.chatSync([{ role: 'user', content: 'x' }])).rejects.toMatchObject({
      retryable: true,
      httpStatus: 429,
    });
  });
});
