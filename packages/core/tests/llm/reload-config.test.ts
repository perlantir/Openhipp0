import { describe, expect, it } from 'vitest';
import { LLMClient } from '../../src/llm/client.js';
import type {
  LLMProvider,
  LLMResponse,
  Message,
  ProviderConfig,
  StreamChunk,
} from '../../src/llm/types.js';

function fakeProvider(name: string, model: string): LLMProvider {
  return {
    name,
    model,
    async chatSync(): Promise<LLMResponse> {
      return {
        content: [{ type: 'text', text: `hello from ${name}/${model}` }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
        model,
        provider: name,
      };
    },
    async *chat(): AsyncGenerator<StreamChunk, LLMResponse> {
      const r = await this.chatSync([] as Message[], {});
      yield { type: 'message_stop', stopReason: r.stopReason, usage: r.usage };
      return r;
    },
    countTokens: (t) => t.length,
  };
}

describe('LLMClient.reloadConfig', () => {
  it('replaces the provider ladder atomically', async () => {
    const client = new LLMClient(
      {
        providers: [{ type: 'anthropic', model: 'old-model' }],
        retry: { maxAttempts: 1, baseDelayMs: 1 },
      },
      {},
      (p) => fakeProvider(p.type, p.model),
    );
    const r1 = await client.chatSync([{ role: 'user', content: 'hi' }]);
    expect(r1.model).toBe('old-model');
    client.reloadConfig([{ type: 'anthropic', model: 'new-model' }]);
    const r2 = await client.chatSync([{ role: 'user', content: 'hi' }]);
    expect(r2.model).toBe('new-model');
    // Ladder snapshot reflects the swap.
    expect(client.getProviderConfigs()[0]?.model).toBe('new-model');
  });

  it('rejects empty ladder on reload', () => {
    const client = new LLMClient(
      {
        providers: [{ type: 'anthropic', model: 'x' }],
        retry: { maxAttempts: 1, baseDelayMs: 1 },
      },
      {},
      (p) => fakeProvider(p.type, p.model),
    );
    expect(() => client.reloadConfig([])).toThrow(/at least one provider/);
  });

  it('pingNewLadder returns ok on a provider that responds', async () => {
    const client = new LLMClient(
      {
        providers: [{ type: 'anthropic', model: 'x' }],
        retry: { maxAttempts: 1, baseDelayMs: 1 },
      },
      {},
      (p) => fakeProvider(p.type, p.model),
    );
    const r = await client.pingNewLadder([{ type: 'anthropic', model: 'new' }]);
    expect(r.ok).toBe(true);
  });

  it('pingNewLadder surfaces provider errors', async () => {
    const client = new LLMClient(
      {
        providers: [{ type: 'anthropic', model: 'x' }],
        retry: { maxAttempts: 1, baseDelayMs: 1 },
      },
      {},
      (p) => {
        if (p.model === 'broken') {
          return {
            ...fakeProvider(p.type, p.model),
            chatSync: async () => {
              throw new Error('api down');
            },
          };
        }
        return fakeProvider(p.type, p.model);
      },
    );
    const r = await client.pingNewLadder([{ type: 'anthropic', model: 'broken' }]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('api down');
  });

  it('pingNewLadder rejects empty ladder', async () => {
    const client = new LLMClient(
      {
        providers: [{ type: 'anthropic', model: 'x' }],
        retry: { maxAttempts: 1, baseDelayMs: 1 },
      },
      {},
      (p) => fakeProvider(p.type, p.model),
    );
    const r = await client.pingNewLadder([] as readonly ProviderConfig[]);
    expect(r.ok).toBe(false);
  });
});
