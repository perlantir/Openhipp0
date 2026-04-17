/**
 * Per-site memory — records lessons about a specific hostname or URL.
 * Content is arbitrary (step plans, known failure points, workarounds,
 * patterns not worth re-learning). Intended for integration with the
 * decision-graph memory in `@openhipp0/memory`; G1-e ships the local
 * store only.
 */

export interface SiteNote {
  readonly id: string;
  readonly createdAt: string;
  readonly host: string;
  readonly pathPrefix?: string;
  readonly kind: 'step-plan' | 'known-failure' | 'workaround' | 'pattern' | 'note';
  readonly title: string;
  readonly body: string;
  readonly tags?: readonly string[];
  /** Increment on every successful recall. */
  readonly reinforcements: number;
  /** Decrement on every conflict/override. Delete when this hits 0. */
  readonly confidence: number;
}

export interface SiteMemoryQuery {
  readonly host: string;
  readonly pathPrefix?: string;
  readonly kinds?: readonly SiteNote['kind'][];
  readonly tags?: readonly string[];
  readonly limit?: number;
}
