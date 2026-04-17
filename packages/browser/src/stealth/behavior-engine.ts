/**
 * Behavior engine — deterministic-given-seed humanized interaction.
 *
 * All functions are pure; callers translate results into real
 * Playwright input calls.
 *
 * Mouse curves: cubic Bezier between start + end with a midpoint drift
 * so paths don't look robotic. Reading pauses: chars → ms via WPM +
 * jitter. Scroll: acceleration curve from 0 to full velocity then
 * decel back.
 */

import type { MouseCurvePoint, ReadingPauseInput } from './types.js';

/** Small seeded PRNG — xmur3 hash + mulberry32. Deterministic per-seed. */
function prng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MouseCurveOptions {
  readonly steps?: number;
  readonly durationMs?: number;
  readonly driftScale?: number;
  readonly seed?: string;
}

export function humanMouseCurve(
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: MouseCurveOptions = {},
): readonly MouseCurvePoint[] {
  const steps = Math.max(6, opts.steps ?? 24);
  const duration = Math.max(80, opts.durationMs ?? 320);
  const driftScale = opts.driftScale ?? 0.08;
  const rnd = prng(opts.seed ?? `${from.x},${from.y}->${to.x},${to.y}`);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const midDrift = {
    x: from.x + dx * 0.5 + (rnd() - 0.5) * Math.abs(dx) * driftScale,
    y: from.y + dy * 0.5 + (rnd() - 0.5) * Math.abs(dy) * driftScale,
  };
  const out: MouseCurvePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const omt = 1 - t;
    // Quadratic Bezier: (1-t)^2*P0 + 2(1-t)t*P1 + t^2*P2
    const x = omt * omt * from.x + 2 * omt * t * midDrift.x + t * t * to.x;
    const y = omt * omt * from.y + 2 * omt * t * midDrift.y + t * t * to.y;
    // Ease-in-out timing: time not linear in path length
    const tMs = duration * (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
    out.push({ x, y, tMs });
  }
  return out;
}

export function readingPauseMs(input: ReadingPauseInput, seed = 'reader'): number {
  const wpm = input.wpm ?? 250;
  const chars = Math.max(0, input.chars);
  // ~5 chars per word on average
  const words = chars / 5;
  const baseMs = (words / wpm) * 60_000;
  const rnd = prng(`${seed}|${chars}|${wpm}`);
  const jitter = (rnd() - 0.5) * baseMs * 0.4; // ±20 %
  return Math.max(200, Math.round(baseMs + jitter));
}

export interface ScrollProfile {
  readonly stepCount: number;
  readonly steps: readonly { deltaY: number; pauseMs: number }[];
}

export function humanScrollProfile(totalDeltaY: number, seed = 'scroll'): ScrollProfile {
  const dir = Math.sign(totalDeltaY) || 1;
  const abs = Math.abs(totalDeltaY);
  const stepCount = Math.max(4, Math.min(12, Math.round(abs / 180)));
  const rnd = prng(seed);
  const steps = [] as { deltaY: number; pauseMs: number }[];
  // Accel-hold-decel triangular distribution
  let remaining = abs;
  for (let i = 0; i < stepCount; i++) {
    const t = i / Math.max(1, stepCount - 1);
    const weight = t < 0.5 ? 2 * t : 2 - 2 * t; // 0 → 1 → 0
    const share = (weight + 0.3) * (abs / stepCount); // baseline + accel
    const jitter = share * (rnd() - 0.5) * 0.3;
    const delta = Math.max(1, Math.round(share + jitter));
    const applied = Math.min(delta, remaining);
    remaining -= applied;
    steps.push({ deltaY: dir * applied, pauseMs: 20 + Math.round(rnd() * 60) });
    if (remaining <= 0) break;
  }
  // flush any remaining delta into the last step
  if (remaining > 0 && steps.length > 0) {
    steps[steps.length - 1] = {
      deltaY: steps[steps.length - 1]!.deltaY + dir * remaining,
      pauseMs: steps[steps.length - 1]!.pauseMs,
    };
  }
  return { stepCount: steps.length, steps };
}
