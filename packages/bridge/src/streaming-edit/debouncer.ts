/**
 * Debouncer — trailing-edge timer with latest-value-wins semantics.
 *
 * `push(text)` overwrites the pending text; the timer fires once after
 * `delayMs` of quiet with the most-recent pushed text. Callers that
 * want append semantics pass the full accumulated text each push.
 *
 * Terminal events (DECISION 2) call `flush()` for an immediate fire
 * that bypasses the timer. `dispose()` cancels and shreds pending
 * state.
 */

import type { Timers } from './types.js';

const DEFAULT_TIMERS: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export interface DebouncerOptions {
  readonly delayMs: number;
  readonly onFlush: (text: string) => Promise<void>;
  readonly timers?: Timers;
}

export class Debouncer {
  readonly #delayMs: number;
  readonly #onFlush: (text: string) => Promise<void>;
  readonly #timers: Timers;
  /** Latest text pushed since the last flush. null = nothing pending. */
  #pending: string | null = null;
  #handle: unknown = null;
  #disposed = false;
  #inflight: Promise<void> | null = null;

  constructor(opts: DebouncerOptions) {
    this.#delayMs = opts.delayMs;
    this.#onFlush = opts.onFlush;
    this.#timers = opts.timers ?? DEFAULT_TIMERS;
  }

  /**
   * Replace pending text + reset timer.
   *
   * `delayMsOverride` temporarily uses a longer/shorter delay for JUST
   * this arming — used by the session for rate-limit backoff
   * (effective-delay = baseDelayMs × rateMultiplier, optionally clamped
   * to `retryAfterMs`). Omit to use the default `delayMs`.
   *
   * Contract: the onFlush callback is responsible for catching every
   * exception it cares about. `#fire()` wraps the call with `void` so
   * any unhandled rejection is absorbed — this avoids spurious
   * unhandledRejection noise on timer-driven fires where there's no
   * caller frame to propagate to.
   */
  push(text: string, delayMsOverride?: number): void {
    if (this.#disposed) return;
    this.#pending = text;
    if (this.#handle !== null) this.#timers.clearTimeout(this.#handle);
    const delay = typeof delayMsOverride === 'number' ? delayMsOverride : this.#delayMs;
    this.#handle = this.#timers.setTimeout(() => {
      this.#handle = null;
      void this.#fire();
    }, delay);
    // `void this.#fire()` intentional: setTimeout can't `await`, so an
    // unhandled rejection would bubble to Node's unhandledRejection
    // handler. Callers rely on onFlush catching its own errors; we
    // absorb stragglers to keep the event loop clean.
  }

  /** Fire IMMEDIATELY with the pending text. Idempotent when idle. */
  async flush(): Promise<void> {
    if (this.#disposed) return;
    if (this.#handle !== null) {
      this.#timers.clearTimeout(this.#handle);
      this.#handle = null;
    }
    await this.#fire();
  }

  /** No pending text + no timer. */
  idle(): boolean {
    return this.#handle === null && this.#pending === null;
  }

  /** Cancel + drop pending; block future pushes; await in-flight fire. */
  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#handle !== null) {
      this.#timers.clearTimeout(this.#handle);
      this.#handle = null;
    }
    this.#pending = null;
    if (this.#inflight) {
      try {
        await this.#inflight;
      } catch {
        /* absorb — caller already handled */
      }
    }
  }

  async #fire(): Promise<void> {
    if (this.#pending === null) return;
    const text = this.#pending;
    this.#pending = null;
    this.#inflight = this.#onFlush(text).finally(() => {
      this.#inflight = null;
    });
    await this.#inflight;
  }
}
