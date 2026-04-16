/**
 * HealthDaemon — runs a HealthRegistry on an interval and emits events when
 * the report's overall status (or any individual check's status) changes.
 *
 * Designed for long-running processes — `hipp0 doctor --watch` (Phase 7)
 * subscribes to its events; the dashboard subscribes via the SDK.
 *
 * Events:
 *   report:        every report
 *   change:        overall status changed since last report
 *   check_change:  named check changed status since last report
 */

import { EventEmitter } from 'node:events';
import type { HealthRegistry } from './registry.js';
import type { HealthCheckResult, HealthReport, HealthRunOptions, HealthStatus } from './types.js';

export interface HealthDaemonConfig {
  /** Interval between runs in ms. Default 30_000. */
  intervalMs?: number;
  /** Options forwarded to registry.run() each tick. */
  runOptions?: HealthRunOptions;
}

export interface HealthDaemonEvents {
  report: HealthReport;
  change: { from: HealthStatus | null; to: HealthStatus; report: HealthReport };
  check_change: {
    name: string;
    from: HealthStatus | null;
    to: HealthStatus;
    result: HealthCheckResult;
  };
  error: unknown;
}

export class HealthDaemon extends EventEmitter {
  private readonly intervalMs: number;
  private readonly runOptions: HealthRunOptions;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastOverall: HealthStatus | null = null;
  private lastByCheck = new Map<string, HealthStatus>();
  private inFlight = false;

  constructor(
    private readonly registry: HealthRegistry,
    config: HealthDaemonConfig = {},
  ) {
    super();
    this.intervalMs = config.intervalMs ?? 30_000;
    this.runOptions = config.runOptions ?? {};
    if (!(this.intervalMs > 0)) throw new RangeError('intervalMs must be > 0');
  }

  /** Start the periodic loop. Returns immediately; first tick runs after intervalMs. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Run one tick immediately. Public for `hipp0 doctor` and tests. */
  async tick(): Promise<HealthReport | undefined> {
    if (this.inFlight) return undefined;
    this.inFlight = true;
    try {
      const report = await this.registry.run(this.runOptions);
      this.emit('report', report);
      if (this.lastOverall !== report.overall) {
        this.emit('change', { from: this.lastOverall, to: report.overall, report });
        this.lastOverall = report.overall;
      }
      for (const result of report.results) {
        const prev = this.lastByCheck.get(result.name) ?? null;
        if (prev !== result.status) {
          this.emit('check_change', { name: result.name, from: prev, to: result.status, result });
          this.lastByCheck.set(result.name, result.status);
        }
      }
      return report;
    } catch (err) {
      this.emit('error', err);
      return undefined;
    } finally {
      this.inFlight = false;
    }
  }

  /** Reset the change-tracking memory (next tick treats every check as new). */
  reset(): void {
    this.lastOverall = null;
    this.lastByCheck.clear();
  }
}
