/**
 * V8 heap monitor. Samples used-heap / heap-size-limit at a configurable
 * interval and emits a 'memory_pressure' event when usage crosses the
 * warn / critical / fatal thresholds.
 *
 * Hysteresis: only re-emits when the level transitions UP (or after dropping
 * below `warn` and re-crossing). Prevents flooding the event bus when usage
 * sits exactly at a threshold.
 *
 * Production heap source uses v8.getHeapStatistics(); tests inject a fake.
 */

import { EventEmitter } from 'node:events';
import * as v8 from 'node:v8';
import {
  DEFAULT_MEMORY_THRESHOLDS,
  type HeapMonitorConfig,
  type HeapSample,
  type HeapSource,
  type MemoryThresholds,
  type PressureLevel,
} from './types.js';

/** The default in-process heap source. */
export const defaultHeapSource: HeapSource = () => {
  const stats = v8.getHeapStatistics();
  const usedBytes = stats.used_heap_size;
  const limitBytes = stats.heap_size_limit;
  return {
    usedBytes,
    limitBytes,
    fraction: limitBytes > 0 ? usedBytes / limitBytes : 0,
    takenAt: Date.now(),
  };
};

export class HeapMonitor extends EventEmitter {
  private readonly thresholds: MemoryThresholds;
  private readonly intervalMs: number;
  private readonly source: HeapSource;
  private timer: ReturnType<typeof setInterval> | undefined;
  private currentLevel: PressureLevel | null = null;

  constructor(config: HeapMonitorConfig = {}, source: HeapSource = defaultHeapSource) {
    super();
    this.thresholds = { ...DEFAULT_MEMORY_THRESHOLDS, ...config.thresholds };
    this.intervalMs = config.intervalMs ?? 5_000;
    this.source = source;
    if (
      !(this.thresholds.warn > 0) ||
      !(this.thresholds.warn < this.thresholds.critical) ||
      !(this.thresholds.critical < this.thresholds.fatal) ||
      !(this.thresholds.fatal <= 1)
    ) {
      throw new RangeError('thresholds: 0 < warn < critical < fatal <= 1');
    }
    if (!(this.intervalMs > 0)) {
      throw new RangeError('intervalMs must be > 0');
    }
  }

  start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Sample once. Returns the raw HeapSample without classification. */
  sample(): HeapSample {
    return this.source();
  }

  /**
   * Sample once and emit 'memory_pressure' if a higher level is crossed.
   * Public so callers (and tests) can drive a single tick on demand.
   */
  tick(): void {
    const sample = this.source();
    const level = this.classify(sample.fraction);
    if (level === null) {
      this.currentLevel = null;
      return;
    }
    if (this.currentLevel === null || rank(level) > rank(this.currentLevel)) {
      this.currentLevel = level;
      this.emit('memory_pressure', { level, sample });
    }
  }

  private classify(fraction: number): PressureLevel | null {
    if (fraction >= this.thresholds.fatal) return 'fatal';
    if (fraction >= this.thresholds.critical) return 'critical';
    if (fraction >= this.thresholds.warn) return 'warn';
    return null;
  }
}

function rank(level: PressureLevel): 1 | 2 | 3 {
  return level === 'warn' ? 1 : level === 'critical' ? 2 : 3;
}
