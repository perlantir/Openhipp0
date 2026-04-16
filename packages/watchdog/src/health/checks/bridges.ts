/**
 * BridgesCheck — verifies that all configured messaging bridges report
 * `isConnected() === true`.
 *
 * Severity rules:
 *   - No bridges configured → 'warn' (or 'skipped' if `treatEmptyAsSkipped`).
 *     Headless deploys legitimately run with no bridges; the caller decides
 *     whether that's an alert.
 *   - All connected → 'ok'.
 *   - Some disconnected → 'warn'.
 *   - All disconnected → 'fail'.
 */

import type { HealthCheck, HealthCheckOutput, HealthStatus } from '../types.js';

export interface BridgeProbe {
  name: string;
  /** Synchronous connection state. Bridges already expose this directly. */
  isConnected: () => boolean;
}

export interface BridgesCheckOptions {
  bridges: readonly BridgeProbe[];
  /** Treat 'no bridges configured' as 'skipped' instead of 'warn'. Default false. */
  treatEmptyAsSkipped?: boolean;
  /** Override the default check name. */
  name?: string;
}

interface BridgeState {
  name: string;
  connected: boolean;
}

export class BridgesCheck implements HealthCheck {
  readonly name: string;
  readonly description = 'All registered messaging bridges are connected';
  readonly category = 'connectivity';

  constructor(private readonly opts: BridgesCheckOptions) {
    this.name = opts.name ?? 'bridges';
  }

  async run(): Promise<HealthCheckOutput> {
    if (this.opts.bridges.length === 0) {
      return {
        status: this.opts.treatEmptyAsSkipped ? 'skipped' : 'warn',
        message: 'No bridges configured',
      };
    }

    const states: BridgeState[] = this.opts.bridges.map((b) => ({
      name: b.name,
      connected: b.isConnected(),
    }));
    const disconnected = states.filter((s) => !s.connected);
    if (disconnected.length === 0) {
      return { status: 'ok', details: { bridges: states } };
    }

    const status: HealthStatus = disconnected.length === states.length ? 'fail' : 'warn';
    return {
      status,
      message: `${disconnected.length}/${states.length} bridge(s) disconnected`,
      details: { bridges: states },
    };
  }
}
