/**
 * Backup — copy a set of files/directories to a timestamped destination, then
 * provide a `restore()` to put them back.
 *
 * Strategy: full file/directory copy via `fs.cp`. Adequate for the SQLite db
 * file + ~/.hipp0/config dir; not designed for multi-GB Postgres dumps (those
 * stay the caller's problem).
 *
 * Atomicity: backups land under `{destDir}/{ISO-timestamp}-{label?}/{basename}`.
 * The destination dir is created fresh for each backup; restore walks it back
 * to the original sources via the saved manifest.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Hipp0BackupError, type BackupArtifact, type BackupOptions } from './types.js';

interface ManifestEntry {
  source: string;
  destBasename: string;
}

interface Manifest {
  takenAt: string;
  label?: string;
  entries: ManifestEntry[];
}

const MANIFEST_FILE = '_manifest.json';

export class BackupHandle {
  constructor(
    readonly artifact: BackupArtifact,
    private readonly manifest: Manifest,
  ) {}

  /** Restore every backed-up source from the snapshot. Existing files at the
   *  source path are removed first to ensure the restored copy is canonical. */
  async restore(): Promise<void> {
    for (const entry of this.manifest.entries) {
      const src = path.join(this.artifact.path, entry.destBasename);
      try {
        await fs.rm(entry.source, { recursive: true, force: true });
      } catch {
        // ENOENT is fine; other errors will surface on the cp below.
      }
      await fs.cp(src, entry.source, { recursive: true });
    }
  }

  /** Remove the backup directory itself. */
  async discard(): Promise<void> {
    await fs.rm(this.artifact.path, { recursive: true, force: true });
  }
}

export async function createBackup(opts: BackupOptions): Promise<BackupHandle> {
  if (opts.sources.length === 0) {
    throw new Hipp0BackupError('createBackup: sources must be non-empty');
  }
  const takenAt = new Date().toISOString();
  // Filename-safe timestamp.
  const stamp = takenAt.replace(/[:.]/g, '-');
  const dirName = opts.label ? `${stamp}-${sanitize(opts.label)}` : stamp;
  const dest = path.join(opts.destDir, dirName);
  await fs.mkdir(dest, { recursive: true });

  const entries: ManifestEntry[] = [];
  let totalBytes = 0;
  for (const source of opts.sources) {
    const basename = path.basename(source);
    const destBasename = await uniqueBasename(dest, basename);
    const destPath = path.join(dest, destBasename);
    try {
      await fs.cp(source, destPath, { recursive: true });
    } catch (err) {
      // Cleanup partial backup so the next run isn't littered with corpses.
      await fs.rm(dest, { recursive: true, force: true }).catch(() => undefined);
      throw new Hipp0BackupError(`Failed to back up ${source}`, err);
    }
    entries.push({ source: path.resolve(source), destBasename });
    totalBytes += await dirSize(destPath);
  }

  const manifest: Manifest = { takenAt, ...(opts.label ? { label: opts.label } : {}), entries };
  await fs.writeFile(path.join(dest, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf8');

  const artifact: BackupArtifact = {
    path: dest,
    takenAt,
    ...(opts.label ? { label: opts.label } : {}),
    bytes: totalBytes,
  };
  return new BackupHandle(artifact, manifest);
}

/** Re-open a backup directory written by `createBackup`. */
export async function openBackup(backupPath: string): Promise<BackupHandle> {
  const raw = await fs.readFile(path.join(backupPath, MANIFEST_FILE), 'utf8');
  const manifest = JSON.parse(raw) as Manifest;
  const artifact: BackupArtifact = {
    path: backupPath,
    takenAt: manifest.takenAt,
    ...(manifest.label ? { label: manifest.label } : {}),
    bytes: await dirSize(backupPath),
  };
  return new BackupHandle(artifact, manifest);
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function uniqueBasename(dir: string, basename: string): Promise<string> {
  let candidate = basename;
  let n = 1;
  // The destination is fresh per backup, so collisions are rare — but two
  // sources with the same basename (e.g. /a/foo.db + /b/foo.db) need disambig.
  while (await exists(path.join(dir, candidate))) {
    candidate = `${basename}.${n++}`;
  }
  return candidate;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function dirSize(p: string): Promise<number> {
  const stats = await fs.stat(p);
  if (!stats.isDirectory()) return stats.size;
  let total = 0;
  for (const entry of await fs.readdir(p)) {
    total += await dirSize(path.join(p, entry));
  }
  return total;
}
