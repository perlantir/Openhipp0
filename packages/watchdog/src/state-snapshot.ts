/**
 * State snapshot — atomic save/load of process state for restart continuity.
 *
 * The schema (StateSnapshotSchema in ./types.ts) is the public contract for any
 * out-of-process restart manager (Phase 7+ sidecar / systemd unit / Docker
 * entry shim). Bumping the schema requires bumping SNAPSHOT_VERSION; readers
 * MUST refuse unknown values.
 *
 * Atomicity: write to `${path}.tmp`, then rename. POSIX rename is atomic on
 * the same filesystem. Survives partial-write crashes — the next load() either
 * reads the prior good snapshot or sees no file at all.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  Hipp0SnapshotCorruptError,
  SNAPSHOT_VERSION,
  StateSnapshotSchema,
  type StateSnapshot,
} from './types.js';

/**
 * What callers may supply on save() — we fill `version`, `savedAt`, `pid`,
 * `uptimeSeconds` ourselves from the running process.
 */
export type SnapshotInput = Partial<
  Omit<StateSnapshot, 'version' | 'savedAt' | 'pid' | 'uptimeSeconds'>
>;

export class StateSnapshotStore {
  constructor(private readonly snapshotPath: string) {}

  async save(input: SnapshotInput = {}): Promise<StateSnapshot> {
    const snapshot: StateSnapshot = StateSnapshotSchema.parse({
      version: SNAPSHOT_VERSION,
      savedAt: new Date().toISOString(),
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
      sessionsActive: input.sessionsActive ?? 0,
      recentDecisionIds: input.recentDecisionIds ?? [],
      lastSafeModeAt: input.lastSafeModeAt ?? null,
      custom: input.custom ?? {},
    });
    await fs.mkdir(path.dirname(this.snapshotPath), { recursive: true });
    const tmp = `${this.snapshotPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
    await fs.rename(tmp, this.snapshotPath);
    return snapshot;
  }

  /**
   * Returns null if the snapshot file doesn't exist; throws
   * Hipp0SnapshotCorruptError if it exists but is unreadable / unparseable /
   * fails schema validation.
   */
  async load(): Promise<StateSnapshot | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.snapshotPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Hipp0SnapshotCorruptError(this.snapshotPath, err);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Hipp0SnapshotCorruptError(this.snapshotPath, err);
    }
    const result = StateSnapshotSchema.safeParse(parsed);
    if (!result.success) {
      throw new Hipp0SnapshotCorruptError(this.snapshotPath, result.error);
    }
    return result.data;
  }

  /** Idempotent — a missing file is success, not an error. */
  async clear(): Promise<void> {
    try {
      await fs.unlink(this.snapshotPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  get path(): string {
    return this.snapshotPath;
  }
}
