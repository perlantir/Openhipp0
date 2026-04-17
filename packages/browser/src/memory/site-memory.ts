/**
 * Per-site memory store. One JSON ledger per host under
 * `<root>/<host>.json`. Lookups filter by host + pathPrefix + kinds +
 * tags. Supports reinforcement (increment confidence) and forget
 * (decrement to zero = remove).
 *
 * Integration with `@openhipp0/memory/decisions` is a hook:
 *   siteMemory.onWrite(note => decisionGraph.add(...))
 */

import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

import type { SiteMemoryQuery, SiteNote } from './types.js';

export type SiteMemoryEvent =
  | { kind: 'add'; note: SiteNote }
  | { kind: 'update'; note: SiteNote; previous: SiteNote }
  | { kind: 'remove'; id: string; host: string };

export type SiteMemoryListener = (event: SiteMemoryEvent) => void;

export interface SiteMemoryOptions {
  readonly root?: string;
  readonly now?: () => string;
}

function defaultRoot(): string {
  const home = process.env['HIPP0_HOME'];
  const base = home && home.length > 0 ? home : path.join(homedir(), '.hipp0');
  return path.join(base, 'site-memory');
}

function hostFilename(host: string): string {
  // Normalize and reject traversal / slashes.
  const clean = host.replace(/[^a-z0-9._-]/gi, '_');
  return `${clean}.json`;
}

export class SiteMemory {
  readonly #root: string;
  readonly #now: () => string;
  readonly #listeners = new Set<SiteMemoryListener>();

  constructor(opts: SiteMemoryOptions = {}) {
    this.#root = opts.root ?? defaultRoot();
    this.#now = opts.now ?? (() => new Date().toISOString());
  }

  on(listener: SiteMemoryListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event: SiteMemoryEvent): void {
    for (const l of this.#listeners) {
      try {
        l(event);
      } catch {
        /* listener errors never break writes */
      }
    }
  }

  async #readHost(host: string): Promise<SiteNote[]> {
    const file = path.join(this.#root, hostFilename(host));
    try {
      const raw = await fs.readFile(file, 'utf8');
      return JSON.parse(raw) as SiteNote[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async #writeHost(host: string, notes: readonly SiteNote[]): Promise<void> {
    await fs.mkdir(this.#root, { recursive: true, mode: 0o700 });
    const file = path.join(this.#root, hostFilename(host));
    const tmp = `${file}.tmp-${randomBytes(4).toString('hex')}`;
    await fs.writeFile(tmp, JSON.stringify(notes, null, 2), { mode: 0o600 });
    await fs.rename(tmp, file);
  }

  async add(
    entry: Omit<SiteNote, 'id' | 'createdAt' | 'reinforcements' | 'confidence'>,
  ): Promise<SiteNote> {
    const notes = await this.#readHost(entry.host);
    const note: SiteNote = {
      id: randomBytes(6).toString('hex'),
      createdAt: this.#now(),
      reinforcements: 0,
      confidence: 1,
      ...entry,
    };
    notes.push(note);
    await this.#writeHost(entry.host, notes);
    this.#emit({ kind: 'add', note });
    return note;
  }

  async query(q: SiteMemoryQuery): Promise<readonly SiteNote[]> {
    const notes = await this.#readHost(q.host);
    let filtered = notes;
    if (q.pathPrefix) filtered = filtered.filter((n) => !n.pathPrefix || q.pathPrefix!.startsWith(n.pathPrefix));
    if (q.kinds) filtered = filtered.filter((n) => q.kinds!.includes(n.kind));
    if (q.tags) {
      filtered = filtered.filter((n) => (n.tags ?? []).some((t) => q.tags!.includes(t)));
    }
    filtered = [...filtered].sort((a, b) => b.confidence - a.confidence || b.reinforcements - a.reinforcements);
    if (q.limit) filtered = filtered.slice(0, q.limit);
    return filtered;
  }

  async reinforce(host: string, id: string): Promise<SiteNote | null> {
    const notes = await this.#readHost(host);
    const idx = notes.findIndex((n) => n.id === id);
    if (idx < 0) return null;
    const prev = notes[idx]!;
    const next: SiteNote = { ...prev, reinforcements: prev.reinforcements + 1 };
    notes[idx] = next;
    await this.#writeHost(host, notes);
    this.#emit({ kind: 'update', note: next, previous: prev });
    return next;
  }

  async weaken(host: string, id: string): Promise<SiteNote | null> {
    const notes = await this.#readHost(host);
    const idx = notes.findIndex((n) => n.id === id);
    if (idx < 0) return null;
    const prev = notes[idx]!;
    if (prev.confidence <= 1) {
      notes.splice(idx, 1);
      await this.#writeHost(host, notes);
      this.#emit({ kind: 'remove', id, host });
      return null;
    }
    const next: SiteNote = { ...prev, confidence: prev.confidence - 1 };
    notes[idx] = next;
    await this.#writeHost(host, notes);
    this.#emit({ kind: 'update', note: next, previous: prev });
    return next;
  }

  async forget(host: string, id: string): Promise<void> {
    const notes = await this.#readHost(host);
    const next = notes.filter((n) => n.id !== id);
    await this.#writeHost(host, next);
    this.#emit({ kind: 'remove', id, host });
  }
}
