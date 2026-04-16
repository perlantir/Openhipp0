import { describe, expect, it } from 'vitest';
import { ErrorSpikeDetector } from '../../src/index.js';

describe('ErrorSpikeDetector', () => {
  it('emits error_spike when failure fraction crosses threshold', () => {
    const now = 0;
    const detector = new ErrorSpikeDetector(
      { windowMs: 1000, minRecords: 5, threshold: 0.5 },
      () => now,
    );
    const events: number[] = [];
    detector.on('error_spike', (e) => events.push(e.fraction));

    // 3 ok, 5 err → trips when fraction first hits >= 0.5 (after the 3rd error).
    for (let i = 0; i < 3; i++) detector.record(true);
    for (let i = 0; i < 5; i++) detector.record(false);
    expect(events.length).toBe(1);
    expect(events[0]!).toBeGreaterThanOrEqual(0.5);
  });

  it('does not trip below minRecords', () => {
    const now = 0;
    const detector = new ErrorSpikeDetector(
      { windowMs: 1000, minRecords: 10, threshold: 0.5 },
      () => now,
    );
    const events: unknown[] = [];
    detector.on('error_spike', (e) => events.push(e));

    for (let i = 0; i < 5; i++) detector.record(false);
    expect(events).toEqual([]);
  });

  it('does not trip when fraction stays below threshold', () => {
    const now = 0;
    const detector = new ErrorSpikeDetector(
      { windowMs: 1000, minRecords: 5, threshold: 0.5 },
      () => now,
    );
    const events: unknown[] = [];
    detector.on('error_spike', (e) => events.push(e));
    for (let i = 0; i < 8; i++) detector.record(true);
    for (let i = 0; i < 2; i++) detector.record(false);
    expect(events).toEqual([]);
  });

  it('throttles within a window', () => {
    let now = 0;
    const detector = new ErrorSpikeDetector(
      { windowMs: 1000, minRecords: 2, threshold: 0.5 },
      () => now,
    );
    let count = 0;
    detector.on('error_spike', () => count++);
    detector.record(false);
    detector.record(false);
    expect(count).toBe(1);
    now += 100;
    detector.record(false);
    expect(count).toBe(1);
    now += 1000;
    detector.record(false);
    detector.record(false);
    expect(count).toBe(2);
  });

  it('evicts records outside the window', () => {
    let now = 0;
    const detector = new ErrorSpikeDetector(
      { windowMs: 1000, minRecords: 2, threshold: 0.5 },
      () => now,
    );
    const events: unknown[] = [];
    detector.on('error_spike', (e) => events.push(e));
    detector.record(false);
    now += 2000;
    detector.record(true); // alone, < minRecords
    expect(events).toEqual([]);
  });

  it('rejects invalid config', () => {
    expect(() => new ErrorSpikeDetector({ windowMs: 0 })).toThrow(RangeError);
    expect(() => new ErrorSpikeDetector({ minRecords: 0 })).toThrow(RangeError);
    expect(() => new ErrorSpikeDetector({ threshold: 0 })).toThrow(RangeError);
    expect(() => new ErrorSpikeDetector({ threshold: 1.5 })).toThrow(RangeError);
  });
});
