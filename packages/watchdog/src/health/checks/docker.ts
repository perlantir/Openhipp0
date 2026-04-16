/**
 * DockerCheck — verifies the Docker daemon is reachable.
 *
 * Probe is injected so we don't shell out to `docker info` from the watchdog
 * package. Production wires either an HTTP ping to /var/run/docker.sock or a
 * `dockerode` ping; tests inject a fake.
 *
 * If `required` is false (default), an unreachable daemon is reported as
 * 'warn' rather than 'fail' — many deploys legitimately run without Docker
 * if the sandbox tool is configured for native execution.
 */

import type { HealthCheck, HealthCheckOutput } from '../types.js';

export type DockerProbe = () => Promise<void> | void;

export interface DockerCheckOptions {
  probe: DockerProbe;
  /** When true, an unreachable daemon is 'fail' instead of 'warn'. Default false. */
  required?: boolean;
  name?: string;
}

export class DockerCheck implements HealthCheck {
  readonly name: string;
  readonly description = 'Docker daemon is reachable (sandbox runtime)';
  readonly category = 'resources';
  private readonly probe: DockerProbe;
  private readonly required: boolean;

  constructor(opts: DockerCheckOptions) {
    this.name = opts.name ?? 'docker';
    this.probe = opts.probe;
    this.required = opts.required ?? false;
  }

  async run(): Promise<HealthCheckOutput> {
    try {
      await this.probe();
      return { status: 'ok' };
    } catch (err) {
      return {
        status: this.required ? 'fail' : 'warn',
        message: `Docker daemon unreachable: ${err instanceof Error ? err.message : String(err)}`,
        details: { required: this.required },
      };
    }
  }
}
