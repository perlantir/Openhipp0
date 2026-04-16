/**
 * GC thrashing detector. Maintains a sliding window of GC PerformanceEntry
 * durations; emits 'gc_thrashing' when total GC time / window length exceeds
 * a configurable fraction (default 0.30).
 *
 * Uses Node's built-in PerformanceObserver against the 'gc' entry type.
 * No `--expose-gc` flag required. If the runtime doesn't support GC entries
 * (rare; mostly bundlers / Deno-Node compat shims), we degrade quietly —
 * `feed()` still works for callers wiring a custom source.
 *
 * Throttling: at most one 'gc_thrashing' emit per `windowMs` to avoid event
 * storms while pressure persists.
 */

import { EventEmitter } from 'node:events';
import { PerformanceObserver } from 'node:perf_hooks';
import type { GcEntry, GcThrashConfig } from './types.js';

export class GcThrashDetector extends EventEmitter {
  private readonly windowMs: number;
  private readonly thrashFraction: number;
  private readonly entries: GcEntry[] = [];
  private observer: PerformanceObserver | undefined;
  private lastEmitAt = 0;
  private readonly now: () => number;

  constructor(config: GcThrashConfig = {}, now: () => number = Date.now) {
    super();
    this.windowMs = config.windowMs ?? 10_000;
    this.thrashFraction = config.thrashFraction ?? 0.3;
    if (!(this.windowMs > 0)) throw new RangeError('windowMs must be > 0');
    if (!(this.thrashFraction > 0) || !(this.thrashFraction <= 1)) {
      throw new RangeError('thrashFraction must be in (0, 1]');
    }
    this.now = now;
  }

  start(): void {
    if (this.observer) return;
    this.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'gc') {
          this.feed({ startTime: this.now(), duration: entry.duration });
        }
      }
    });
    try {
      this.observer.observe({ entryTypes: ['gc'], buffered: false });
    } catch {
      // GC entries unsupported here; leave observer detached so feed() still works.
      this.observer = undefined;
    }
  }

  stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = undefined;
    }
    this.entries.length = 0;
    this.lastEmitAt = 0;
  }

  /** Inject a GC entry. Public for tests + custom adapters. */
  feed(entry: GcEntry): void {
    this.entries.push(entry);
    this.evictExpired();
    this.evaluate();
  }

  private evictExpired(): void {
    const cutoff = this.now() - this.windowMs;
    while (this.entries.length > 0 && this.entries[0]!.startTime < cutoff) {
      this.entries.shift();
    }
  }

  private evaluate(): void {
    if (this.entries.length === 0) return;
    const gcMs = this.entries.reduce((s, e) => s + e.duration, 0);
    const fraction = gcMs / this.windowMs;
    if (fraction < this.thrashFraction) return;
    const now = this.now();
    if (now - this.lastEmitAt < this.windowMs) return; // throttle
    this.lastEmitAt = now;
    this.emit('gc_thrashing', { fraction, windowMs: this.windowMs, gcMs });
  }
}
