/**
 * PortsCheck — verifies that the configured set of ports has the expected
 * binding state. Two modes:
 *
 *   mustBeBound:    e.g. dashboard's WebSocket port — fails if NOT listening
 *   mustBeFree:     e.g. a port reserved for an upcoming bind — fails if IS listening
 *
 * Probe is injected: `(port, host) => Promise<boolean>` returning true if the
 * port is currently bound. Production uses a TCP connect attempt; tests use a
 * deterministic stub.
 */

import type { HealthCheck, HealthCheckOutput, HealthStatus } from '../types.js';

export type PortProbe = (port: number, host: string) => Promise<boolean>;

export interface PortSpec {
  port: number;
  host?: string;
  expect: 'bound' | 'free';
  label?: string;
}

export interface PortsCheckOptions {
  ports: readonly PortSpec[];
  probe: PortProbe;
  name?: string;
}

interface PortResult {
  port: number;
  host: string;
  expect: 'bound' | 'free';
  actual: 'bound' | 'free';
  ok: boolean;
  label?: string;
}

export class PortsCheck implements HealthCheck {
  readonly name: string;
  readonly description = 'Required ports are in their expected binding state';
  readonly category = 'resources';
  private readonly ports: readonly PortSpec[];
  private readonly probe: PortProbe;

  constructor(opts: PortsCheckOptions) {
    this.name = opts.name ?? 'ports';
    this.ports = opts.ports;
    this.probe = opts.probe;
  }

  async run(): Promise<HealthCheckOutput> {
    if (this.ports.length === 0) {
      return { status: 'skipped', message: 'No port expectations configured' };
    }
    const results: PortResult[] = await Promise.all(
      this.ports.map(async (p) => {
        const host = p.host ?? '127.0.0.1';
        const isBound = await this.probe(p.port, host);
        const actual: 'bound' | 'free' = isBound ? 'bound' : 'free';
        const result: PortResult = {
          port: p.port,
          host,
          expect: p.expect,
          actual,
          ok: actual === p.expect,
        };
        if (p.label !== undefined) result.label = p.label;
        return result;
      }),
    );
    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) {
      return { status: 'ok', details: { ports: results } };
    }
    const status: HealthStatus = failed.length === results.length ? 'fail' : 'warn';
    return {
      status,
      message: `${failed.length}/${results.length} port expectation(s) violated`,
      details: { ports: results },
    };
  }
}
