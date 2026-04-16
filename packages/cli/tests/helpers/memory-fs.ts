/**
 * In-memory FileSystem fake for tests. Matches the production FileSystem
 * interface so commands can be run without hitting disk.
 */

import path from 'node:path';
import type { FileSystem } from '../../src/config.js';

export function createMemoryFs(seed: Record<string, string> = {}): FileSystem & {
  files: Map<string, string>;
  dirs: Set<string>;
} {
  const files = new Map<string, string>(Object.entries(seed));
  const dirs = new Set<string>();
  for (const p of files.keys()) dirs.add(path.dirname(p));

  return {
    files,
    dirs,
    async readFile(p) {
      const v = files.get(p);
      if (v === undefined) {
        const err = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return v;
    },
    async writeFile(p, content) {
      files.set(p, content);
      dirs.add(path.dirname(p));
    },
    async mkdir(p) {
      dirs.add(p);
    },
    async exists(p) {
      return files.has(p) || dirs.has(p);
    },
  };
}
