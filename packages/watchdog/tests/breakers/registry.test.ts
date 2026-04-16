import { describe, expect, it } from 'vitest';
import { BreakerRegistry, CircuitBreaker } from '../../src/index.js';

describe('BreakerRegistry', () => {
  it('register / get / list / size / unregister', () => {
    const reg = new BreakerRegistry();
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeMs: 1000 });
    reg.register({ name: 'anthropic', subsystem: 'llm', breaker });
    expect(reg.size()).toBe(1);
    expect(reg.get('anthropic')).toBe(breaker);
    expect(reg.list().map((e) => e.name)).toEqual(['anthropic']);
    expect(reg.unregister('anthropic')).toBe(true);
    expect(reg.unregister('anthropic')).toBe(false);
  });

  it('rejects duplicate names', () => {
    const reg = new BreakerRegistry();
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeMs: 1000 });
    reg.register({ name: 'a', subsystem: 'llm', breaker });
    expect(() => reg.register({ name: 'a', subsystem: 'llm', breaker })).toThrow();
  });

  it('emits state_change + opened when a breaker trips', () => {
    const now = 0;
    const reg = new BreakerRegistry();
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeMs: 1000 }, () => now);
    reg.register({ name: 'pg', subsystem: 'db', breaker });

    const stateChanges: string[] = [];
    const opened: string[] = [];
    reg.on('state_change', (e) => stateChanges.push(`${e.from}->${e.to}`));
    reg.on('opened', (e) => opened.push(e.name));

    breaker.recordFailure();
    breaker.recordFailure();
    reg.poll(() => now);
    expect(stateChanges).toEqual(['closed->open']);
    expect(opened).toEqual(['pg']);
  });

  it('emits closed when a breaker recovers from half-open', () => {
    let now = 0;
    const reg = new BreakerRegistry();
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeMs: 100 }, () => now);
    reg.register({ name: 'tool', subsystem: 'tool', breaker });

    const closedEvents: string[] = [];
    reg.on('closed', (e) => closedEvents.push(`${e.from}->${e.to}`));

    breaker.recordFailure();
    reg.poll(() => now); // closed→open
    now += 200;
    breaker.canExecute(); // moves to half_open
    reg.poll(() => now);
    breaker.recordSuccess(); // moves to closed
    reg.poll(() => now);

    expect(closedEvents).toEqual(['half_open->closed']);
  });

  it('does not emit for breakers that stay in the same state', () => {
    const now = 0;
    const reg = new BreakerRegistry();
    const breaker = new CircuitBreaker({ failureThreshold: 5, resetTimeMs: 1000 }, () => now);
    reg.register({ name: 'b', subsystem: 'bridge', breaker });

    const events: unknown[] = [];
    reg.on('state_change', (e) => events.push(e));
    reg.poll(() => now);
    reg.poll(() => now);
    expect(events).toEqual([]);
  });
});
