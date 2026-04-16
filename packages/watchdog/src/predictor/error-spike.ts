/**
 * ErrorSpikeDetector — sliding-window error-rate monitor. Callers push every
 * outcome (success or error) via record(); the detector emits 'error_spike'
 * when the failure fraction within the window crosses a threshold.
 *
 * Uses an absolute floor (`minRecords`) to avoid panicking on small samples
 * (1 error out of 2 attempts isn't a "spike", it's noise).
 *
 * Throttles to one emit per window to prevent storming.
 */

import { EventEmitter } from 'node:events';

export interface ErrorSpikeConfig {
  /** Sliding window in ms. Default 60_000. */
  windowMs?: number;
  /** Minimum records in window before evaluation runs. Default 10. */
  minRecords?: number;
  /** Failure fraction at which to emit. Default 0.5. */
  threshold?: number;
}

export interface ErrorSpikeEvent {
  fraction: number;
  failures: number;
  total: number;
  windowMs: number;
}

interface Record {
  at: number;
  ok: boolean;
}

export class ErrorSpikeDetector extends EventEmitter {
  private readonly windowMs: number;
  private readonly minRecords: number;
  private readonly threshold: number;
  private readonly records: Record[] = [];
  private readonly now: () => number;
  private lastEmitAt: number | null = null;

  constructor(config: ErrorSpikeConfig = {}, now: () => number = Date.now) {
    super();
    this.windowMs = config.windowMs ?? 60_000;
    this.minRecords = config.minRecords ?? 10;
    this.threshold = config.threshold ?? 0.5;
    this.now = now;
    if (!(this.windowMs > 0)) throw new RangeError('windowMs must be > 0');
    if (this.minRecords < 1) throw new RangeError('minRecords must be >= 1');
    if (!(this.threshold > 0) || !(this.threshold <= 1)) {
      throw new RangeError('threshold must be in (0, 1]');
    }
  }

  record(ok: boolean): void {
    const at = this.now();
    this.records.push({ at, ok });
    this.evict(at);
    this.evaluate();
  }

  reset(): void {
    this.records.length = 0;
    this.lastEmitAt = null;
  }

  private evict(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.records.length > 0 && this.records[0]!.at < cutoff) {
      this.records.shift();
    }
  }

  private evaluate(): void {
    if (this.records.length < this.minRecords) return;
    const failures = this.records.filter((r) => !r.ok).length;
    const fraction = failures / this.records.length;
    if (fraction < this.threshold) return;
    const now = this.now();
    if (this.lastEmitAt !== null && now - this.lastEmitAt < this.windowMs) return;
    this.lastEmitAt = now;
    this.emit('error_spike', {
      fraction,
      failures,
      total: this.records.length,
      windowMs: this.windowMs,
    });
  }
}
