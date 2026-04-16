/**
 * DiskCheck — verifies free disk space at a given path is above warn/critical
 * thresholds.
 *
 * Probe is injected (no statvfs in node — production wires `fs.statfs(path)`
 * available in Node 18.15+ / 20+). Tests inject a deterministic fake.
 */

import * as fs from 'node:fs/promises';
import type { HealthCheck, HealthCheckOutput, HealthStatus } from '../types.js';

export interface DiskUsage {
  /** Free bytes available. */
  free: number;
  /** Total bytes. */
  total: number;
}

export type DiskProbe = (path: string) => Promise<DiskUsage>;

export interface DiskCheckOptions {
  /** Path to check. Default '/'. */
  path?: string;
  /** Free fraction below which 'warn' fires. Default 0.20. */
  warnFraction?: number;
  /** Free fraction below which 'fail' fires. Default 0.05. */
  failFraction?: number;
  /** Custom probe; defaults to fs.statfs-based implementation. */
  probe?: DiskProbe;
  name?: string;
}

const defaultProbe: DiskProbe = async (p) => {
  const stats = await fs.statfs(p);
  // bsize is fragment size in bytes
  return {
    free: Number(stats.bavail) * Number(stats.bsize),
    total: Number(stats.blocks) * Number(stats.bsize),
  };
};

export class DiskCheck implements HealthCheck {
  readonly name: string;
  readonly description = 'Free disk space is above thresholds';
  readonly category = 'resources';
  private readonly path: string;
  private readonly warnFraction: number;
  private readonly failFraction: number;
  private readonly probe: DiskProbe;

  constructor(opts: DiskCheckOptions = {}) {
    this.name = opts.name ?? 'disk';
    this.path = opts.path ?? '/';
    this.warnFraction = opts.warnFraction ?? 0.2;
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
    const { free, total } = await this.probe(this.path);
    const fraction = total > 0 ? free / total : 0;
    const details = { path: this.path, freeBytes: free, totalBytes: total, freeFraction: fraction };
    let status: HealthStatus = 'ok';
    if (fraction < this.failFraction) status = 'fail';
    else if (fraction < this.warnFraction) status = 'warn';
    return {
      status,
      message:
        status === 'ok'
          ? `${(fraction * 100).toFixed(1)}% free at ${this.path}`
          : `Only ${(fraction * 100).toFixed(1)}% free at ${this.path}`,
      details,
    };
  }
}
