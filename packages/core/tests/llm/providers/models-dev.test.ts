import { describe, expect, it } from 'vitest';

import { ModelsDevClient } from '../../../src/llm/providers/models-dev.js';

function mockFetch(body: unknown): typeof globalThis.fetch {
  return (async () => new Response(JSON.stringify(body))) as unknown as typeof globalThis.fetch;
}

describe('ModelsDevClient', () => {
  const sample = {
    anthropic: {
      models: {
        'claude-sonnet-4.6': {
          limit: { context: 1_000_000, output: 65_536 },
          cost: { input: 3, output: 15 },
          modalities: { input: ['text', 'image'] },
          tool_call: true,
        },
      },
    },
    openai: {
      models: {
        'gpt-4o-mini': {
          limit: { context: 128_000 },
          cost: { input: 0.15, output: 0.6 },
          tool_call: true,
        },
      },
    },
  };

  it('lists models flattened with capability metadata', async () => {
    const client = new ModelsDevClient({ fetchImpl: mockFetch(sample) });
    const all = await client.listAll();
    expect(all).toHaveLength(2);
    expect(all.find((m) => m.id === 'claude-sonnet-4.6')?.vision).toBe(true);
    expect(all.find((m) => m.id === 'gpt-4o-mini')?.tools).toBe(true);
  });

  it('recommends cheapest model meeting constraints', async () => {
    const client = new ModelsDevClient({ fetchImpl: mockFetch(sample) });
    const rec = await client.recommendForTask({ task: 'tool' });
    expect(rec[0]!.id).toBe('gpt-4o-mini'); // cheaper input+output sum
  });

  it('caches results within TTL', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify(sample));
    }) as unknown as typeof globalThis.fetch;
    const client = new ModelsDevClient({ fetchImpl, cacheTtlMs: 10_000 });
    await client.listAll();
    await client.listAll();
    expect(calls).toBe(1);
  });
});
