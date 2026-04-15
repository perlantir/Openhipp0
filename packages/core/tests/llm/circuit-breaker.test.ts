import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../../src/llm/circuit-breaker.js';

function makeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000_000;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

describe('CircuitBreaker', () => {
  it('starts closed and allows execution', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeMs: 1000 });
    expect(cb.getState()).toBe('closed');
    expect(cb.canExecute()).toBe(true);
  });

  it('rejects invalid config', () => {
    expect(() => new CircuitBreaker({ failureThreshold: 0, resetTimeMs: 1000 })).toThrow(
      RangeError,
    );
    expect(() => new CircuitBreaker({ failureThreshold: 3, resetTimeMs: 0 })).toThrow(RangeError);
  });

  it('opens after N consecutive failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('closed');
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.canExecute()).toBe(false);
  });

  it('resets the failure counter on success in closed state', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure();
    cb.recordFailure();
    // 2 failures since the reset — still closed
    expect(cb.getState()).toBe('closed');
  });

  it('transitions open → half_open after resetTimeMs elapses', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeMs: 500 }, clock.now);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    clock.advance(499);
    expect(cb.getState()).toBe('open');
    clock.advance(1);
    expect(cb.getState()).toBe('half_open');
  });

  it('half_open allows exactly one probe', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeMs: 100 }, clock.now);
    cb.recordFailure();
    clock.advance(100);
    expect(cb.canExecute()).toBe(true); // first probe
    expect(cb.canExecute()).toBe(false); // concurrent probe blocked
  });

  it('closes from half_open on success', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeMs: 100 }, clock.now);
    cb.recordFailure();
    clock.advance(100);
    cb.canExecute(); // probe in flight
    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
    expect(cb.canExecute()).toBe(true);
  });

  it('re-opens from half_open on failure', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeMs: 100 }, clock.now);
    cb.recordFailure();
    clock.advance(100);
    cb.canExecute(); // probe in flight
    cb.recordFailure(); // probe failed
    expect(cb.getState()).toBe('open');
    // resetTimeMs starts again from the re-open moment
    expect(cb.retryAfterMs()).toBe(100);
  });

  it('retryAfterMs returns 0 when closed or half_open', () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeMs: 100 }, clock.now);
    expect(cb.retryAfterMs()).toBe(0);
    cb.recordFailure();
    cb.recordFailure();
    clock.advance(30);
    expect(cb.retryAfterMs()).toBe(70);
    clock.advance(70);
    cb.getState(); // triggers open → half_open
    expect(cb.retryAfterMs()).toBe(0);
  });

  it('reset() returns to closed state', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeMs: 100 });
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    cb.reset();
    expect(cb.getState()).toBe('closed');
    expect(cb.canExecute()).toBe(true);
  });
});
