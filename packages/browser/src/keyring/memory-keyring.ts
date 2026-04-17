/**
 * In-memory keyring for tests + ephemeral environments. Not persistent.
 */

import type { Keyring, KeyringEntry } from './types.js';

function keyOf(e: KeyringEntry): string {
  return `${e.service}::${e.account}`;
}

export class MemoryKeyring implements Keyring {
  readonly backend = 'memory' as const;
  readonly #store = new Map<string, string>();

  async set(entry: KeyringEntry, secret: string): Promise<void> {
    this.#store.set(keyOf(entry), secret);
  }
  async get(entry: KeyringEntry): Promise<string | null> {
    return this.#store.get(keyOf(entry)) ?? null;
  }
  async remove(entry: KeyringEntry): Promise<void> {
    this.#store.delete(keyOf(entry));
  }
}
