/**
 * MemoryCheck — verifies system memory pressure (os.freemem / os.totalmem).
 *
 * This is distinct from HeapMonitor in 4a, which tracks V8 heap pressure.
 * System memory exhaustion (host runs out of RAM) and V8 heap exhaustion
 * (process can't allocate within its --max-old-space-size budget) are
 * different failure modes; both are worth alarming on.
 */

import * as os from 'node:os';
import type { HealthCheck, HealthCheckOutput, HealthStatus } from '../types.js';

export interface MemorySample {
  free: number;
  total: number;
}

export type MemoryProbe = () => MemorySample;

export interface MemoryCheckOptions {
  /** Free fraction below which 'warn' fires. Default 0.15. */
  warnFraction?: number;
  /** Free fraction below which 'fail' fires. Default 0.05. */
  failFraction?: number;
  probe?: MemoryProbe;
  name?: string;
}

const defaultProbe: MemoryProbe = () => ({ free: os.freemem(), total: os.totalmem() });

export class MemoryCheck implements HealthCheck {
  readonly name: string;
  readonly description = 'System memory pressure is below thresholds';
  readonly category = 'resources';
  private readonly warnFraction: number;
  private readonly failFraction: number;
  private readonly probe: MemoryProbe;

  constructor(opts: MemoryCheckOptions = {}) {
    this.name = opts.name ?? 'memory';
    this.warnFraction = opts.warnFraction ?? 0.15;
    this.failFraction = opts.failFraction ?? 0.05;
    this.probe = opts.probe ?? defaultProbe;
    if (
      !(this.failFraction < this.warnFraction) ||
      this.warnFraction > 1 ||
      this.failFraction < 0
    ) {
      throw new RangeError('thresholds: 0 <= failFraction < warnFraction <= 1');
    }
  }

  async run(): Promise<HealthCheckOutput> {
    const { free, total } = this.probe();
    const fraction = total > 0 ? free / total : 0;
    let status: HealthStatus = 'ok';
    if (fraction < this.failFraction) status = 'fail';
    else if (fraction < this.warnFraction) status = 'warn';
    return {
      status,
      message: `${(fraction * 100).toFixed(1)}% free`,
      details: { freeBytes: free, totalBytes: total, freeFraction: fraction },
    };
  }
}
