/**
 * DatabaseCheck — pings the configured database via a caller-supplied probe.
 *
 * The probe is injected (not "open a Drizzle client and run SELECT 1" here)
 * because the watchdog package can't depend on @openhipp0/memory without
 * inverting the package boundary. Production callers wire the probe to
 * something like `() => db.$client.exec('SELECT 1')`.
 */

import type { HealthCheck, HealthCheckOutput } from '../types.js';

export interface DatabaseCheckOptions {
  /** Lightweight ping. SQLite: db.$client.exec('SELECT 1'). PG: db.execute(sql`SELECT 1`). */
  ping: () => Promise<void> | void;
  /** Override the default check name. */
  name?: string;
  /** Override the default user-facing description (e.g. 'Postgres reachable'). */
  description?: string;
}

export class DatabaseCheck implements HealthCheck {
  readonly name: string;
  readonly description: string;
  readonly category = 'connectivity';

  constructor(private readonly opts: DatabaseCheckOptions) {
    this.name = opts.name ?? 'database';
    this.description = opts.description ?? 'Database is reachable';
  }

  async run(): Promise<HealthCheckOutput> {
    const start = Date.now();
    try {
      await this.opts.ping();
    } catch (err) {
      return {
        status: 'fail',
        message: `Database ping failed: ${err instanceof Error ? err.message : String(err)}`,
        details: { latencyMs: Date.now() - start },
      };
    }
    return { status: 'ok', details: { latencyMs: Date.now() - start } };
  }
}
