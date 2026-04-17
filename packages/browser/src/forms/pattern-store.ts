/**
 * Long-lived pattern memory for forms. After a successful fill+submit, the
 * orchestrator records a `FormPattern` keyed by host + pathPrefix + signature.
 * Subsequent visits to a similar URL skip re-analysis and apply
 * `kindOverrides` to the freshly-detected form.
 *
 * Storage: single JSON ledger under `<root>/patterns.json` for atomicity.
 */

import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

import type { FormPattern } from './types.js';

export interface PatternStoreOptions {
  readonly root?: string;
  readonly now?: () => string;
}

function defaultRoot(): string {
  const home = process.env['HIPP0_HOME'];
  const base = home && home.length > 0 ? home : path.join(homedir(), '.hipp0');
  return path.join(base, 'form-patterns');
}

export class PatternStore {
  readonly #root: string;
  readonly #now: () => string;

  constructor(opts: PatternStoreOptions = {}) {
    this.#root = opts.root ?? defaultRoot();
    this.#now = opts.now ?? (() => new Date().toISOString());
  }

  #file(): string {
    return path.join(this.#root, 'patterns.json');
  }

  async #readAll(): Promise<FormPattern[]> {
    try {
      const raw = await fs.readFile(this.#file(), 'utf8');
      return JSON.parse(raw) as FormPattern[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async #writeAll(patterns: readonly FormPattern[]): Promise<void> {
    await fs.mkdir(this.#root, { recursive: true, mode: 0o700 });
    const tmp = path.join(this.#root, `patterns.json.tmp-${randomBytes(4).toString('hex')}`);
    await fs.writeFile(tmp, JSON.stringify(patterns, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.#file());
  }

  async find(host: string, urlPath: string, signature: string): Promise<FormPattern | null> {
    const all = await this.#readAll();
    // Prefer exact signature; fall back to host+prefix match.
    const exact = all.find((p) => p.signature === signature);
    if (exact) return exact;
    const prefixHits = all
      .filter((p) => p.host === host && urlPath.startsWith(p.pathPrefix))
      .sort((a, b) => b.pathPrefix.length - a.pathPrefix.length);
    return prefixHits[0] ?? null;
  }

  async recordSuccess(
    entry: Omit<FormPattern, 'timesConfirmed' | 'lastSeenAt'>,
  ): Promise<FormPattern> {
    const all = await this.#readAll();
    const idx = all.findIndex((p) => p.signature === entry.signature);
    const now = this.#now();
    let pattern: FormPattern;
    if (idx >= 0) {
      const prev = all[idx]!;
      pattern = {
        ...entry,
        timesConfirmed: prev.timesConfirmed + 1,
        lastSeenAt: now,
      };
      all[idx] = pattern;
    } else {
      pattern = { ...entry, timesConfirmed: 1, lastSeenAt: now };
      all.push(pattern);
    }
    await this.#writeAll(all);
    return pattern;
  }

  async list(): Promise<readonly FormPattern[]> {
    return this.#readAll();
  }

  async forget(signature: string): Promise<void> {
    const all = await this.#readAll();
    const filtered = all.filter((p) => p.signature !== signature);
    await this.#writeAll(filtered);
  }
}
