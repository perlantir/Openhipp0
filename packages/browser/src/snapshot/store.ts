/**
 * On-disk snapshot storage — gzipped JSON per snapshot, organized by session.
 * Retention: per-session count cap, total-bytes cap, max age. Pruning runs
 * lazily at write time.
 *
 * Path layout:
 *   <root>/<sessionId>/<takenAt>-<shortId>.snap.gz
 *
 * Snapshots are stored independently; dom/screenshot dedup via refPrevId
 * means a dependent snapshot needs its referent on disk to reconstruct full
 * content. `resolveFull` walks refPrevId chains within the same session.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import {
  DEFAULT_RETENTION,
  type RetentionPolicy,
  type SessionId,
  type Snapshot,
  type SnapshotId,
} from './types.js';

export interface SnapshotStoreOptions {
  readonly root: string;
  readonly retention?: RetentionPolicy;
  /** Test hook — clock override. */
  readonly now?: () => number;
}

export class SnapshotStore {
  readonly #root: string;
  readonly #retention: RetentionPolicy;
  readonly #now: () => number;

  constructor(opts: SnapshotStoreOptions) {
    this.#root = opts.root;
    this.#retention = { ...DEFAULT_RETENTION, ...(opts.retention ?? {}) };
    this.#now = opts.now ?? (() => Date.now());
  }

  sessionDir(sessionId: SessionId): string {
    return path.join(this.#root, sessionId);
  }

  async save(snap: Snapshot): Promise<{ filePath: string; bytes: number }> {
    const dir = this.sessionDir(snap.sessionId);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const shortId = snap.id.slice(0, 8);
    const tsSafe = snap.takenAt.replace(/[:.]/g, '-');
    const file = path.join(dir, `${tsSafe}-${shortId}.snap.gz`);
    const gz = gzipSync(Buffer.from(JSON.stringify(snap), 'utf8'));
    await fs.writeFile(file, gz, { mode: 0o600 });
    await this.#prune(snap.sessionId);
    return { filePath: file, bytes: gz.byteLength };
  }

  async load(filePath: string): Promise<Snapshot> {
    const gz = await fs.readFile(filePath);
    return JSON.parse(gunzipSync(gz).toString('utf8')) as Snapshot;
  }

  async listSessionFiles(sessionId: SessionId): Promise<string[]> {
    const dir = this.sessionDir(sessionId);
    try {
      const entries = await fs.readdir(dir);
      return entries
        .filter((e) => e.endsWith('.snap.gz'))
        .sort() // lexicographic == chronological given ISO prefix
        .map((e) => path.join(dir, e));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async listSessions(): Promise<SessionId[]> {
    try {
      const entries = await fs.readdir(this.#root, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name as SessionId);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async listSession(sessionId: SessionId): Promise<Snapshot[]> {
    const files = await this.listSessionFiles(sessionId);
    const out: Snapshot[] = [];
    for (const f of files) out.push(await this.load(f));
    return out;
  }

  /**
   * Rehydrate a snapshot's full dom + screenshot even if they're stored as
   * `refPrevId`. Walks back within the same session until hitting inline
   * content. Throws if the chain is broken.
   */
  async resolveFull(snap: Snapshot): Promise<Snapshot> {
    const needsDom = !snap.dom.contentGzB64 && snap.dom.refPrevId;
    const needsShot = !snap.screenshot.pngB64 && snap.screenshot.refPrevId;
    if (!needsDom && !needsShot) return snap;
    const all = await this.listSession(snap.sessionId);
    const byId = new Map(all.map((s) => [s.id, s]));

    function walk(kind: 'dom' | 'screenshot', startId: SnapshotId | undefined): string | undefined {
      let cursor = startId;
      while (cursor) {
        const s = byId.get(cursor);
        if (!s) return undefined;
        if (kind === 'dom' && s.dom.contentGzB64) return s.dom.contentGzB64;
        if (kind === 'screenshot' && s.screenshot.pngB64) return s.screenshot.pngB64;
        cursor = kind === 'dom' ? s.dom.refPrevId : s.screenshot.refPrevId;
      }
      return undefined;
    }

    const resolvedDomGz = needsDom ? walk('dom', snap.dom.refPrevId) : snap.dom.contentGzB64;
    const resolvedShot = needsShot
      ? walk('screenshot', snap.screenshot.refPrevId)
      : snap.screenshot.pngB64;

    return {
      ...snap,
      dom: {
        hash: snap.dom.hash,
        ...(resolvedDomGz ? { contentGzB64: resolvedDomGz } : {}),
      },
      screenshot: {
        hash: snap.screenshot.hash,
        ...(resolvedShot ? { pngB64: resolvedShot } : {}),
      },
    };
  }

  async #prune(sessionId: SessionId): Promise<void> {
    const maxAge = this.#retention.maxAgeMs;
    const maxPer = this.#retention.maxPerSession;
    const maxBytes = this.#retention.maxTotalBytes;

    // 1) Session-level count + age pruning.
    const files = await this.listSessionFiles(sessionId);
    const stamped: Array<{ file: string; mtime: number; size: number }> = [];
    for (const f of files) {
      const st = await fs.stat(f);
      stamped.push({ file: f, mtime: st.mtimeMs, size: st.size });
    }
    stamped.sort((a, b) => a.mtime - b.mtime); // oldest first

    const now = this.#now();
    const toDelete = new Set<string>();

    if (typeof maxAge === 'number') {
      for (const s of stamped) {
        if (now - s.mtime > maxAge) toDelete.add(s.file);
      }
    }
    if (typeof maxPer === 'number' && stamped.length > maxPer) {
      const surplus = stamped.length - maxPer;
      for (let i = 0; i < surplus; i++) toDelete.add(stamped[i]!.file);
    }

    // 2) Global byte budget pruning — oldest across all sessions.
    if (typeof maxBytes === 'number') {
      const all: Array<{ file: string; mtime: number; size: number }> = [];
      const sessions = await this.listSessions();
      for (const s of sessions) {
        for (const f of await this.listSessionFiles(s)) {
          try {
            const st = await fs.stat(f);
            all.push({ file: f, mtime: st.mtimeMs, size: st.size });
          } catch {
            /* file gone between listing and stat — ignore */
          }
        }
      }
      all.sort((a, b) => a.mtime - b.mtime);
      let total = all.reduce((acc, e) => acc + e.size, 0);
      for (const e of all) {
        if (total <= maxBytes) break;
        toDelete.add(e.file);
        total -= e.size;
      }
    }

    for (const f of toDelete) {
      await fs.rm(f, { force: true }).catch(() => undefined);
    }
  }
}
