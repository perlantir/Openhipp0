/**
 * LLMClient — composes providers into a failover chain with circuit breakers,
 * retry, budget enforcement, and a usage hook (for DB audit in downstream
 * consumers that can't import memory directly).
 *
 * Order of operations per call:
 *   for each configured provider (in order):
 *     - if its circuit breaker is OPEN → skip
 *     - call provider through `retry()`
 *       - on success: record usage via BudgetEnforcer + hook, return
 *       - on retryable fail: retry() handles; on exhaustion, circuit records
 *         a failure, move to next provider
 *       - on non-retryable fail: circuit records a failure, move to next
 *   if all providers failed → throw Hipp0AllProvidersFailedError
 *
 * Budget checks: preflight (willExceed()) before first provider, and after
 * each call to catch concurrent-caller races.
 */

import { BudgetEnforcer, computeCostUsd, type BudgetStatus } from './cost-tracker.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { retry } from './retry.js';
import { AnthropicProvider } from './provider-anthropic.js';
import { OpenAIProvider } from './provider-openai.js';
import { OllamaProvider } from './provider-ollama.js';
import {
  Hipp0AllProvidersFailedError,
  Hipp0BudgetExceededError,
  Hipp0CircuitOpenError,
  type LLMClientConfig,
  type LLMOptions,
  type LLMProvider,
  type LLMResponse,
  type Message,
  type ProviderConfig,
  type ProviderType,
  type StreamChunk,
} from './types.js';

export interface UsageRecord {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** ms since epoch */
  timestamp: number;
}

export interface LLMClientHooks {
  /** Called on every successful call. Typically wired to an auditLog + llmUsage writer. */
  onUsage?: (record: UsageRecord) => void | Promise<void>;
  /** Called once when spend crosses budget.alertAtPercent. */
  onBudgetAlert?: (status: BudgetStatus) => void;
  /** Called when we compute cost for an unknown (provider, model) — returns 0. */
  onUnknownModel?: (provider: ProviderType, model: string) => void;
}

/** Factory for providers. Exposed for testing. */
export type ProviderFactory = (config: ProviderConfig) => LLMProvider;

export const defaultProviderFactory: ProviderFactory = (config) => {
  switch (config.type) {
    case 'anthropic':
      return new AnthropicProvider({
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });
    case 'openai':
      return new OpenAIProvider({
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });
    case 'ollama':
      return new OllamaProvider({
        model: config.model,
        baseUrl: config.baseUrl,
      });
  }
};

interface ProviderSlot {
  provider: LLMProvider;
  breaker: CircuitBreaker;
  config: ProviderConfig;
}

export class LLMClient {
  private slots: ProviderSlot[];
  private readonly budget: BudgetEnforcer | undefined;
  private readonly retryConfig: NonNullable<LLMClientConfig['retry']>;
  private readonly hooks: LLMClientHooks;
  private readonly cache: LLMClientConfig['cache'] | undefined;
  private readonly factory: ProviderFactory;
  private readonly cbConfig: NonNullable<LLMClientConfig['circuitBreaker']>;

  constructor(
    config: LLMClientConfig,
    hooks: LLMClientHooks = {},
    factory: ProviderFactory = defaultProviderFactory,
  ) {
    if (config.providers.length === 0) {
      throw new Error('LLMClient requires at least one provider');
    }
    this.cbConfig = config.circuitBreaker ?? { failureThreshold: 5, resetTimeMs: 60_000 };
    this.slots = config.providers.map((p) => ({
      provider: factory(p),
      breaker: new CircuitBreaker(this.cbConfig),
      config: p,
    }));
    this.budget = config.budget
      ? new BudgetEnforcer(config.budget, Date.now, hooks.onBudgetAlert)
      : undefined;
    this.retryConfig = config.retry ?? { maxAttempts: 3, baseDelayMs: 500 };
    this.hooks = hooks;
    this.cache = config.cache ?? undefined;
    this.factory = factory;
  }

  /**
   * Atomically swap the provider ladder at runtime. In-flight requests on
   * the previous slots complete normally (they hold their own reference to
   * the slot array slice). New requests use the new ladder.
   *
   * For rollback safety: callers should run `pingNewLadder()` first to
   * validate the new config before committing.
   */
  reloadConfig(newProviders: readonly ProviderConfig[]): void {
    if (newProviders.length === 0) {
      throw new Error('LLMClient.reloadConfig requires at least one provider');
    }
    this.slots = newProviders.map((p) => ({
      provider: this.factory(p),
      breaker: new CircuitBreaker(this.cbConfig),
      config: p,
    }));
  }

  /** Snapshot of the current provider ladder (for GET /api/config/models). */
  getProviderConfigs(): readonly ProviderConfig[] {
    return this.slots.map((s) => s.config);
  }

  /**
   * Ping the TOP provider in a proposed ladder with a tiny "say hi" prompt
   * to validate it responds + parses. Used as a pre-commit sanity check
   * before `reloadConfig`.
   */
  async pingNewLadder(newProviders: readonly ProviderConfig[]): Promise<{ ok: boolean; error?: string }> {
    if (newProviders.length === 0) return { ok: false, error: 'empty ladder' };
    const top = newProviders[0]!;
    try {
      const p = this.factory(top);
      const resp = await p.chatSync([{ role: 'user', content: 'ping' }], { maxTokens: 8 });
      if (!Array.isArray(resp.content)) return { ok: false, error: 'non-array content' };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Non-streaming call. Tries providers in order until one succeeds. */
  async chatSync(messages: Message[], options: LLMOptions = {}): Promise<LLMResponse> {
    if (this.cache) {
      const cached = this.cache.get(messages, options);
      if (cached) return cached;
    }
    this.preflightBudget();
    const errors: { provider: string; error: unknown }[] = [];

    for (const slot of this.slots) {
      if (!slot.breaker.canExecute()) {
        errors.push({
          provider: slot.provider.name,
          error: new Hipp0CircuitOpenError(slot.provider.name, slot.breaker.retryAfterMs()),
        });
        continue;
      }
      try {
        const resp = await retry(() => slot.provider.chatSync(messages, options), this.retryConfig);
        slot.breaker.recordSuccess();
        await this.recordUsage(slot.config, resp);
        this.cache?.set(messages, options, resp);
        return resp;
      } catch (err) {
        slot.breaker.recordFailure();
        errors.push({ provider: slot.provider.name, error: err });
        // If this was a budget-exceeded error, fail fast — retrying another
        // provider doesn't recover spend.
        if (err instanceof Hipp0BudgetExceededError) throw err;
      }
    }
    throw new Hipp0AllProvidersFailedError(errors);
  }

  /**
   * Streaming call. Same failover logic as chatSync, but yields chunks.
   * Streaming begins only after a provider is committed to (no mid-stream
   * fallback); first provider that gets past circuit+retry is used.
   */
  async *chat(
    messages: Message[],
    options: LLMOptions = {},
  ): AsyncGenerator<StreamChunk, LLMResponse> {
    this.preflightBudget();
    const errors: { provider: string; error: unknown }[] = [];

    for (const slot of this.slots) {
      if (!slot.breaker.canExecute()) {
        errors.push({
          provider: slot.provider.name,
          error: new Hipp0CircuitOpenError(slot.provider.name, slot.breaker.retryAfterMs()),
        });
        continue;
      }
      try {
        // Retry only applies to getting the stream started. Once chunks flow,
        // mid-stream failures are surfaced to the caller.
        const gen = await retry(
          async () => slot.provider.chat(messages, options),
          this.retryConfig,
        );
        slot.breaker.recordSuccess();
        const resp = yield* gen;
        await this.recordUsage(slot.config, resp);
        return resp;
      } catch (err) {
        slot.breaker.recordFailure();
        errors.push({ provider: slot.provider.name, error: err });
        if (err instanceof Hipp0BudgetExceededError) throw err;
      }
    }
    throw new Hipp0AllProvidersFailedError(errors);
  }

  /** Snapshot of current budget state, or null if no budget configured. */
  getBudgetStatus(): BudgetStatus | null {
    return this.budget?.status() ?? null;
  }

  /** Reset all circuit breakers to CLOSED. Admin / test use. */
  resetCircuits(): void {
    for (const slot of this.slots) slot.breaker.reset();
  }

  // ─────────────────────────────────────────────────────────────────────────

  private preflightBudget(): void {
    if (!this.budget) return;
    const status = this.budget.status();
    if (status.currentUsd >= status.dailyLimitUsd) {
      throw new Hipp0BudgetExceededError(status.dailyLimitUsd, status.currentUsd);
    }
  }

  private async recordUsage(config: ProviderConfig, resp: LLMResponse): Promise<void> {
    const costUsd = computeCostUsd(
      config.type,
      config.model,
      resp.usage.inputTokens,
      resp.usage.outputTokens,
      this.hooks.onUnknownModel,
    );
    const record: UsageRecord = {
      provider: config.type,
      model: config.model,
      inputTokens: resp.usage.inputTokens,
      outputTokens: resp.usage.outputTokens,
      costUsd,
      timestamp: Date.now(),
    };
    // Budget-record first so a concurrent race past the limit still throws.
    this.budget?.record(costUsd);
    await this.hooks.onUsage?.(record);
  }
}
