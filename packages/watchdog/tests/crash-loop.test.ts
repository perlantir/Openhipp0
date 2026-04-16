import { describe, expect, it } from 'vitest';
import { CrashLoopDetector } from '../src/index.js';

describe('CrashLoopDetector', () => {
  it('emits crash_loop when threshold is reached within window', () => {
    const now = 0;
    const detector = new CrashLoopDetector({ threshold: 3, windowMs: 1000 }, () => now);
    const counts: number[] = [];
    detector.on('crash_loop', (e) => counts.push(e.count));

    detector.record('exception', new Error('a'));
    detector.record('rejection', new Error('b'));
    expect(counts).toEqual([]);
    detector.record('exception', new Error('c'));
    expect(counts).toEqual([3]);
  });

  it('does not trip when events are spread beyond the window', () => {
    let now = 0;
    const detector = new CrashLoopDetector({ threshold: 3, windowMs: 1000 }, () => now);
    const events: unknown[] = [];
    detector.on('crash_loop', (e) => events.push(e));

    detector.record('exception', new Error('1'));
    now += 600;
    detector.record('exception', new Error('2'));
    now += 600; // first event now outside the 1000ms window
    detector.record('exception', new Error('3'));
    expect(events).toEqual([]);
  });

  it('only trips once until reset()', () => {
    const now = 0;
    const detector = new CrashLoopDetector({ threshold: 2, windowMs: 1000 }, () => now);
    let trips = 0;
    detector.on('crash_loop', () => trips++);

    detector.record('exception', new Error('a'));
    detector.record('exception', new Error('b'));
    detector.record('exception', new Error('c'));
    expect(trips).toBe(1);
    expect(detector.isTripped()).toBe(true);

    detector.reset();
    expect(detector.isTripped()).toBe(false);
    detector.record('exception', new Error('d'));
    detector.record('exception', new Error('e'));
    expect(trips).toBe(2);
  });

  it('emits uncaught_exception on every record() with the original error', () => {
    const detector = new CrashLoopDetector({ threshold: 5, windowMs: 1000 });
    const seen: { kind: string; err: unknown }[] = [];
    detector.on('uncaught_exception', (e) => seen.push({ kind: e.kind, err: e.error }));

    const err1 = new Error('x');
    detector.record('exception', err1);
    detector.record('rejection', 'y');
    expect(seen).toEqual([
      { kind: 'exception', err: err1 },
      { kind: 'rejection', err: 'y' },
    ]);
  });

  it('start/stop attach + detach process listeners cleanly', () => {
    const before = process.listenerCount('uncaughtException');
    const beforeRej = process.listenerCount('unhandledRejection');
    const detector = new CrashLoopDetector();
    detector.start();
    expect(process.listenerCount('uncaughtException')).toBe(before + 1);
    expect(process.listenerCount('unhandledRejection')).toBe(beforeRej + 1);
    detector.start(); // idempotent
    expect(process.listenerCount('uncaughtException')).toBe(before + 1);
    detector.stop();
    expect(process.listenerCount('uncaughtException')).toBe(before);
    expect(process.listenerCount('unhandledRejection')).toBe(beforeRej);
    detector.stop(); // idempotent
  });

  it('rejects invalid config', () => {
    expect(() => new CrashLoopDetector({ threshold: 0 })).toThrow(RangeError);
    expect(() => new CrashLoopDetector({ windowMs: 0 })).toThrow(RangeError);
  });
});
