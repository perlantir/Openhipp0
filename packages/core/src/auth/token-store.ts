/**
 * TokenStore implementations:
 *
 *   - `inMemoryTokenStore()` — tests + short-lived processes
 *   - `fileTokenStore(baseDir)` — one JSON file per account under
 *     `~/.hipp0/auth/<providerId>__<account>.json` with 0o600 perms
 *
 * Both honor the TokenStore contract. Encryption at rest is the operator's
 * job (encrypted volume / KMS-wrapped secrets) — storing tokens in
 * plaintext on a 0600 file matches what `gh auth`, `gcloud auth`, and
 * similar CLIs do.
 */

import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { OAuth2TokenSet, TokenStore } from './types.js';

export function inMemoryTokenStore(): TokenStore {
  const map = new Map<string, OAuth2TokenSet>();
  const k = (p: string, a: string): string => `${p}__${a}`;
  return {
    async get(p, a) {
      return map.get(k(p, a)) ?? null;
    },
    async set(p, a, tokens) {
      map.set(k(p, a), tokens);
    },
    async delete(p, a) {
      return map.delete(k(p, a));
    },
    async list() {
      return Array.from(map.keys()).map((key) => {
        const idx = key.indexOf('__');
        return { providerId: key.slice(0, idx), account: key.slice(idx + 2) };
      });
    },
  };
}

export interface FileTokenStoreOptions {
  /** Directory holding the token files. Default ~/.hipp0/auth/. */
  baseDir?: string;
}

export function fileTokenStore(opts: FileTokenStoreOptions = {}): TokenStore {
  const baseDir = resolve(opts.baseDir ?? join(homedir(), '.hipp0', 'auth'));
  const fileFor = (p: string, a: string): string =>
    join(baseDir, `${sanitize(p)}__${sanitize(a)}.json`);

  async function ensureDir(): Promise<void> {
    await mkdir(baseDir, { recursive: true, mode: 0o700 }).catch(() => undefined);
  }

  return {
    async get(p, a) {
      try {
        const raw = await readFile(fileFor(p, a), 'utf8');
        return JSON.parse(raw) as OAuth2TokenSet;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    async set(p, a, tokens) {
      await ensureDir();
      const target = fileFor(p, a);
      await writeFile(target, JSON.stringify(tokens, null, 2), 'utf8');
      await chmod(target, 0o600).catch(() => undefined);
    },
    async delete(p, a) {
      try {
        await rm(fileFor(p, a));
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw err;
      }
    },
    async list() {
      try {
        const files = await readdir(baseDir);
        return files
          .filter((f) => f.endsWith('.json'))
          .map((f) => {
            const name = f.slice(0, -'.json'.length);
            const idx = name.indexOf('__');
            if (idx < 0) return null;
            return { providerId: name.slice(0, idx), account: name.slice(idx + 2) };
          })
          .filter((x): x is { providerId: string; account: string } => !!x);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
      }
    },
  };
}

function sanitize(s: string): string {
  return s.replace(/[^\w.-]/g, '_');
}
