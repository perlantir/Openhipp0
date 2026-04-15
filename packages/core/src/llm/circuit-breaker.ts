/**
 * Circuit breaker — protects a downstream provider from thrashing when it's
 * failing consecutively. Classic three-state machine.
 *
 *   CLOSED   → normal operation. Consecutive failures increment a counter.
 *              On reaching `failureThreshold`, transitions to OPEN.
 *   OPEN     → fail fast. `canExecute()` returns false until `resetTimeMs`
 *              has elapsed since opening, then transitions to HALF_OPEN.
 *   HALF_OPEN → one probe call is allowed. Success → CLOSED. Failure → OPEN.
 *
 * A successful call in CLOSED state resets the failure counter to 0.
 */

import type { CircuitBreakerConfig } from './types.js';

export type CircuitState = 'closed' | 'open' | 'half_open';

/** Function returning "now" in milliseconds. Defaulted to Date.now; override in tests. */
export type ClockFn = () => number;

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  /** True once a half-open probe is in flight; prevents concurrent probes. */
  private probeInFlight = false;

  constructor(
    private readonly config: CircuitBreakerConfig,
    private readonly now: ClockFn = Date.now,
  ) {
    if (config.failureThreshold < 1) {
      throw new RangeError('failureThreshold must be >= 1');
    }
    if (config.resetTimeMs <= 0) {
      throw new RangeError('resetTimeMs must be > 0');
    }
  }

  /** Current state. Advances from OPEN → HALF_OPEN if enough time has passed. */
  getState(): CircuitState {
    if (this.state === 'open' && this.now() - this.openedAt >= this.config.resetTimeMs) {
      this.state = 'half_open';
      this.probeInFlight = false;
    }
    return this.state;
  }

  /**
   * Whether a new call may proceed. In HALF_OPEN, only one probe is allowed
   * at a time; concurrent callers see `false` until the probe resolves.
   */
  canExecute(): boolean {
    const state = this.getState();
    if (state === 'closed') return true;
    if (state === 'open') return false;
    // half_open
    if (this.probeInFlight) return false;
    this.probeInFlight = true;
    return true;
  }

  /** Record a successful call. */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.state === 'half_open') {
      this.state = 'closed';
      this.probeInFlight = false;
    }
  }

  /** Record a failed call. */
  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.state === 'half_open') {
      this.state = 'open';
      this.openedAt = this.now();
      this.probeInFlight = false;
      return;
    }
    if (this.state === 'closed' && this.consecutiveFailures >= this.config.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }

  /**
   * Milliseconds until the next HALF_OPEN probe is permitted, or 0 if the
   * circuit is already closed or half-open.
   */
  retryAfterMs(): number {
    if (this.state !== 'open') return 0;
    const elapsed = this.now() - this.openedAt;
    return Math.max(0, this.config.resetTimeMs - elapsed);
  }

  /** Force-reset to CLOSED. Use with care (admin override / tests). */
  reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAt = 0;
    this.probeInFlight = false;
  }
}
