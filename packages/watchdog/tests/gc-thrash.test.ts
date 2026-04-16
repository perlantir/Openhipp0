import { describe, expect, it } from 'vitest';
import { GcThrashDetector } from '../src/index.js';

describe('GcThrashDetector', () => {
  it('emits gc_thrashing when GC time fraction exceeds threshold', () => {
    const now = 1_000_000;
    const detector = new GcThrashDetector({ windowMs: 1000, thrashFraction: 0.3 }, () => now);
    const fractions: number[] = [];
    detector.on('gc_thrashing', (e) => fractions.push(e.fraction));

    // 350ms of GC inside a 1000ms window → 0.35 fraction → trips.
    detector.feed({ startTime: now, duration: 200 });
    detector.feed({ startTime: now, duration: 150 });

    expect(fractions.length).toBe(1);
    expect(fractions[0]!).toBeCloseTo(0.35);
  });

  it('does not emit when GC fraction stays below threshold', () => {
    const now = 1_000_000;
    const detector = new GcThrashDetector({ windowMs: 1000, thrashFraction: 0.3 }, () => now);
    const events: unknown[] = [];
    detector.on('gc_thrashing', (e) => events.push(e));

    detector.feed({ startTime: now, duration: 100 });
    detector.feed({ startTime: now, duration: 100 });
    expect(events).toEqual([]);
  });

  it('throttles repeat emissions to one per window', () => {
    let now = 1_000_000;
    const detector = new GcThrashDetector({ windowMs: 1000, thrashFraction: 0.3 }, () => now);
    const trips: number[] = [];
    detector.on('gc_thrashing', () => trips.push(now));

    detector.feed({ startTime: now, duration: 400 });
    expect(trips.length).toBe(1);
    detector.feed({ startTime: now, duration: 400 });
    expect(trips.length).toBe(1); // throttled inside the same window
    now += 1001; // window elapsed
    detector.feed({ startTime: now, duration: 400 });
    expect(trips.length).toBe(2);
  });

  it('evicts entries that fall outside the sliding window', () => {
    let now = 1_000_000;
    const detector = new GcThrashDetector({ windowMs: 1000, thrashFraction: 0.3 }, () => now);
    const events: unknown[] = [];
    detector.on('gc_thrashing', (e) => events.push(e));

    detector.feed({ startTime: now, duration: 200 });
    now += 2000;
    // Old 200ms entry is now outside the window — fresh entry alone is below threshold.
    detector.feed({ startTime: now, duration: 200 });
    expect(events).toEqual([]);
  });

  it('rejects invalid config', () => {
    expect(() => new GcThrashDetector({ windowMs: 0 })).toThrow(RangeError);
    expect(() => new GcThrashDetector({ thrashFraction: 0 })).toThrow(RangeError);
    expect(() => new GcThrashDetector({ thrashFraction: 1.5 })).toThrow(RangeError);
  });

  it('start/stop is safe to call multiple times', () => {
    const detector = new GcThrashDetector();
    detector.start();
    detector.start();
    detector.stop();
    detector.stop();
  });
});
