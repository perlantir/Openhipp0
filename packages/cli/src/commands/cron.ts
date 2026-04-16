/**
 * `hipp0 cron add|list|remove` — manages config.cronTasks[].
 *
 * `add` validates the schedule by parsing it through @openhipp0/scheduler
 * (natural-language → cron, then cron parser). Invalid expressions are
 * rejected before writing config so the scheduler won't refuse to start.
 */

import {
  Hipp0CronParseError,
  naturalToCron,
  nextFireTime,
  parseCron,
} from '@openhipp0/scheduler';
import {
  defaultConfigPath,
  nodeFileSystem,
  readConfig,
  writeConfig,
  type FileSystem,
} from '../config.js';
import { Hipp0CliError, type CommandResult } from '../types.js';

export interface CronCommandOptions {
  configPath?: string;
  filesystem?: FileSystem;
}

export interface AddCronOptions extends CronCommandOptions {
  description?: string;
  enabled?: boolean;
  /** Fixed reference time for deterministic `next fire` output in tests. */
  now?: Date;
}

export async function runCronAdd(
  id: string,
  schedule: string,
  opts: AddCronOptions = {},
): Promise<CommandResult> {
  if (!id || !id.trim()) {
    throw new Hipp0CliError('Cron id is required.', 'HIPP0_CLI_CRON_MISSING_ID');
  }
  // Resolve NL → cron (preserved verbatim in config so the user sees what they typed).
  const cronExpr = naturalToCron(schedule) ?? schedule;
  try {
    parseCron(cronExpr);
  } catch (err) {
    if (err instanceof Hipp0CronParseError) {
      throw new Hipp0CliError(
        `Invalid cron schedule: "${schedule}"`,
        'HIPP0_CLI_CRON_INVALID_SCHEDULE',
      );
    }
    throw err;
  }

  const filesystem = opts.filesystem ?? nodeFileSystem;
  const configPath = opts.configPath ?? defaultConfigPath();
  const config = await readConfig(configPath, filesystem);
  if (config.cronTasks.some((c) => c.id === id)) {
    throw new Hipp0CliError(`Cron task already exists: ${id}`, 'HIPP0_CLI_CRON_EXISTS');
  }
  const next = {
    ...config,
    cronTasks: [
      ...config.cronTasks,
      {
        id,
        schedule,
        description: opts.description ?? '',
        enabled: opts.enabled ?? true,
      },
    ],
  };
  await writeConfig(next, configPath, filesystem);

  const parsed = parseCron(cronExpr);
  const nextFire = nextFireTime(parsed, opts.now ?? new Date());

  return {
    exitCode: 0,
    stdout: [
      `✓ Added cron task "${id}" (${schedule} → ${cronExpr})`,
      `  next fire: ${nextFire ? nextFire.toISOString() : 'never'}`,
    ],
    data: { id, schedule, cronExpression: cronExpr, nextFireAt: nextFire?.toISOString() ?? null },
  };
}

export async function runCronList(opts: CronCommandOptions = {}): Promise<CommandResult> {
  const filesystem = opts.filesystem ?? nodeFileSystem;
  const configPath = opts.configPath ?? defaultConfigPath();
  const config = await readConfig(configPath, filesystem);
  if (config.cronTasks.length === 0) {
    return { exitCode: 0, stdout: ['No cron tasks configured.'], data: { cronTasks: [] } };
  }
  const lines: string[] = [`Cron tasks (${config.cronTasks.length}):`];
  for (const t of config.cronTasks) {
    const state = t.enabled ? 'on ' : 'off';
    const desc = t.description ? ` — ${t.description}` : '';
    lines.push(`  [${state}] ${t.id}: ${t.schedule}${desc}`);
  }
  return { exitCode: 0, stdout: lines, data: { cronTasks: config.cronTasks } };
}

export async function runCronRemove(
  id: string,
  opts: CronCommandOptions = {},
): Promise<CommandResult> {
  const filesystem = opts.filesystem ?? nodeFileSystem;
  const configPath = opts.configPath ?? defaultConfigPath();
  const config = await readConfig(configPath, filesystem);
  const before = config.cronTasks.length;
  const next = { ...config, cronTasks: config.cronTasks.filter((t) => t.id !== id) };
  if (next.cronTasks.length === before) {
    throw new Hipp0CliError(`Cron task not found: ${id}`, 'HIPP0_CLI_CRON_NOT_FOUND');
  }
  await writeConfig(next, configPath, filesystem);
  return { exitCode: 0, stdout: [`✓ Removed cron task "${id}"`], data: { id } };
}
