// packages/mobile/src/sync/sync-manager.ts
// Coordinates the outbound queue + pull-side delta sync + local cache.
// Storage is behind an interface so tests can run without expo-sqlite.
//
// Primitives live in @openhipp0/core/offline as of Phase 25 — this module
// re-exports them so mobile callers keep a single local import surface
// for both the manager and the underlying types.

import { offline } from "@openhipp0/core";

const { OutboundActionQueue, resolveConflict, strategyForKind } = offline;
type QueuedAction<T = unknown> = offline.QueuedAction<T>;
type QueuePersistence = offline.QueuePersistence;
type VersionedRecord = offline.VersionedRecord;
type ActionHandler = offline.ActionHandler;

export {
  OutboundActionQueue,
  resolveConflict,
  strategyForKind,
  type QueuedAction,
  type QueuePersistence,
  type VersionedRecord,
  type ActionHandler,
};

export interface LocalCacheWriter {
  upsert<T extends VersionedRecord>(kind: string, record: T): Promise<void>;
  get<T extends VersionedRecord>(kind: string, id: string): Promise<T | undefined>;
  list<T extends VersionedRecord>(kind: string): Promise<readonly T[]>;
  /** Delete a record after server confirms removal. */
  remove(kind: string, id: string): Promise<void>;
  /** Cursor tracking per kind. */
  getCursor(kind: string): Promise<string | undefined>;
  setCursor(kind: string, cursor: string): Promise<void>;
}

export interface RemotePullClient {
  /** Returns records with updatedAt > since. */
  pullDelta(
    kind: string,
    since: string | undefined,
  ): Promise<{ records: readonly VersionedRecord[]; nextCursor: string | undefined }>;
}

export interface SyncManagerDeps {
  cache: LocalCacheWriter;
  remote: RemotePullClient;
  queuePersistence?: QueuePersistence;
  /** Handler invoked for each queued outbound action during drain. */
  actionHandler: (action: QueuedAction) => Promise<void>;
  /** Called for every conflict so the host can surface notifications. */
  onConflict?: (kind: string, resolution: { winner: VersionedRecord; reason: string }) => void;
}

export class SyncManager {
  private readonly queue: offline.OutboundActionQueue;
  private readonly deps: SyncManagerDeps;

  constructor(deps: SyncManagerDeps) {
    this.deps = deps;
    this.queue = new OutboundActionQueue({ concurrency: 1 }, deps.queuePersistence);
  }

  async start(): Promise<void> {
    await this.queue.restore();
  }

  async enqueueOutbound<T>(kind: string, payload: T): Promise<QueuedAction<T>> {
    return this.queue.enqueue(kind, payload) as QueuedAction<T>;
  }

  /** Drain any pending outbound actions. Returns counts for the drain pass. */
  async flushOutbound(): Promise<{ processed: number; failed: number; dropped: number }> {
    return this.queue.drain(this.deps.actionHandler);
  }

  /** Pull a single kind; merges remote changes into the local cache. */
  async pullKind(kind: string): Promise<{ pulled: number; conflicts: number }> {
    const since = await this.deps.cache.getCursor(kind);
    const { records, nextCursor } = await this.deps.remote.pullDelta(kind, since);
    let conflicts = 0;
    const strategy = strategyForKind(kind);
    for (const remote of records) {
      const local = await this.deps.cache.get(kind, remote.id);
      if (!local) {
        await this.deps.cache.upsert(kind, remote);
        continue;
      }
      if (local.updatedAt === remote.updatedAt) {
        continue;
      }
      conflicts++;
      const resolution = resolveConflict(local, remote, strategy);
      await this.deps.cache.upsert(kind, resolution.winner);
      this.deps.onConflict?.(kind, {
        winner: resolution.winner,
        reason: resolution.reason,
      });
    }
    if (nextCursor) await this.deps.cache.setCursor(kind, nextCursor);
    return { pulled: records.length, conflicts };
  }

  /** Pull every kind the app cares about in parallel. */
  async pullAll(kinds: readonly string[]): Promise<{ pulled: number; conflicts: number }> {
    const results = await Promise.all(kinds.map((k) => this.pullKind(k)));
    return results.reduce(
      (acc, r) => ({ pulled: acc.pulled + r.pulled, conflicts: acc.conflicts + r.conflicts }),
      { pulled: 0, conflicts: 0 },
    );
  }

  get pendingOutbound(): number {
    return this.queue.size();
  }
}
