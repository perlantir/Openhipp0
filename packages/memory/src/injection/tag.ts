/**
 * Memory-side tagging adapter (Phase 21).
 *
 * Wraps raw recall results with ProvenanceTag so downstream callers
 * (compile, system-prompt construction) can partition safe vs. quarantined
 * content and apply spotlighting without having to re-derive trust.
 *
 * The `trust` on memory items at the row level is NOT yet a persisted
 * schema column — Retro-B persists trust on ingestItem callbacks but
 * memoryEntries/sessionHistory tables don't carry it. Until that
 * migration lands, this module exposes:
 *
 *   - default tags (session_history → origin:'memory' / trust:'medium')
 *   - tag-supplier hooks so callers who DO have trust (from a side
 *     channel, or by re-reading connectors metadata) can plug it in
 *     without touching recall internals.
 */

import type { SessionHistory } from '../db/schema.js';
import type { RecallHit } from '../recall/index.js';

export type TrustLevel = 'high' | 'medium' | 'low' | 'untrusted';

export type Origin =
  | 'system'
  | 'user'
  | 'tool-output'
  | 'connector'
  | 'memory'
  | 'external'
  | 'skill';

export interface ProvenanceTag {
  origin: Origin;
  trust: TrustLevel;
  label?: string;
  ref?: string;
}

export interface TaggedSession {
  readonly tag: ProvenanceTag;
  readonly hit: RecallHit;
}

/** Default tag applied when no supplier overrides. */
export const DEFAULT_SESSION_TAG: ProvenanceTag = Object.freeze({
  origin: 'memory',
  trust: 'medium',
});

export type SessionTagSupplier = (session: SessionHistory) => ProvenanceTag | undefined;

export function tagRecallHits(
  hits: readonly RecallHit[],
  supplier?: SessionTagSupplier,
): readonly TaggedSession[] {
  return hits.map((hit) => {
    // Row-level tags (Follow-up C) take precedence — if the session was
    // written with a trust/origin after the schema bump, use those.
    const row = hit.session as SessionHistory & {
      origin?: string | null;
      trust?: TrustLevel | null;
    };
    if (row.trust && row.origin) {
      return {
        tag: {
          origin: row.origin as Origin,
          trust: row.trust,
          ref: hit.session.id,
          label: `session:${hit.session.agentId}`,
        },
        hit,
      };
    }
    const supplied = supplier?.(hit.session);
    const tag = supplied ?? {
      ...DEFAULT_SESSION_TAG,
      ref: hit.session.id,
      label: `session:${hit.session.agentId}`,
    };
    return { tag, hit };
  });
}

/**
 * True when a tag should be stored + displayed but never auto-promoted
 * into decisions or re-injected as trusted instructions. Mirrors the
 * helper in @openhipp0/core/security/injection for consumers that
 * import from memory only.
 */
export function isQuarantined(tag: ProvenanceTag): boolean {
  return tag.trust === 'low' || tag.trust === 'untrusted';
}
