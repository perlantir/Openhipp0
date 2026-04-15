import { describe, expect, it, vi } from 'vitest';
import {
  BudgetEnforcer,
  computeCostUsd,
  getPrice,
  registerPrice,
} from '../../src/llm/cost-tracker.js';
import { Hipp0BudgetExceededError } from '../../src/llm/types.js';

describe('getPrice', () => {
  it('returns prices for known models', () => {
    expect(getPrice('anthropic', 'claude-sonnet-4-5')?.inputPerMillion).toBe(3);
    expect(getPrice('openai', 'gpt-4o-mini')?.outputPerMillion).toBe(0.6);
  });

  it('returns undefined for unknown models', () => {
    expect(getPrice('anthropic', 'claude-totally-made-up')).toBeUndefined();
  });
});

describe('registerPrice', () => {
  it('overrides an existing price', () => {
    registerPrice('anthropic', 'claude-sonnet-4-5', { inputPerMillion: 99, outputPerMillion: 99 });
    expect(getPrice('anthropic', 'claude-sonnet-4-5')?.inputPerMillion).toBe(99);
    // restore for other tests
    registerPrice('anthropic', 'claude-sonnet-4-5', { inputPerMillion: 3, outputPerMillion: 15 });
  });

  it('adds a new model', () => {
    registerPrice('openai', 'gpt-brand-new', { inputPerMillion: 7, outputPerMillion: 21 });
    expect(getPrice('openai', 'gpt-brand-new')).toEqual({
      inputPerMillion: 7,
      outputPerMillion: 21,
    });
  });
});

describe('computeCostUsd', () => {
  it('computes cost for a known Anthropic model', () => {
    // 1M input @ $3 + 500k output @ $15 = $3 + $7.5 = $10.5
    const cost = computeCostUsd('anthropic', 'claude-sonnet-4-5', 1_000_000, 500_000);
    expect(cost).toBeCloseTo(10.5);
  });

  it('computes cost for a known OpenAI model', () => {
    // 200k input @ $2.5 + 50k output @ $10 = $0.5 + $0.5 = $1.0
    const cost = computeCostUsd('openai', 'gpt-4o', 200_000, 50_000);
    expect(cost).toBeCloseTo(1.0);
  });

  it('ollama is always free', () => {
    expect(computeCostUsd('ollama', 'llama3', 10_000_000, 10_000_000)).toBe(0);
  });

  it('unknown model → returns 0 and invokes onUnknown', () => {
    const onUnknown = vi.fn();
    const cost = computeCostUsd('anthropic', 'claude-mystery', 1000, 1000, onUnknown);
    expect(cost).toBe(0);
    expect(onUnknown).toHaveBeenCalledWith('anthropic', 'claude-mystery');
  });

  it('zero tokens → zero cost', () => {
    expect(computeCostUsd('anthropic', 'claude-sonnet-4-5', 0, 0)).toBe(0);
  });
});

describe('BudgetEnforcer', () => {
  function makeClock(): { now: () => number; advance: (ms: number) => void } {
    let t = 1_700_000_000_000;
    return {
      now: () => t,
      advance: (ms) => {
        t += ms;
      },
    };
  }

  it('rejects invalid config', () => {
    expect(() => new BudgetEnforcer({ dailyLimitUsd: 0 })).toThrow(RangeError);
    expect(() => new BudgetEnforcer({ dailyLimitUsd: 10, alertAtPercent: 1.5 })).toThrow(
      RangeError,
    );
  });

  it('starts at zero current spend', () => {
    const be = new BudgetEnforcer({ dailyLimitUsd: 10 });
    expect(be.currentUsd()).toBe(0);
    expect(be.status().percentUsed).toBe(0);
  });

  it('records spend and accumulates total', () => {
    const be = new BudgetEnforcer({ dailyLimitUsd: 10 });
    be.record(1.5);
    be.record(2.25);
    expect(be.currentUsd()).toBeCloseTo(3.75);
  });

  it('willExceed reflects preflight check', () => {
    const be = new BudgetEnforcer({ dailyLimitUsd: 10 });
    be.record(8);
    expect(be.willExceed(1)).toBe(false);
    expect(be.willExceed(2.5)).toBe(true);
  });

  it('throws Hipp0BudgetExceededError when spend crosses limit', () => {
    const be = new BudgetEnforcer({ dailyLimitUsd: 10 });
    be.record(7);
    expect(() => be.record(4)).toThrow(Hipp0BudgetExceededError);
  });

  it('prunes entries older than 24h', () => {
    const clock = makeClock();
    const be = new BudgetEnforcer({ dailyLimitUsd: 10 }, clock.now);
    be.record(3);
    clock.advance(24 * 60 * 60 * 1000 + 1);
    expect(be.currentUsd()).toBe(0);
  });

  it('fires onAlert exactly once when crossing alert threshold', () => {
    const onAlert = vi.fn();
    const be = new BudgetEnforcer({ dailyLimitUsd: 10, alertAtPercent: 0.5 }, Date.now, onAlert);
    be.record(4);
    expect(onAlert).not.toHaveBeenCalled();
    be.record(2); // now 60% → alert
    expect(onAlert).toHaveBeenCalledTimes(1);
    be.record(1); // still over 50%, but already alerted
    expect(onAlert).toHaveBeenCalledTimes(1);
  });

  it('reset() clears state', () => {
    const be = new BudgetEnforcer({ dailyLimitUsd: 10 });
    be.record(5);
    be.reset();
    expect(be.currentUsd()).toBe(0);
  });

  it('negative spend is rejected', () => {
    const be = new BudgetEnforcer({ dailyLimitUsd: 10 });
    expect(() => be.record(-1)).toThrow(RangeError);
  });
});
