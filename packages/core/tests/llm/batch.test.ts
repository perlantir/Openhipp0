import { describe, expect, it } from 'vitest';
import { createInMemoryBatchProvider } from '../../src/llm/batch.js';
import type { LLMResponse } from '../../src/llm/types.js';

const respFor = (text: string): LLMResponse => ({
  content: [{ type: 'text', text }],
  stopReason: 'end_turn',
  usage: { inputTokens: 1, outputTokens: 1 },
  model: 'fake',
  provider: 'fake',
});

describe('createInMemoryBatchProvider', () => {
  it('submits, reports completed, returns per-request responses', async () => {
    const provider = createInMemoryBatchProvider(async (req) =>
      respFor(`echo:${req.id}`),
    );
    const handle = await provider.submit([
      { id: 'r1', messages: [{ role: 'user', content: 'hi' }] },
      { id: 'r2', messages: [{ role: 'user', content: 'bye' }] },
    ]);
    expect(await handle.status()).toBe('completed');
    const results = await handle.results();
    expect(results.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect((results[0]?.response?.content[0] as { text: string }).text).toBe('echo:r1');
  });

  it('captures errors per-request', async () => {
    const provider = createInMemoryBatchProvider(async (req) => {
      if (req.id === 'fail') throw new Error('bad');
      return respFor('ok');
    });
    const handle = await provider.submit([
      { id: 'ok', messages: [] },
      { id: 'fail', messages: [] },
    ]);
    const results = await handle.results();
    expect(results[0]?.error).toBeUndefined();
    expect(results[1]?.error).toBe('bad');
  });

  it('cancel is a no-op after completion', async () => {
    const provider = createInMemoryBatchProvider(async () => respFor('ok'));
    const handle = await provider.submit([]);
    await expect(handle.cancel()).resolves.toBeUndefined();
  });
});
