import { describe, expect, it, vi } from 'vitest';
import {
  Hipp0AllProvidersFailedError,
  Hipp0BudgetExceededError,
  Hipp0LLMError,
  LLMClient,
  type LLMOptions,
  type LLMProvider,
  type LLMResponse,
  type Message,
  type StreamChunk,
  type UsageRecord,
} from '../../src/llm/index.js';

/** Build a configurable fake provider. */
function fakeProvider(
  name: string,
  behavior: {
    syncResponses?: Array<LLMResponse | Error>;
    inputTokens?: number;
    outputTokens?: number;
  } = {},
): LLMProvider {
  const queue = [...(behavior.syncResponses ?? [])];
  const defaultResp: LLMResponse = {
    content: [{ type: 'text', text: `hi from ${name}` }],
    stopReason: 'end_turn',
    usage: {
      inputTokens: behavior.inputTokens ?? 100,
      outputTokens: behavior.outputTokens ?? 50,
    },
    model: 'fake-model',
    provider: name,
  };
  return {
    name,
    model: 'fake-model',
    async chatSync(_m: Message[], _o?: LLMOptions) {
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next ?? defaultResp;
    },
    async *chat(m: Message[], o?: LLMOptions): AsyncGenerator<StreamChunk, LLMResponse> {
      const resp = await this.chatSync(m, o);
      yield { type: 'message_stop', stopReason: resp.stopReason, usage: resp.usage };
      return resp;
    },
    countTokens: (t: string) => Math.ceil(t.length / 4),
  };
}

describe('LLMClient: failover', () => {
  it('uses primary when primary succeeds', async () => {
    const primary = fakeProvider('primary');
    const secondary = fakeProvider('secondary');
    const primarySpy = vi.spyOn(primary, 'chatSync');
    const secondarySpy = vi.spyOn(secondary, 'chatSync');

    const client = new LLMClient(
      {
        providers: [
          { type: 'anthropic', model: 'primary' },
          { type: 'openai', model: 'secondary' },
        ],
        retry: { maxAttempts: 1, baseDelayMs: 1 },
      },
      {},
      (cfg) => (cfg.model === 'primary' ? primary : secondary),
    );

    const resp = await client.chatSync([{ role: 'user', content: 'hello' }]);
    expect(resp.provider).toBe('primary');
    expect(primarySpy).toHaveBeenCalledTimes(1);
    expect(secondarySpy).not.toHaveBeenCalled();
  });

  it('falls over to secondary when primary fails (non-retryable)', async () => {
    const primary = fakeProvider('primary', {
      syncResponses: [new Hipp0LLMError('bad key', 'primary', 401, false)],
    });
    const secondary = fakeProvider('secondary');

    const client = new LLMClient(
      {
        providers: [
          { type: 'anthropic', model: 'primary' },
          { type: 'openai', model: 'secondary' },
        ],
        retry: { maxAttempts: 1, baseDelayMs: 1 },
      },
      {},
      (cfg) => (cfg.model === 'primary' ? primary : secondary),
    );

    const resp = await client.chatSync([{ role: 'user', content: 'hello' }]);
    expect(resp.provider).toBe('secondary');
  });

  it('throws Hipp0AllProvidersFailedError when every provider fails', async () => {
    const primary = fakeProvider('primary', {
      syncResponses: [new Hipp0LLMError('boom1', 'primary', 400, false)],
    });
    const secondary = fakeProvider('secondary', {
      syncResponses: [new Hipp0LLMError('boom2', 'secondary', 400, false)],
    });

    const client = new LLMClient(
      {
        providers: [
          { type: 'anthropic', model: 'primary' },
          { type: 'openai', model: 'secondary' },
        ],
        retry: { maxAttempts: 1, baseDelayMs: 1 },
      },
      {},
      (cfg) => (cfg.model === 'primary' ? primary : secondary),
    );

    await expect(client.chatSync([{ role: 'user', content: 'x' }])).rejects.toBeInstanceOf(
      Hipp0AllProvidersFailedError,
    );
  });

  it('skips providers with open circuits', async () => {
    // Make primary fail enough times to open its circuit
    const failing = fakeProvider('primary', {
      syncResponses: Array(10).fill(new Hipp0LLMError('503', 'primary', 503, true)),
    });
    const healthy = fakeProvider('secondary');

    const client = new LLMClient(
      {
        providers: [
          { type: 'anthropic', model: 'primary' },
          { type: 'openai', model: 'secondary' },
        ],
        retry: { maxAttempts: 2, baseDelayMs: 1 },
        circuitBreaker: { failureThreshold: 1, resetTimeMs: 60_000 },
      },
      {},
      (cfg) => (cfg.model === 'primary' ? failing : healthy),
    );

    // First call: primary fails → circuit opens; secondary succeeds
    const first = await client.chatSync([{ role: 'user', content: 'a' }]);
    expect(first.provider).toBe('secondary');

    // Second call: primary circuit open → skipped → secondary succeeds immediately
    const spy = vi.spyOn(failing, 'chatSync');
    const second = await client.chatSync([{ role: 'user', content: 'b' }]);
    expect(second.provider).toBe('secondary');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('LLMClient: usage hook', () => {
  it('calls onUsage with computed cost on success', async () => {
    const provider = fakeProvider('x', { inputTokens: 1_000_000, outputTokens: 500_000 });
    const onUsage = vi.fn<(u: UsageRecord) => void>();

    const client = new LLMClient(
      {
        providers: [{ type: 'anthropic', model: 'claude-sonnet-4-5' }],
        retry: { maxAttempts: 1, baseDelayMs: 1 },
      },
      { onUsage },
      () => provider,
    );

    await client.chatSync([{ role: 'user', content: 'hi' }]);
    expect(onUsage).toHaveBeenCalledOnce();
    const rec = onUsage.mock.calls[0]![0];
    expect(rec.inputTokens).toBe(1_000_000);
    expect(rec.outputTokens).toBe(500_000);
    // 1M @ $3 + 500k @ $15 = $3 + $7.5
    expect(rec.costUsd).toBeCloseTo(10.5);
    expect(rec.provider).toBe('anthropic');
    expect(rec.model).toBe('claude-sonnet-4-5');
  });

  it('calls onUnknownModel when model is not in price table', async () => {
    const provider = fakeProvider('x');
    const onUnknownModel = vi.fn();

    const client = new LLMClient(
      {
        providers: [{ type: 'anthropic', model: 'claude-totally-mystery' }],
        retry: { maxAttempts: 1, baseDelayMs: 1 },
      },
      { onUnknownModel },
      () => provider,
    );

    await client.chatSync([{ role: 'user', content: 'x' }]);
    expect(onUnknownModel).toHaveBeenCalledWith('anthropic', 'claude-totally-mystery');
  });
});

describe('LLMClient: budget', () => {
  it('preflights budget and throws before calling any provider', async () => {
    // Heavy tokens so a single call blows past the budget.
    const provider = fakeProvider('x', { inputTokens: 1_000_000, outputTokens: 500_000 });
    const spy = vi.spyOn(provider, 'chatSync');

    const client = new LLMClient(
      {
        providers: [{ type: 'anthropic', model: 'claude-sonnet-4-5' }],
        retry: { maxAttempts: 1, baseDelayMs: 1 },
        budget: { dailyLimitUsd: 5 }, // $10.50 per call will blow this
      },
      {},
      () => provider,
    );

    // First call: preflight at $0 passes. Call spends $10.50.
    // BudgetEnforcer.record() inside recordUsage throws Hipp0BudgetExceededError.
    await expect(client.chatSync([{ role: 'user', content: 'x' }])).rejects.toBeInstanceOf(
      Hipp0BudgetExceededError,
    );

    // Second call: preflight catches the already-exceeded state before calling.
    await expect(client.chatSync([{ role: 'user', content: 'x' }])).rejects.toBeInstanceOf(
      Hipp0BudgetExceededError,
    );
    // Provider called once (the first call), not twice.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('getBudgetStatus returns null when no budget configured', async () => {
    const provider = fakeProvider('x');
    const client = new LLMClient(
      {
        providers: [{ type: 'anthropic', model: 'claude-sonnet-4-5' }],
        retry: { maxAttempts: 1, baseDelayMs: 1 },
      },
      {},
      () => provider,
    );
    expect(client.getBudgetStatus()).toBeNull();
  });
});

describe('LLMClient: construction', () => {
  it('rejects empty providers array', () => {
    expect(
      () =>
        new LLMClient({
          providers: [],
        }),
    ).toThrow(/at least one provider/i);
  });
});
