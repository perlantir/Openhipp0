/**
 * Conflict resolution — deterministic strategies for merging offline
 * writes against server state.
 *
 * Ported from packages/mobile/src/sync/conflict-resolver.ts.
 */

export interface VersionedRecord {
  id: string;
  updatedAt: string;
  [key: string]: unknown;
}

export type ConflictStrategy = 'server-wins' | 'last-write-wins';

export interface ConflictResolution<T extends VersionedRecord> {
  winner: T;
  loserDiscarded: T;
  strategy: ConflictStrategy;
  reason: string;
}

export function resolveConflict<T extends VersionedRecord>(
  local: T,
  remote: T,
  strategy: ConflictStrategy = 'server-wins',
): ConflictResolution<T> {
  if (local.id !== remote.id) {
    throw new Error(`Cannot resolve — different ids: ${local.id} vs ${remote.id}`);
  }
  if (strategy === 'server-wins') {
    return {
      winner: remote,
      loserDiscarded: local,
      strategy,
      reason: 'server-wins policy',
    };
  }
  const localTs = Date.parse(local.updatedAt);
  const remoteTs = Date.parse(remote.updatedAt);
  if (!Number.isFinite(localTs) || !Number.isFinite(remoteTs)) {
    return {
      winner: remote,
      loserDiscarded: local,
      strategy: 'server-wins',
      reason: 'malformed timestamp → server-wins fallback',
    };
  }
  if (localTs > remoteTs) {
    return {
      winner: local,
      loserDiscarded: remote,
      strategy,
      reason: `local newer (${local.updatedAt} > ${remote.updatedAt})`,
    };
  }
  return {
    winner: remote,
    loserDiscarded: local,
    strategy,
    reason: `remote newer or equal (${remote.updatedAt} >= ${local.updatedAt})`,
  };
}

/**
 * Per-kind strategy selector. Extends the mobile default with the
 * server-side record kinds (backup manifests, llm usage, audit events —
 * all server-wins because they're immutable or monotonically-appended).
 */
export function strategyForKind(kind: string): ConflictStrategy {
  switch (kind) {
    case 'decision':
    case 'skill':
    case 'session':
    case 'audit-event':
    case 'llm-usage':
    case 'backup-manifest':
      return 'server-wins';
    case 'preference':
    case 'agent-config':
    case 'user-note':
      return 'last-write-wins';
    default:
      return 'server-wins';
  }
}
