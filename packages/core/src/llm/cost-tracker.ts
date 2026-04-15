/**
 * Cost tracking + budget enforcement.
 *
 * Prices are USD per 1M tokens. Numbers are best-effort snapshots; real deploys
 * should override via `registerPrice()` at startup (e.g. from a config file)
 * to avoid stale costs silently under-counting spend.
 *
 * BudgetEnforcer tracks spend in a rolling 24h window (in-memory). Persisting
 * across restarts is the memory package's job — see llm_usage table + auditLog.
 */

import { Hipp0BudgetExceededError, type BudgetConfig, type ProviderType } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Price table (USD per 1M tokens)
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

type PriceKey = `${ProviderType}:${string}`;

/**
 * Default price table. Last reviewed against public pricing in late 2025.
 * Override in deploys:
 *   registerPrice('anthropic', 'claude-custom-x', { inputPerMillion: ..., outputPerMillion: ... });
 */
const prices = new Map<PriceKey, ModelPrice>([
  // Anthropic — Claude family
  ['anthropic:claude-opus-4-6', { inputPerMillion: 15, outputPerMillion: 75 }],
  ['anthropic:claude-opus-4-5', { inputPerMillion: 15, outputPerMillion: 75 }],
  ['anthropic:claude-opus-4', { inputPerMillion: 15, outputPerMillion: 75 }],
  ['anthropic:claude-sonnet-4-6', { inputPerMillion: 3, outputPerMillion: 15 }],
  ['anthropic:claude-sonnet-4-5', { inputPerMillion: 3, outputPerMillion: 15 }],
  ['anthropic:claude-sonnet-4', { inputPerMillion: 3, outputPerMillion: 15 }],
  ['anthropic:claude-3-7-sonnet', { inputPerMillion: 3, outputPerMillion: 15 }],
  ['anthropic:claude-3-5-sonnet', { inputPerMillion: 3, outputPerMillion: 15 }],
  ['anthropic:claude-haiku-4-5', { inputPerMillion: 1, outputPerMillion: 5 }],
  ['anthropic:claude-3-5-haiku', { inputPerMillion: 0.8, outputPerMillion: 4 }],

  // OpenAI — GPT family (snapshot — verify before relying in production)
  ['openai:gpt-4o', { inputPerMillion: 2.5, outputPerMillion: 10 }],
  ['openai:gpt-4o-mini', { inputPerMillion: 0.15, outputPerMillion: 0.6 }],
  ['openai:gpt-4-turbo', { inputPerMillion: 10, outputPerMillion: 30 }],
  ['openai:o1', { inputPerMillion: 15, outputPerMillion: 60 }],
  ['openai:o1-mini', { inputPerMillion: 3, outputPerMillion: 12 }],

  // Ollama — local inference is free from an API-spend perspective.
]);

/**
 * Look up the price for a provider+model. Returns `undefined` if unknown
 * (caller can decide to warn / error / fall back to 0).
 */
export function getPrice(provider: ProviderType, model: string): ModelPrice | undefined {
  return prices.get(`${provider}:${model}`);
}

/** Override or add a price entry. */
export function registerPrice(provider: ProviderType, model: string, price: ModelPrice): void {
  prices.set(`${provider}:${model}`, price);
}

/**
 * Compute USD cost of a call. Unknown (provider, model) returns 0 and invokes
 * `onUnknown` (typically a warning log). Ollama always returns 0.
 */
export function computeCostUsd(
  provider: ProviderType,
  model: string,
  inputTokens: number,
  outputTokens: number,
  onUnknown?: (provider: ProviderType, model: string) => void,
): number {
  if (provider === 'ollama') return 0;
  const price = getPrice(provider, model);
  if (!price) {
    onUnknown?.(provider, model);
    return 0;
  }
  return (inputTokens * price.inputPerMillion + outputTokens * price.outputPerMillion) / 1_000_000;
}

// ─────────────────────────────────────────────────────────────────────────────
// Budget enforcement
// ─────────────────────────────────────────────────────────────────────────────

export interface SpendEntry {
  timestamp: number;
  costUsd: number;
}

export interface BudgetStatus {
  currentUsd: number;
  dailyLimitUsd: number;
  percentUsed: number;
  alertTriggered: boolean;
}

/**
 * Tracks spend in a rolling 24h window. Call `willExceed()` before a call to
 * preflight-check, and `record()` after to add the actual cost. `record()`
 * throws `Hipp0BudgetExceededError` if the resulting total crosses the limit —
 * this protects against concurrent calls racing past the limit.
 */
export class BudgetEnforcer {
  private entries: SpendEntry[] = [];
  private alerted = false;

  constructor(
    private readonly config: BudgetConfig,
    private readonly now: () => number = Date.now,
    private readonly onAlert?: (status: BudgetStatus) => void,
  ) {
    if (config.dailyLimitUsd <= 0) throw new RangeError('dailyLimitUsd must be > 0');
    const alertAt = config.alertAtPercent;
    if (alertAt !== undefined && (alertAt < 0 || alertAt > 1)) {
      throw new RangeError('alertAtPercent must be between 0 and 1');
    }
  }

  /** Prune entries older than 24h. */
  private prune(): void {
    const cutoff = this.now() - 24 * 60 * 60 * 1000;
    // Binary search would be overkill for small N; linear is fine.
    while (this.entries.length > 0 && this.entries[0]!.timestamp < cutoff) {
      this.entries.shift();
    }
  }

  /** Sum of spend in the last 24h window. */
  currentUsd(): number {
    this.prune();
    return this.entries.reduce((sum, e) => sum + e.costUsd, 0);
  }

  /** Status snapshot suitable for monitoring / dashboard display. */
  status(): BudgetStatus {
    const currentUsd = this.currentUsd();
    const percentUsed = currentUsd / this.config.dailyLimitUsd;
    const alertThreshold = this.config.alertAtPercent ?? 0.8;
    return {
      currentUsd,
      dailyLimitUsd: this.config.dailyLimitUsd,
      percentUsed,
      alertTriggered: percentUsed >= alertThreshold,
    };
  }

  /**
   * Preflight check: would adding `estimatedCostUsd` exceed the limit?
   * Returns false if the limit would be crossed. Does not mutate state.
   */
  willExceed(estimatedCostUsd: number): boolean {
    return this.currentUsd() + estimatedCostUsd > this.config.dailyLimitUsd;
  }

  /**
   * Record an actual spend. Throws Hipp0BudgetExceededError if the resulting
   * total exceeds the daily limit. Fires the alert callback once per crossing.
   */
  record(costUsd: number): void {
    if (costUsd < 0) throw new RangeError('costUsd must be >= 0');
    const ts = this.now();
    this.entries.push({ timestamp: ts, costUsd });
    const status = this.status();

    if (status.currentUsd > this.config.dailyLimitUsd) {
      throw new Hipp0BudgetExceededError(this.config.dailyLimitUsd, status.currentUsd);
    }
    if (status.alertTriggered && !this.alerted) {
      this.alerted = true;
      this.onAlert?.(status);
    } else if (!status.alertTriggered) {
      // Reset alert-once flag when spend drops back below threshold (after 24h prune).
      this.alerted = false;
    }
  }

  /** Reset all spend tracking. Use with care (admin / tests). */
  reset(): void {
    this.entries = [];
    this.alerted = false;
  }
}
