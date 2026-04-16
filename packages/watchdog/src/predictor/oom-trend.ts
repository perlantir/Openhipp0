/**
 * OomTrendPredictor — fits a simple linear regression over a sliding window
 * of heap-fraction samples; emits 'oom_predicted' when the projection crosses
 * 1.0 within `horizonMs` (default 30 minutes per spec).
 *
 * Math: ordinary least squares on (t, fraction) pairs. The regression line
 * is `f(t) = slope * t + intercept`. Predicted-OOM time is the smallest `t`
 * where f(t) >= 1.0 — i.e. `t = (1 - intercept) / slope` for slope > 0.
 *
 * Conditions for emission:
 *   - At least `minSamples` samples (default 5) within the window.
 *   - Slope strictly positive (memory is climbing, not stable or shrinking).
 *   - Predicted crossing within `horizonMs` of `now`.
 *   - Throttled to one emit per `horizonMs / 4` to prevent storming.
 */

import { EventEmitter } from 'node:events';
import type { HeapSample } from '../types.js';

export interface OomTrendConfig {
  /** Sliding-window length for the regression in ms. Default 5 minutes. */
  windowMs?: number;
  /** Lookahead horizon for "predict OOM within X". Default 30 minutes. */
  horizonMs?: number;
  /** Minimum samples in window before regression runs. Default 5. */
  minSamples?: number;
}

interface Sample {
  t: number;
  fraction: number;
}

export interface OomPredictionEvent {
  /** Wall-clock time (ms epoch) at which the projection crosses 1.0. */
  predictedAt: number;
  /** ms from now until predicted crossing. */
  inMs: number;
  /** Slope of the regression (fraction per ms). */
  slope: number;
  /** Intercept of the regression. */
  intercept: number;
  /** Number of samples used. */
  samples: number;
}

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_HORIZON_MS = 30 * 60 * 1000;

export class OomTrendPredictor extends EventEmitter {
  private readonly windowMs: number;
  private readonly horizonMs: number;
  private readonly minSamples: number;
  private readonly samples: Sample[] = [];
  private readonly now: () => number;
  private lastEmitAt: number | null = null;

  constructor(config: OomTrendConfig = {}, now: () => number = Date.now) {
    super();
    this.windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;
    this.horizonMs = config.horizonMs ?? DEFAULT_HORIZON_MS;
    this.minSamples = config.minSamples ?? 5;
    this.now = now;
    if (!(this.windowMs > 0)) throw new RangeError('windowMs must be > 0');
    if (!(this.horizonMs > 0)) throw new RangeError('horizonMs must be > 0');
    if (this.minSamples < 2) throw new RangeError('minSamples must be >= 2');
  }

  /** Feed a heap sample (typically wired from HeapMonitor.tick). */
  feed(sample: HeapSample): void {
    this.samples.push({ t: sample.takenAt, fraction: sample.fraction });
    this.evict();
    this.evaluate();
  }

  /** Drop the change-tracking history. */
  reset(): void {
    this.samples.length = 0;
    this.lastEmitAt = null;
  }

  private evict(): void {
    const cutoff = this.now() - this.windowMs;
    while (this.samples.length > 0 && this.samples[0]!.t < cutoff) {
      this.samples.shift();
    }
  }

  private evaluate(): void {
    if (this.samples.length < this.minSamples) return;
    const { slope, intercept } = leastSquares(this.samples);
    if (!(slope > 0)) return;
    const tCross = (1 - intercept) / slope;
    const now = this.now();
    const inMs = tCross - now;
    if (inMs <= 0 || inMs > this.horizonMs) return;
    if (this.lastEmitAt !== null && now - this.lastEmitAt < this.horizonMs / 4) return;
    this.lastEmitAt = now;
    const event: OomPredictionEvent = {
      predictedAt: tCross,
      inMs,
      slope,
      intercept,
      samples: this.samples.length,
    };
    this.emit('oom_predicted', event);
  }
}

/** OLS regression. Returns slope and intercept of the best-fit line. */
function leastSquares(points: readonly Sample[]): { slope: number; intercept: number } {
  const n = points.length;
  let sumT = 0;
  let sumF = 0;
  let sumTT = 0;
  let sumTF = 0;
  for (const p of points) {
    sumT += p.t;
    sumF += p.fraction;
    sumTT += p.t * p.t;
    sumTF += p.t * p.fraction;
  }
  const denom = n * sumTT - sumT * sumT;
  if (denom === 0) return { slope: 0, intercept: sumF / n };
  const slope = (n * sumTF - sumT * sumF) / denom;
  const intercept = (sumF - slope * sumT) / n;
  return { slope, intercept };
}
