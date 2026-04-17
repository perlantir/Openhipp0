/**
 * Pack/unpack a directory tree into a single gzipped JSON buffer.
 *
 * Plain + small (no new runtime deps). Files are represented as
 *   { path (relative), mode (octal number), dataB64 }
 * The stream is gzipped; base64 inflation is largely offset by gzip on
 * typical Chromium profile content (SQLite + LevelDB compress well).
 *
 * Suitable for profile sizes under a few hundred MB. Streaming / delta
 * formats are a G1-b optimization if checkpoint overhead bites in
 * practice (see CLAUDE.md DECISION "Encrypted-at-rest = decrypt-to-tmp").
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

export interface PackedFile {
  readonly path: string;
  readonly mode: number;
  readonly dataB64: string;
}

export interface PackedArchive {
  readonly version: 1;
  readonly files: readonly PackedFile[];
}

/** Recursive directory walk yielding relative file paths (files only). */
async function walk(root: string, rel = ''): Promise<string[]> {
  const full = path.join(root, rel);
  const entries = await fs.readdir(full, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const next = rel.length === 0 ? entry.name : path.posix.join(rel, entry.name);
    if (entry.isDirectory()) {
      const nested = await walk(root, next);
      out.push(...nested);
    } else if (entry.isFile()) {
      out.push(next);
    }
    // Symlinks + special files are skipped — Chromium profile dirs don't use them.
  }
  return out;
}

export async function packDir(rootDir: string): Promise<Buffer> {
  const rel = await walk(rootDir);
  const files: PackedFile[] = [];
  for (const p of rel) {
    const abs = path.join(rootDir, p);
    const [data, stat] = await Promise.all([fs.readFile(abs), fs.stat(abs)]);
    files.push({ path: p, mode: stat.mode & 0o777, dataB64: data.toString('base64') });
  }
  const archive: PackedArchive = { version: 1, files };
  const json = Buffer.from(JSON.stringify(archive), 'utf8');
  return gzipSync(json);
}

export async function unpackDir(targetDir: string, packed: Buffer): Promise<void> {
  const json = gunzipSync(packed).toString('utf8');
  const archive = JSON.parse(json) as PackedArchive;
  if (archive.version !== 1) {
    throw new Error(`unsupported archive version: ${String(archive.version)}`);
  }
  await fs.mkdir(targetDir, { recursive: true, mode: 0o700 });
  for (const f of archive.files) {
    const abs = path.join(targetDir, f.path);
    await fs.mkdir(path.dirname(abs), { recursive: true, mode: 0o700 });
    await fs.writeFile(abs, Buffer.from(f.dataB64, 'base64'), { mode: f.mode });
  }
}
