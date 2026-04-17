/**
 * Cross-tab shared state. Tabs read/write keys; watchers fire on change.
 * Intended for orchestrator patterns like "copy price from tab 1 to tab 2".
 *
 * In-memory only in G1-d — no persistence. Multi-process sharing is a
 * future extension via a pluggable `StateBackend`.
 */

import { EventEmitter } from 'node:events';

export type StateValue = string | number | boolean | null | readonly StateValue[] | { readonly [k: string]: StateValue };

export type StateWatcher = (key: string, value: StateValue, previous: StateValue | undefined) => void;

export class CrossTabState {
  readonly #state = new Map<string, StateValue>();
  readonly #emitter = new EventEmitter();

  get<T extends StateValue>(key: string): T | undefined {
    return this.#state.get(key) as T | undefined;
  }

  set(key: string, value: StateValue): void {
    const previous = this.#state.get(key);
    this.#state.set(key, value);
    this.#emitter.emit('change', key, value, previous);
    this.#emitter.emit(`change:${key}`, value, previous);
  }

  delete(key: string): void {
    const previous = this.#state.get(key);
    if (previous === undefined) return;
    this.#state.delete(key);
    this.#emitter.emit('change', key, null, previous);
    this.#emitter.emit(`change:${key}`, null, previous);
  }

  watch(watcher: StateWatcher): () => void {
    const fn = (key: string, value: StateValue, previous: StateValue | undefined): void => {
      watcher(key, value, previous);
    };
    this.#emitter.on('change', fn);
    return () => this.#emitter.off('change', fn);
  }

  watchKey(key: string, watcher: (value: StateValue, previous: StateValue | undefined) => void): () => void {
    const fn = (value: StateValue, previous: StateValue | undefined): void => {
      watcher(value, previous);
    };
    this.#emitter.on(`change:${key}`, fn);
    return () => this.#emitter.off(`change:${key}`, fn);
  }

  snapshot(): Readonly<Record<string, StateValue>> {
    return Object.fromEntries(this.#state);
  }
}
