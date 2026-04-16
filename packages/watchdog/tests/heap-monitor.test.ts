import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeapMonitor, defaultHeapSource, type HeapSample } from '../src/index.js';

const sampleAt = (fraction: number): HeapSample => ({
  usedBytes: Math.round(fraction * 1_000_000),
  limitBytes: 1_000_000,
  fraction,
  takenAt: 0,
});

describe('HeapMonitor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits memory_pressure once per upward level transition', () => {
    const fractions = [0.5, 0.72, 0.74, 0.86, 0.97, 0.99];
    let i = 0;
    const monitor = new HeapMonitor({}, () => sampleAt(fractions[i++]!));
    const levels: string[] = [];
    monitor.on('memory_pressure', (e) => levels.push(e.level));

    for (let n = 0; n < fractions.length; n++) monitor.tick();

    expect(levels).toEqual(['warn', 'critical', 'fatal']);
  });

  it('does not emit again for the same level when usage stays steady', () => {
    let i = 0;
    const fractions = [0.72, 0.74, 0.73];
    const monitor = new HeapMonitor({}, () => sampleAt(fractions[i++]!));
    const levels: string[] = [];
    monitor.on('memory_pressure', (e) => levels.push(e.level));

    for (let n = 0; n < fractions.length; n++) monitor.tick();
    expect(levels).toEqual(['warn']);
  });

  it('re-emits warn after dropping below it and crossing back', () => {
    let i = 0;
    const fractions = [0.72, 0.5, 0.72];
    const monitor = new HeapMonitor({}, () => sampleAt(fractions[i++]!));
    const levels: string[] = [];
    monitor.on('memory_pressure', (e) => levels.push(e.level));

    for (let n = 0; n < fractions.length; n++) monitor.tick();
    expect(levels).toEqual(['warn', 'warn']);
  });

  it('rejects invalid threshold ordering', () => {
    expect(
      () => new HeapMonitor({ thresholds: { warn: 0.9, critical: 0.5, fatal: 0.95 } }),
    ).toThrow(RangeError);
    expect(() => new HeapMonitor({ thresholds: { warn: 0, critical: 0.5, fatal: 0.95 } })).toThrow(
      RangeError,
    );
    expect(
      () => new HeapMonitor({ thresholds: { warn: 0.7, critical: 0.85, fatal: 1.5 } }),
    ).toThrow(RangeError);
  });

  it('rejects intervalMs <= 0', () => {
    expect(() => new HeapMonitor({ intervalMs: 0 })).toThrow(RangeError);
  });

  it('start/stop are idempotent and unref the timer', () => {
    vi.useFakeTimers();
    const monitor = new HeapMonitor({ intervalMs: 100 }, () => sampleAt(0.1));
    monitor.start();
    monitor.start(); // idempotent
    vi.advanceTimersByTime(250);
    monitor.stop();
    monitor.stop(); // idempotent
  });

  it('start() ticks immediately so callers see the current level', () => {
    const monitor = new HeapMonitor({ intervalMs: 60_000 }, () => sampleAt(0.95));
    const events: string[] = [];
    monitor.on('memory_pressure', (e) => events.push(e.level));
    monitor.start();
    monitor.stop();
    expect(events).toEqual(['fatal']);
  });

  it('sample() returns a HeapSample from the source without emitting', () => {
    const monitor = new HeapMonitor({}, () => sampleAt(0.42));
    const events: string[] = [];
    monitor.on('memory_pressure', (e) => events.push(e.level));
    const s = monitor.sample();
    expect(s.fraction).toBe(0.42);
    expect(events).toEqual([]);
  });

  it('defaultHeapSource returns a sane sample from the live process', () => {
    const s = defaultHeapSource();
    expect(s.usedBytes).toBeGreaterThan(0);
    expect(s.limitBytes).toBeGreaterThan(0);
    expect(s.fraction).toBeGreaterThan(0);
    expect(s.fraction).toBeLessThan(1);
  });
});
