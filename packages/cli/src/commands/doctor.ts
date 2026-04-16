/**
 * `hipp0 doctor [--auto-fix]` — runs health checks and reports status.
 *
 * The command composes a HealthRegistry (injectable for tests) and runs every
 * registered check. The exit code maps from the aggregate status: ok=0,
 * warn=0, fail=1. --json emits the full HealthReport.
 *
 * By default we register ConfigCheck(config.json), validating against
 * Hipp0ConfigSchema so schema drift surfaces in the health report.
 */

import { ConfigCheck, HealthRegistry } from '@openhipp0/watchdog';
import type { HealthCheck, HealthReport } from '@openhipp0/watchdog';
import { defaultConfigPath } from '../config.js';
import { Hipp0ConfigSchema, type CommandResult } from '../types.js';

export interface DoctorOptions {
  autoFix?: boolean;
  configPath?: string;
  /** Inject a pre-built registry (tests). If absent, a default is constructed. */
  registry?: HealthRegistry;
  /** Extra checks to add on top of the default set. */
  extraChecks?: readonly HealthCheck[];
}

export function buildDefaultRegistry(configPath: string): HealthRegistry {
  const registry = new HealthRegistry();
  registry.register(
    new ConfigCheck({
      configPath,
      validate: (parsed) => {
        const result = Hipp0ConfigSchema.safeParse(parsed);
        if (result.success) return null;
        return result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      },
    }),
  );
  return registry;
}

export async function runDoctor(opts: DoctorOptions = {}): Promise<CommandResult> {
  const configPath = opts.configPath ?? defaultConfigPath();
  const registry = opts.registry ?? buildDefaultRegistry(configPath);
  for (const check of opts.extraChecks ?? []) registry.register(check);

  const report = await registry.run({ autoFix: opts.autoFix ?? false });
  const stdout = renderReport(report);
  const exitCode = report.overall === 'fail' ? 1 : 0;
  return { exitCode, stdout, data: report };
}

function renderReport(report: HealthReport): string[] {
  const lines: string[] = [];
  lines.push(
    `hipp0 doctor — overall ${report.overall.toUpperCase()} (${report.totalDurationMs}ms)`,
  );
  lines.push(
    `  summary: ${report.summary.ok} ok, ${report.summary.warn} warn, ${report.summary.fail} fail, ${report.summary.skipped} skipped`,
  );
  for (const r of report.results) {
    const icon = r.status === 'ok' ? '✓' : r.status === 'warn' ? '!' : r.status === 'fail' ? '✗' : '·';
    const msg = r.message ? ` — ${r.message}` : '';
    lines.push(`  ${icon} [${r.status}] ${r.name} (${r.durationMs}ms)${msg}`);
    if (r.autoFix) {
      const verb = r.autoFix.succeeded ? 'fixed' : 'failed';
      lines.push(`      auto-fix ${verb}: ${r.autoFix.description}`);
    }
  }
  return lines;
}
