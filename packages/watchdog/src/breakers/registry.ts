/**
 * BreakerRegistry — a named collection of CircuitBreakers, one per protected
 * subsystem (LLM provider, bridge, tool, DB pool, etc.).
 *
 * The CircuitBreaker class itself lives in @openhipp0/core/llm and is reused
 * verbatim. This package owns the *registry* + the *predictive layer* that
 * watches breaker state transitions to drive watchdog events.
 *
 * Re-export of CircuitBreaker is convenience-only; consumers that already
 * have it imported from core can supply their own instances to register().
 */

import { llm } from '@openhipp0/core';
import { EventEmitter } from 'node:events';

export type CircuitBreaker = InstanceType<typeof llm.CircuitBreaker>;
export type CircuitState = ReturnType<CircuitBreaker['getState']>;
export type CircuitBreakerConfig = ConstructorParameters<typeof llm.CircuitBreaker>[0];

/** Re-export the canonical implementation so consumers can construct their own. */
export const CircuitBreaker = llm.CircuitBreaker;

export interface BreakerEntry {
  name: string;
  /** Subsystem class — purely informational, useful for filtering / dashboards. */
  subsystem: 'llm' | 'bridge' | 'tool' | 'db' | 'other';
  breaker: CircuitBreaker;
  /** Last observed state — used to emit on transitions. */
  lastState: CircuitState;
}

export interface BreakerStateChange {
  name: string;
  subsystem: BreakerEntry['subsystem'];
  from: CircuitState;
  to: CircuitState;
  at: number;
}

/**
 * Events:
 *   state_change: BreakerStateChange (any registered breaker flipped state)
 *   opened:       BreakerStateChange (transition into 'open')
 *   closed:       BreakerStateChange (transition into 'closed' from non-closed)
 */
export class BreakerRegistry extends EventEmitter {
  private readonly entries = new Map<string, BreakerEntry>();

  register(opts: {
    name: string;
    subsystem: BreakerEntry['subsystem'];
    breaker: CircuitBreaker;
  }): void {
    if (this.entries.has(opts.name)) {
      throw new Error(`Breaker already registered: ${opts.name}`);
    }
    this.entries.set(opts.name, {
      name: opts.name,
      subsystem: opts.subsystem,
      breaker: opts.breaker,
      lastState: opts.breaker.getState(),
    });
  }

  unregister(name: string): boolean {
    return this.entries.delete(name);
  }

  get(name: string): CircuitBreaker | undefined {
    return this.entries.get(name)?.breaker;
  }

  list(): readonly BreakerEntry[] {
    return [...this.entries.values()];
  }

  size(): number {
    return this.entries.size;
  }

  /**
   * Sweep all breakers; emit transitions for any that changed state since the
   * last sweep. Call from a polling loop (or after every recordSuccess/Failure
   * if the consumer wants instant signals).
   */
  poll(now: () => number = Date.now): readonly BreakerStateChange[] {
    const changes: BreakerStateChange[] = [];
    const at = now();
    for (const entry of this.entries.values()) {
      const current = entry.breaker.getState();
      if (current !== entry.lastState) {
        const change: BreakerStateChange = {
          name: entry.name,
          subsystem: entry.subsystem,
          from: entry.lastState,
          to: current,
          at,
        };
        entry.lastState = current;
        changes.push(change);
        this.emit('state_change', change);
        if (current === 'open') this.emit('opened', change);
        if (current === 'closed' && change.from !== 'closed') this.emit('closed', change);
      }
    }
    return changes;
  }
}
