/**
 * Proxy rotation — strategies: round-robin, random, per-host sticky,
 * per-task. Operator supplies a pool of `ProxyEntry` values (user:pass
 * URLs, typically from a residential-proxy service); the rotator picks
 * one per `next()` call according to strategy.
 */

import type { ProxyEntry, ProxyRotationStrategy, ProxyRotatorState } from './types.js';

export interface NextContext {
  readonly host?: string;
  /** Unique id for a task (e.g. workflow run) — enables per-task stickiness. */
  readonly taskId?: string;
  readonly tags?: readonly string[];
}

export class ProxyRotator {
  readonly #pool: ProxyEntry[];
  readonly #strategy: ProxyRotationStrategy;
  #state: ProxyRotatorState;
  readonly #perTask = new Map<string, string>();
  readonly #rnd: () => number;

  constructor(
    pool: readonly ProxyEntry[],
    strategy: ProxyRotationStrategy = 'round-robin',
    initialState: ProxyRotatorState = {},
    rnd: () => number = Math.random,
  ) {
    this.#pool = [...pool];
    this.#strategy = strategy;
    this.#state = initialState;
    this.#rnd = rnd;
  }

  get size(): number {
    return this.#pool.length;
  }

  next(ctx: NextContext = {}): ProxyEntry | null {
    const filtered = ctx.tags
      ? this.#pool.filter((p) => ctx.tags!.every((t) => (p.tags ?? []).includes(t)))
      : this.#pool;
    if (filtered.length === 0) return null;

    if (this.#strategy === 'per-host' && ctx.host) {
      const sticky = this.#state.byHost?.[ctx.host];
      if (sticky) {
        const hit = filtered.find((p) => p.id === sticky);
        if (hit) return hit;
      }
      const pick = filtered[Math.floor(this.#rnd() * filtered.length)]!;
      this.#state = {
        ...this.#state,
        byHost: { ...(this.#state.byHost ?? {}), [ctx.host]: pick.id },
      };
      return pick;
    }

    if (this.#strategy === 'per-task' && ctx.taskId) {
      const sticky = this.#perTask.get(ctx.taskId);
      if (sticky) {
        const hit = filtered.find((p) => p.id === sticky);
        if (hit) return hit;
      }
      const pick = filtered[Math.floor(this.#rnd() * filtered.length)]!;
      this.#perTask.set(ctx.taskId, pick.id);
      return pick;
    }

    if (this.#strategy === 'random') {
      return filtered[Math.floor(this.#rnd() * filtered.length)]!;
    }

    // round-robin
    const idx = ((this.#state.nextIndex ?? 0) % filtered.length + filtered.length) % filtered.length;
    const pick = filtered[idx]!;
    this.#state = { ...this.#state, nextIndex: idx + 1, lastId: pick.id };
    return pick;
  }

  snapshot(): ProxyRotatorState {
    return { ...this.#state };
  }
}
