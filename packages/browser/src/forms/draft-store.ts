/**
 * Per-form draft store: persists in-progress form values so a crash or
 * navigation doesn't lose what's been typed. Keyed by `signature`, scoped
 * by URL. Plain JSON on disk; no encryption — drafts don't contain
 * the whole profile cookie jar, but callers can layer their own
 * encryption via the `encrypt` / `decrypt` hooks.
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type { FormDraft } from './types.js';

export interface DraftStoreOptions {
  readonly root?: string;
  readonly encrypt?: (plaintext: string) => Promise<string> | string;
  readonly decrypt?: (ciphertext: string) => Promise<string> | string;
  readonly now?: () => string;
}

function defaultRoot(): string {
  const home = process.env['HIPP0_HOME'];
  const base = home && home.length > 0 ? home : path.join(homedir(), '.hipp0');
  return path.join(base, 'form-drafts');
}

export class DraftStore {
  readonly #root: string;
  readonly #encrypt: DraftStoreOptions['encrypt'];
  readonly #decrypt: DraftStoreOptions['decrypt'];
  readonly #now: () => string;

  constructor(opts: DraftStoreOptions = {}) {
    this.#root = opts.root ?? defaultRoot();
    this.#encrypt = opts.encrypt;
    this.#decrypt = opts.decrypt;
    this.#now = opts.now ?? (() => new Date().toISOString());
  }

  #keyFile(signature: string): string {
    return path.join(this.#root, `${signature}.json`);
  }

  async save(signature: string, url: string, values: Record<string, string>): Promise<void> {
    await fs.mkdir(this.#root, { recursive: true, mode: 0o700 });
    const draft: FormDraft = { signature, url, values: { ...values }, savedAt: this.#now() };
    const plaintext = JSON.stringify(draft, null, 2);
    const toWrite = this.#encrypt ? await this.#encrypt(plaintext) : plaintext;
    await fs.writeFile(this.#keyFile(signature), toWrite, { mode: 0o600 });
  }

  async load(signature: string): Promise<FormDraft | null> {
    try {
      const raw = await fs.readFile(this.#keyFile(signature), 'utf8');
      const plaintext = this.#decrypt ? await this.#decrypt(raw) : raw;
      return JSON.parse(plaintext) as FormDraft;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async clear(signature: string): Promise<void> {
    await fs.rm(this.#keyFile(signature), { force: true });
  }

  async list(): Promise<readonly string[]> {
    try {
      const entries = await fs.readdir(this.#root);
      return entries.filter((e) => e.endsWith('.json')).map((e) => e.replace(/\.json$/, ''));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }
}
