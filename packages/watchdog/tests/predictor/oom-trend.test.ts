import { describe, expect, it } from 'vitest';
import { OomTrendPredictor, type HeapSample } from '../../src/index.js';

const sample = (t: number, fraction: number): HeapSample => ({
  usedBytes: Math.round(fraction * 1000),
  limitBytes: 1000,
  fraction,
  takenAt: t,
});

describe('OomTrendPredictor', () => {
  it('emits oom_predicted when slope is positive and crossing is within horizon', () => {
    let now = 0;
    const predictor = new OomTrendPredictor(
      { windowMs: 1_000_000, horizonMs: 1_000_000, minSamples: 5 },
      () => now,
    );
    const events: number[] = [];
    predictor.on('oom_predicted', (e) => events.push(e.inMs));

    // Linear ramp from 0.50 to 0.90 over 5 samples, 100ms apart.
    // Slope = 0.40 / 400ms = 0.001/ms; intercept = 0.50.
    // tCross = (1 - 0.5) / 0.001 = 500ms (absolute time).
    // At now=400 (last sample), inMs = 100.
    for (let i = 0; i < 5; i++) {
      now = i * 100;
      predictor.feed(sample(now, 0.5 + i * 0.1));
    }
    expect(events.length).toBe(1);
    expect(events[0]!).toBeCloseTo(100, -1);
  });

  it('does not emit when slope is non-positive (memory stable or shrinking)', () => {
    let now = 0;
    const predictor = new OomTrendPredictor(
      { windowMs: 1_000_000, horizonMs: 1_000_000, minSamples: 5 },
      () => now,
    );
    const events: unknown[] = [];
    predictor.on('oom_predicted', (e) => events.push(e));
    for (let i = 0; i < 5; i++) {
      now = i * 100;
      predictor.feed(sample(now, 0.7));
    }
    expect(events).toEqual([]);
  });

  it('does not emit when crossing falls beyond the horizon', () => {
    let now = 0;
    const predictor = new OomTrendPredictor(
      { windowMs: 1_000_000, horizonMs: 200, minSamples: 5 },
      () => now,
    );
    const events: unknown[] = [];
    predictor.on('oom_predicted', (e) => events.push(e));
    // Slow ramp: 0.50 → 0.54 over 400ms; tCross ≈ 5000ms; horizon 200ms.
    for (let i = 0; i < 5; i++) {
      now = i * 100;
      predictor.feed(sample(now, 0.5 + i * 0.01));
    }
    expect(events).toEqual([]);
  });

  it('throttles repeat emissions', () => {
    let now = 0;
    const predictor = new OomTrendPredictor(
      { windowMs: 1_000_000, horizonMs: 1_000_000, minSamples: 3 },
      () => now,
    );
    const events: unknown[] = [];
    predictor.on('oom_predicted', (e) => events.push(e));

    for (let i = 0; i < 3; i++) {
      now = i * 100;
      predictor.feed(sample(now, 0.5 + i * 0.1));
    }
    expect(events.length).toBe(1);
    // Add more samples — throttled.
    now += 50;
    predictor.feed(sample(now, 0.85));
    expect(events.length).toBe(1);
  });

  it('rejects invalid config', () => {
    expect(() => new OomTrendPredictor({ windowMs: 0 })).toThrow(RangeError);
    expect(() => new OomTrendPredictor({ horizonMs: 0 })).toThrow(RangeError);
    expect(() => new OomTrendPredictor({ minSamples: 1 })).toThrow(RangeError);
  });

  it('reset() drops samples and lastEmitAt', () => {
    let now = 0;
    const predictor = new OomTrendPredictor(
      { windowMs: 1_000_000, horizonMs: 1_000_000, minSamples: 3 },
      () => now,
    );
    let events = 0;
    predictor.on('oom_predicted', () => events++);

    for (let i = 0; i < 3; i++) {
      now = i * 100;
      predictor.feed(sample(now, 0.5 + i * 0.1));
    }
    expect(events).toBe(1);

    predictor.reset();
    for (let i = 0; i < 3; i++) {
      now += 100;
      predictor.feed(sample(now, 0.5 + i * 0.1));
    }
    expect(events).toBe(2);
  });
});
