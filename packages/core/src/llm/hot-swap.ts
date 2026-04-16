/**
 * Model hot-swap guardrail — validates a proposed provider ladder before
 * calling `LLMClient.reloadConfig`. Enforces:
 *
 *   - No EOL'd models.
 *   - Non-empty ladder.
 *   - When per-token cost >1.5× current, caller must set
 *     `acknowledgedCostIncreasePercent`.
 *   - Optional pre-commit ping (caller runs LLMClient.pingNewLadder).
 *
 * Canary (optional, structural) — CanaryRouter maintains a rollout
 * percentage + an error counter so callers can ramp traffic and auto-roll-
 * back on error spike.
 */

import { costRatio, isDeprecated } from './model-catalog.js';
import type { ProviderConfig } from './types.js';

export const DEFAULT_COST_BUDGET_MULTIPLIER = 1.5;

export interface HotSwapProposal {
  readonly current: readonly ProviderConfig[];
  readonly next: readonly ProviderConfig[];
  /** If next is >N× current cost, caller acknowledges the jump. */
  readonly acknowledgedCostIncreasePercent?: number;
}

export type HotSwapReject =
  | { ok: false; reason: 'empty-ladder' }
  | { ok: false; reason: 'deprecated'; detail: string }
  | { ok: false; reason: 'cost-budget'; detail: string; ratio: number }
  | { ok: false; reason: 'unknown-model'; detail: string };

export type HotSwapVerdict =
  | { ok: true; ratio: number; warnings: readonly string[] }
  | HotSwapReject;

export function validateHotSwap(
  proposal: HotSwapProposal,
  opts: { costBudgetMultiplier?: number; now?: number } = {},
): HotSwapVerdict {
  if (proposal.next.length === 0) return { ok: false, reason: 'empty-ladder' };
  const budgetMultiplier = opts.costBudgetMultiplier ?? DEFAULT_COST_BUDGET_MULTIPLIER;
  const warnings: string[] = [];
  const now = opts.now ?? Date.now();

  for (const p of proposal.next) {
    if (isDeprecated(p.type, p.model, now)) {
      return { ok: false, reason: 'deprecated', detail: `${p.type}/${p.model}` };
    }
  }

  // Compute the ratio on the top (primary) provider.
  const current = proposal.current[0];
  const next = proposal.next[0]!;
  let ratio = 1;
  if (current) {
    ratio = costRatio(current, next);
    if (!Number.isFinite(ratio)) {
      return { ok: false, reason: 'unknown-model', detail: `${next.type}/${next.model}` };
    }
    if (ratio > budgetMultiplier) {
      const ack = proposal.acknowledgedCostIncreasePercent ?? 0;
      const requiredPercent = Math.ceil((ratio - 1) * 100);
      if (ack < requiredPercent) {
        return {
          ok: false,
          reason: 'cost-budget',
          detail: `new config is ${ratio.toFixed(2)}× current cost; acknowledgedCostIncreasePercent must be >= ${requiredPercent}`,
          ratio,
        };
      }
      warnings.push(`cost increase acknowledged: ${ratio.toFixed(2)}×`);
    }
  }

  return { ok: true, ratio, warnings };
}

// ─── canary rollout ───────────────────────────────────────────────────────

export interface CanaryRouterOptions {
  /** Initial rollout percent of the NEW config (0..100). Default 10. */
  readonly initialPercent?: number;
  /** Auto-rollback when error rate on the new config exceeds this. Default 0.2 (20 %). */
  readonly errorRateThreshold?: number;
  /** Minimum samples before the threshold applies. Default 20. */
  readonly minSamples?: number;
  /** RNG for tests — default Math.random. */
  readonly rand?: () => number;
}

export interface CanaryDecision {
  readonly useNew: boolean;
  readonly rolledBack: boolean;
}

export class CanaryRouter {
  private newErrors = 0;
  private newSamples = 0;
  private percent: number;
  private rolledBack = false;
  private readonly opts: Required<Omit<CanaryRouterOptions, 'rand'>> & { rand: () => number };

  constructor(opts: CanaryRouterOptions = {}) {
    this.opts = {
      initialPercent: opts.initialPercent ?? 10,
      errorRateThreshold: opts.errorRateThreshold ?? 0.2,
      minSamples: opts.minSamples ?? 20,
      rand: opts.rand ?? Math.random,
    };
    this.percent = this.opts.initialPercent;
  }

  /** Decide whether THIS request uses the new config. */
  route(): CanaryDecision {
    if (this.rolledBack) return { useNew: false, rolledBack: true };
    const roll = this.opts.rand() * 100;
    const useNew = roll < this.percent;
    return { useNew, rolledBack: false };
  }

  /**
   * Record the outcome of a routed request. When the new-config error rate
   * crosses the threshold past `minSamples`, auto-rollback (future calls
   * route to the old config until `promote()` or `reset()` is called).
   */
  record(usedNew: boolean, ok: boolean): void {
    if (!usedNew || this.rolledBack) return;
    this.newSamples++;
    if (!ok) this.newErrors++;
    if (this.newSamples >= this.opts.minSamples) {
      const rate = this.newErrors / this.newSamples;
      if (rate >= this.opts.errorRateThreshold) this.rolledBack = true;
    }
  }

  /** Promote the new config to 100 % (call after green canary window). */
  promote(): void {
    this.percent = 100;
  }

  /** Reset to initial percent (after a manual rollback). */
  reset(): void {
    this.rolledBack = false;
    this.newErrors = 0;
    this.newSamples = 0;
    this.percent = this.opts.initialPercent;
  }

  snapshot(): { percent: number; rolledBack: boolean; samples: number; errors: number } {
    return {
      percent: this.percent,
      rolledBack: this.rolledBack,
      samples: this.newSamples,
      errors: this.newErrors,
    };
  }
}
