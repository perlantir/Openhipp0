import { describe, expect, it } from 'vitest';
import { estimateComplexity } from '../../src/planning/complexity.js';

describe('estimateComplexity', () => {
  it('returns shouldPlan=true on explicit user request', () => {
    const r = estimateComplexity('Please plan this out step-by-step.');
    expect(r.shouldPlan).toBe(true);
    expect(r.signals).toContain('explicit-request');
  });

  it('trivial ask → shouldPlan=false', () => {
    const r = estimateComplexity('what time is it');
    expect(r.shouldPlan).toBe(false);
  });

  it('2 imperatives alone are NOT enough', () => {
    const r = estimateComplexity('Deploy the app. Then test it.');
    expect(r.shouldPlan).toBe(false);
  });

  it('3+ imperatives + ordinal markers → shouldPlan=true', () => {
    const r = estimateComplexity(
      'First, configure the database. Then deploy the app. Next, run smoke tests. Finally, notify the team.',
    );
    expect(r.shouldPlan).toBe(true);
    expect(r.signals.some((s) => s.startsWith('imperatives'))).toBe(true);
    expect(r.signals.some((s) => s.startsWith('ordinal'))).toBe(true);
  });

  it('numbered list triggers ordinal signal', () => {
    const r = estimateComplexity(`
      1. Clone the repo
      2. Install deps
      3. Run tests
    `);
    expect(r.shouldPlan).toBe(true);
  });

  it('long descriptions without structure are still flagged', () => {
    const words = new Array(150).fill('word').join(' ');
    const r = estimateComplexity(words);
    expect(r.estimatedSubtasks).toBeGreaterThanOrEqual(3);
  });

  it('"break this down" is an explicit signal', () => {
    const r = estimateComplexity('please break this down into steps');
    expect(r.shouldPlan).toBe(true);
  });

  it('conservative: "write a haiku about databases" does not plan', () => {
    const r = estimateComplexity('write a haiku about databases');
    expect(r.shouldPlan).toBe(false);
  });
});
