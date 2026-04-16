/**
 * Crash-loop detector. Counts uncaughtException + unhandledRejection events
 * in a sliding time window; emits 'crash_loop' when the count crosses a
 * threshold so the watchdog can trip safe mode.
 *
 * Per Phase 4 design: in-process. We do NOT call process.exit. The detector
 * announces "I'm thrashing"; the outer process manager (Phase 7+ CLI / systemd
 * / Docker restart policy) decides whether to actually restart.
 *
 * Tripping is a one-shot until reset(): we don't want to spam crash_loop
 * events on every additional failure once safe mode is already active.
 */

import { EventEmitter } from 'node:events';
import type { CrashLoopConfig, UncaughtKind } from './types.js';

interface UncaughtRecord {
  at: number;
  kind: UncaughtKind;
  error: unknown;
}

export class CrashLoopDetector extends EventEmitter {
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly events: UncaughtRecord[] = [];
  private readonly now: () => number;
  private exceptionHandler: ((err: Error) => void) | undefined;
  private rejectionHandler: ((reason: unknown) => void) | undefined;
  private tripped = false;

  constructor(config: CrashLoopConfig = {}, now: () => number = Date.now) {
    super();
    this.threshold = config.threshold ?? 5;
    this.windowMs = config.windowMs ?? 60_000;
    if (!(this.threshold >= 1)) throw new RangeError('threshold must be >= 1');
    if (!(this.windowMs > 0)) throw new RangeError('windowMs must be > 0');
    this.now = now;
  }

  /** Attach process-level uncaughtException + unhandledRejection listeners. */
  start(): void {
    if (this.exceptionHandler) return;
    this.exceptionHandler = (err) => this.record('exception', err);
    this.rejectionHandler = (reason) => this.record('rejection', reason);
    process.on('uncaughtException', this.exceptionHandler);
    process.on('unhandledRejection', this.rejectionHandler);
  }

  stop(): void {
    if (this.exceptionHandler) {
      process.off('uncaughtException', this.exceptionHandler);
      this.exceptionHandler = undefined;
    }
    if (this.rejectionHandler) {
      process.off('unhandledRejection', this.rejectionHandler);
      this.rejectionHandler = undefined;
    }
    this.events.length = 0;
    this.tripped = false;
  }

  /**
   * Inject an uncaught event. Public so tests + custom adapters can drive
   * the detector without going through `process` listeners.
   */
  record(kind: UncaughtKind, error: unknown): void {
    const at = this.now();
    this.events.push({ at, kind, error });
    this.emit('uncaught_exception', { kind, error });
    this.evictExpired(at);
    if (!this.tripped && this.events.length >= this.threshold) {
      this.tripped = true;
      this.emit('crash_loop', { count: this.events.length, windowMs: this.windowMs });
    }
  }

  /** Reset the tripped flag and event history (e.g. after manual recovery). */
  reset(): void {
    this.tripped = false;
    this.events.length = 0;
  }

  isTripped(): boolean {
    return this.tripped;
  }

  private evictExpired(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.events.length > 0 && this.events[0]!.at < cutoff) {
      this.events.shift();
    }
  }
}
