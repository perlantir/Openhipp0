import { describe, expect, it } from 'vitest';

import { humanMouseCurve, humanScrollProfile, readingPauseMs } from '../../src/stealth/behavior-engine.js';

describe('behavior-engine', () => {
  it('produces a monotonic-time mouse curve with configurable step count', () => {
    const curve = humanMouseCurve({ x: 0, y: 0 }, { x: 100, y: 50 }, { steps: 10, durationMs: 200, seed: 'fixed' });
    expect(curve).toHaveLength(11);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!.tMs).toBeGreaterThanOrEqual(curve[i - 1]!.tMs);
    }
    // Starts at origin, ends near target
    expect(curve[0]!.x).toBe(0);
    expect(curve[curve.length - 1]!.x).toBeCloseTo(100, 5);
  });

  it('seeded curves are deterministic', () => {
    const a = humanMouseCurve({ x: 0, y: 0 }, { x: 200, y: 80 }, { seed: 'seed' });
    const b = humanMouseCurve({ x: 0, y: 0 }, { x: 200, y: 80 }, { seed: 'seed' });
    expect(a).toEqual(b);
  });

  it('readingPauseMs scales with char count and jitters within ±20%', () => {
    const base = readingPauseMs({ chars: 500, wpm: 250 });
    const short = readingPauseMs({ chars: 50, wpm: 250 });
    expect(base).toBeGreaterThan(short);
    expect(base).toBeGreaterThan(200);
  });

  it('humanScrollProfile returns steps summing to roughly totalDeltaY', () => {
    const p = humanScrollProfile(1000, 'x');
    const sum = p.steps.reduce((acc, s) => acc + s.deltaY, 0);
    expect(Math.abs(sum - 1000)).toBeLessThanOrEqual(3);
    expect(p.stepCount).toBeGreaterThan(2);
  });

  it('handles negative scroll (upward)', () => {
    const p = humanScrollProfile(-500, 'y');
    expect(p.steps.every((s) => s.deltaY <= 0)).toBe(true);
  });
});
