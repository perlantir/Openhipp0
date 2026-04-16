/**
 * Model router (L4 in the cost-optimization matrix).
 *
 * Cascades calls across a Haiku → Sonnet → Opus tier ladder (or any
 * analogue: mini → standard → large). The router returns a
 * `ProviderConfig[]` that LLMClient consumes as its ordered failover
 * chain, so downgrade is implicit: if Haiku returns a classifier-level
 * unreliable answer, the caller upgrades to Sonnet.
 *
 * Scope-doc caveat: this is gated by Phase 20 regression tests. The
 * router's `classify()` function decides the tier based on task
 * metadata; misclassifications → regression-test failures → rollback
 * via the Phase-20 threshold gate.
 */

import type { ProviderConfig } from './types.js';

export type Tier = 'haiku' | 'sonnet' | 'opus';

export interface TierConfig {
  readonly haiku: ProviderConfig;
  readonly sonnet: ProviderConfig;
  readonly opus: ProviderConfig;
}

export interface TaskDescriptor {
  /** Input length in approx tokens — used as a cheap complexity proxy. */
  readonly estimatedInputTokens?: number;
  /** Whether the task requires advanced reasoning (multi-step planning, proofs). */
  readonly requiresReasoning?: boolean;
  /** Whether the task is safety-sensitive (legal, medical, financial). */
  readonly safetySensitive?: boolean;
  /** Free-form labels for callers that want to override heuristics. */
  readonly labels?: readonly string[];
}

export interface RouterOptions {
  readonly tiers: TierConfig;
  /**
   * Custom classifier; override the default heuristic. Default:
   *   - safetySensitive or estimatedInputTokens > 20k  → 'opus'
   *   - requiresReasoning or estimatedInputTokens > 5k → 'sonnet'
   *   - else → 'haiku'
   */
  readonly classify?: (task: TaskDescriptor) => Tier;
}

export interface ModelRouter {
  readonly tiers: TierConfig;
  /** Return the primary tier and the fallback ladder above it. */
  select(task: TaskDescriptor): { primary: Tier; providers: ProviderConfig[] };
  /** Shortcut: just the primary tier classification. */
  classify(task: TaskDescriptor): Tier;
}

export function createModelRouter(opts: RouterOptions): ModelRouter {
  const classifier = opts.classify ?? defaultClassify;
  return {
    tiers: opts.tiers,
    classify: classifier,
    select(task) {
      const primary = classifier(task);
      const ladder = laddersFrom(primary, opts.tiers);
      return { primary, providers: ladder };
    },
  };
}

function laddersFrom(start: Tier, tiers: TierConfig): ProviderConfig[] {
  // Upgrade on failover — haiku failover promotes to sonnet then opus.
  // Opus never upgrades further.
  switch (start) {
    case 'haiku':
      return [tiers.haiku, tiers.sonnet, tiers.opus];
    case 'sonnet':
      return [tiers.sonnet, tiers.opus];
    case 'opus':
    default:
      return [tiers.opus];
  }
}

export function defaultClassify(task: TaskDescriptor): Tier {
  if (task.safetySensitive) return 'opus';
  if ((task.estimatedInputTokens ?? 0) > 20_000) return 'opus';
  if (task.requiresReasoning) return 'sonnet';
  if ((task.estimatedInputTokens ?? 0) > 5_000) return 'sonnet';
  return 'haiku';
}
