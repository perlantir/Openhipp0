import { describe, expect, it } from 'vitest';
import {
  createAnthropicBatchProvider,
  type AnthropicBatchClient,
  type AnthropicBatchIndividualResponse,
  type AnthropicMessageBatch,
} from '../../src/llm/batch-anthropic.js';

function fakeClient(overrides: {
  createResult?: AnthropicMessageBatch;
  statusAfterCreate?: AnthropicMessageBatch['processing_status'][];
  resultsForId?: Record<string, AnthropicBatchIndividualResponse[]>;
  onCreate?: (req: unknown) => void;
} = {}): AnthropicBatchClient & { createCalls: unknown[]; cancelCalls: string[] } {
  const createCalls: unknown[] = [];
  const cancelCalls: string[] = [];
  const statusQueue = overrides.statusAfterCreate ? [...overrides.statusAfterCreate] : ['ended' as const];
  return {
    createCalls,
    cancelCalls,
    async create(params) {
      createCalls.push(params);
      overrides.onCreate?.(params);
      return overrides.createResult ?? { id: 'batch-1', processing_status: 'in_progress' };
    },
    async retrieve(id) {
      return { id, processing_status: statusQueue.shift() ?? 'ended' };
    },
    async results(id) {
      const records = overrides.resultsForId?.[id] ?? [];
      return (async function* () {
        for (const r of records) yield r;
      })();
    },
    async cancel(id) {
      cancelCalls.push(id);
      return { id, processing_status: 'canceling' };
    },
  };
}

describe('createAnthropicBatchProvider.submit', () => {
  it('maps requests → Anthropic BatchCreateParams.Request and returns a handle', async () => {
    const client = fakeClient({
      createResult: { id: 'batch-42', processing_status: 'in_progress' },
    });
    const provider = createAnthropicBatchProvider({ client, defaultModel: 'claude-haiku-4-5' });
    const handle = await provider.submit([
      {
        id: 'r1',
        messages: [{ role: 'user', content: 'hi' }],
        options: { temperature: 0.2, system: 'be terse' },
      },
    ]);
    expect(handle.batchId).toBe('batch-42');
    expect(client.createCalls).toHaveLength(1);
    const body = client.createCalls[0] as { requests: Array<{ custom_id: string; params: { model: string; system?: string; temperature?: number } }> };
    expect(body.requests[0]?.custom_id).toBe('r1');
    expect(body.requests[0]?.params.model).toBe('claude-haiku-4-5');
    expect(body.requests[0]?.params.system).toBe('be terse');
    expect(body.requests[0]?.params.temperature).toBe(0.2);
  });

  it('applies defaultMaxTokens when request does not supply it', async () => {
    const client = fakeClient();
    const provider = createAnthropicBatchProvider({
      client,
      defaultModel: 'claude-haiku-4-5',
      defaultMaxTokens: 2048,
    });
    await provider.submit([{ id: 'r1', messages: [{ role: 'user', content: 'hi' }] }]);
    const body = client.createCalls[0] as { requests: Array<{ params: { max_tokens: number } }> };
    expect(body.requests[0]?.params.max_tokens).toBe(2048);
  });
});

describe('BatchHandle.status', () => {
  it('maps in_progress → in_progress', async () => {
    const client = fakeClient({ statusAfterCreate: ['in_progress'] });
    const provider = createAnthropicBatchProvider({ client, defaultModel: 'm' });
    const handle = await provider.submit([{ id: 'r1', messages: [] }]);
    expect(await handle.status()).toBe('in_progress');
  });

  it('maps ended → completed', async () => {
    const client = fakeClient({ statusAfterCreate: ['ended'] });
    const provider = createAnthropicBatchProvider({ client, defaultModel: 'm' });
    const handle = await provider.submit([{ id: 'r1', messages: [] }]);
    expect(await handle.status()).toBe('completed');
  });

  it('maps canceling → canceling', async () => {
    const client = fakeClient({ statusAfterCreate: ['canceling'] });
    const provider = createAnthropicBatchProvider({ client, defaultModel: 'm' });
    const handle = await provider.submit([{ id: 'r1', messages: [] }]);
    expect(await handle.status()).toBe('canceling');
  });
});

describe('BatchHandle.results', () => {
  it('returns empty array while the batch is still in progress', async () => {
    const client = fakeClient({ statusAfterCreate: ['in_progress'] });
    const provider = createAnthropicBatchProvider({ client, defaultModel: 'm' });
    const handle = await provider.submit([{ id: 'r1', messages: [] }]);
    expect(await handle.results()).toEqual([]);
  });

  it('maps a succeeded result → LLMResponse', async () => {
    const client = fakeClient({
      createResult: { id: 'b1', processing_status: 'ended' },
      statusAfterCreate: ['ended'],
      resultsForId: {
        b1: [
          {
            custom_id: 'r1',
            result: {
              type: 'succeeded',
              message: {
                content: [{ type: 'text', text: 'hi back' }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 10, output_tokens: 20 },
                model: 'claude-haiku-4-5',
              },
            },
          },
        ],
      },
    });
    const provider = createAnthropicBatchProvider({ client, defaultModel: 'm' });
    const handle = await provider.submit([{ id: 'r1', messages: [] }]);
    const results = await handle.results();
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('r1');
    expect(results[0]?.response?.usage.inputTokens).toBe(10);
    expect(results[0]?.response?.provider).toBe('anthropic');
  });

  it('maps errored / canceled / expired results to BatchResult.error', async () => {
    const client = fakeClient({
      createResult: { id: 'b2', processing_status: 'ended' },
      statusAfterCreate: ['ended'],
      resultsForId: {
        b2: [
          {
            custom_id: 'r1',
            result: { type: 'errored', error: { type: 'overloaded', message: 'try later' } },
          },
          { custom_id: 'r2', result: { type: 'canceled' } },
          { custom_id: 'r3', result: { type: 'expired' } },
        ],
      },
    });
    const provider = createAnthropicBatchProvider({ client, defaultModel: 'm' });
    const handle = await provider.submit([
      { id: 'r1', messages: [] },
      { id: 'r2', messages: [] },
      { id: 'r3', messages: [] },
    ]);
    const results = await handle.results();
    expect(results[0]?.error).toContain('overloaded');
    expect(results[1]?.error).toBe('canceled');
    expect(results[2]?.error).toBe('expired');
  });
});

describe('BatchHandle.cancel', () => {
  it('invokes the underlying client.cancel', async () => {
    const client = fakeClient();
    const provider = createAnthropicBatchProvider({ client, defaultModel: 'm' });
    const handle = await provider.submit([{ id: 'r1', messages: [] }]);
    await handle.cancel();
    expect(client.cancelCalls).toEqual([handle.batchId]);
  });
});
