// @openhipp0/cli — hipp0 CLI entrypoint.
//
// Phase 7a: commander program with init/config/status/start/stop wired.
// Later sub-phases add doctor/skill/memory/agent/cron/migrate/benchmark.
//
// The program is built by createProgram() so tests can construct it without
// invoking process.exit. runCli() is the production entrypoint used by bin/.

import { Command } from 'commander';
import { runInit, nodePrompt } from './commands/init.js';
import { runConfigGet, runConfigSet } from './commands/config.js';
import { runStart, runStatus, runStop } from './commands/lifecycle.js';
import { runServe } from './commands/serve.js';
import { runDoctor } from './commands/doctor.js';
import {
  runSkillAudit,
  runSkillCreate,
  runSkillDeferred,
  runSkillList,
  runSkillSearch,
} from './commands/skill.js';
import { runAgentAdd, runAgentList, runAgentRemove } from './commands/agent.js';
import { runCronAdd, runCronList, runCronRemove } from './commands/cron.js';
import { runMemorySearch, runMemoryStats } from './commands/memory.js';
import {
  runBenchmark,
  runMigrateCopy,
  runMigrateDump,
  runMigrateRestore,
  runUpdate,
} from './commands/misc.js';
import { runMigrateOpenClaw } from './commands/migrate-openclaw.js';
import { runMigrateHermes } from './commands/migrate-hermes.js';
import { Hipp0CliError, type CommandResult } from './types.js';

export const packageName = '@openhipp0/cli' as const;
export const version = '0.0.0' as const;

export * from './types.js';
export {
  defaultConfigDir,
  defaultConfigPath,
  readConfig,
  writeConfig,
  getConfigValue,
  setConfigValue,
  nodeFileSystem,
} from './config.js';
export type { FileSystem } from './config.js';
export { runInit, nodePrompt };
export { runConfigGet, runConfigSet };
export { runStart, runStatus, runStop };
export { runServe } from './commands/serve.js';
export { runDoctor, buildDefaultRegistry } from './commands/doctor.js';
export {
  runSkillAudit,
  runSkillCreate,
  runSkillDeferred,
  runSkillList,
  runSkillSearch,
  defaultSkillPaths,
} from './commands/skill.js';
export { runAgentAdd, runAgentList, runAgentRemove } from './commands/agent.js';
export { runCronAdd, runCronList, runCronRemove } from './commands/cron.js';
export { runMemorySearch, runMemoryStats } from './commands/memory.js';
export {
  runBenchmark,
  runMigrateCopy,
  runMigrateDump,
  runMigrateRestore,
  runUpdate,
} from './commands/misc.js';
export { runMigrateOpenClaw } from './commands/migrate-openclaw.js';
export { runMigrateHermes } from './commands/migrate-hermes.js';
export type { MigrationFs, MigrationPlan, MigrationOp, MigrationReport } from './commands/migrate-shared.js';
export {
  detectOpenClawSource,
  detectHermesSource,
  parseMemoryEntries,
  formatPlan,
  nodeMigrationFs,
} from './commands/migrate-shared.js';

export interface CliOptions {
  /** Emit a single JSON line on stdout instead of human-readable text. */
  json?: boolean;
}

function emit(result: CommandResult, globalOpts: CliOptions): void {
  if (globalOpts.json) {
    const payload = {
      exitCode: result.exitCode,
      data: result.data ?? null,
      stdout: result.stdout ?? [],
      stderr: result.stderr ?? [],
    };
    console.log(JSON.stringify(payload));
    return;
  }
  for (const line of result.stdout ?? []) console.log(line);
  for (const line of result.stderr ?? []) console.error(line);
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name('hipp0')
    .description('Open Hipp0 — local-first autonomous AI agent platform')
    .version(version)
    .option('--json', 'emit structured JSON to stdout instead of human text', false);

  program
    .command('init')
    .description('initialize a new hipp0 project (interactive wizard)')
    .argument('[name]', 'project name')
    .option('-f, --force', 'overwrite existing config', false)
    .option('--non-interactive', 'use defaults, do not prompt', false)
    .action(async (name: string | undefined, opts: { force: boolean; nonInteractive: boolean }) => {
      const global = program.opts<CliOptions>();
      let promptClose: (() => void) | undefined;
      try {
        const prompt = opts.nonInteractive
          ? undefined
          : await (async () => {
              const fn = await nodePrompt();
              promptClose = (fn as unknown as { close?: () => void }).close;
              return fn;
            })();
        const result = await runInit({
          name,
          force: opts.force,
          nonInteractive: opts.nonInteractive,
          prompt,
        });
        emit(result, global);
        process.exit(result.exitCode);
      } finally {
        if (promptClose) promptClose();
      }
    });

  const config = program.command('config').description('read/write hipp0 config');
  config
    .command('get')
    .argument('<key>', 'dotted config key (e.g. llm.provider)')
    .action(async (key: string) => {
      const global = program.opts<CliOptions>();
      const result = await runConfigGet(key);
      emit(result, global);
      process.exit(result.exitCode);
    });
  config
    .command('set')
    .argument('<key>', 'dotted config key (e.g. llm.provider)')
    .argument('<value>', 'value — coerced to bool/number when recognized')
    .action(async (key: string, value: string) => {
      const global = program.opts<CliOptions>();
      const result = await runConfigSet(key, value);
      emit(result, global);
      process.exit(result.exitCode);
    });

  program
    .command('status')
    .description('show whether the hipp0 daemon is running')
    .action(async () => {
      const global = program.opts<CliOptions>();
      const result = await runStatus();
      emit(result, global);
      process.exit(result.exitCode);
    });

  program
    .command('start')
    .description('start the hipp0 daemon (Phase 8)')
    .action(async () => {
      const global = program.opts<CliOptions>();
      const result = await runStart();
      emit(result, global);
      process.exit(result.exitCode);
    });

  program
    .command('serve')
    .description('start the production HTTP server (health + API surface) on port 3100')
    .option('-p, --port <port>', 'listen port (default 3100)', (v) => parseInt(v, 10))
    .option('-h, --host <host>', 'bind host (default 0.0.0.0)')
    .option('--with-ws', 'attach a WebBridge on /ws (same as HIPP0_WITH_WS=1)', false)
    .option('--with-api', 'mount the REST API under /api (same as HIPP0_WITH_API=1)', false)
    .option('--api-token <token>', 'bearer token required on every /api/* route')
    .action(
      async (opts: {
        port?: number;
        host?: string;
        withWs?: boolean;
        withApi?: boolean;
        apiToken?: string;
      }) => {
        const global = program.opts<CliOptions>();
        const serveOpts: Parameters<typeof runServe>[0] = {};
        if (opts.port !== undefined) serveOpts.port = opts.port;
        if (opts.host !== undefined) serveOpts.host = opts.host;
        if (opts.withWs) serveOpts.withWs = true;
        if (opts.withApi) serveOpts.withApi = true;
        if (opts.apiToken) serveOpts.apiToken = opts.apiToken;
        const result = await runServe(serveOpts);
        emit(result, global);
        process.exit(result.exitCode);
      },
    );

  program
    .command('stop')
    .description('stop the hipp0 daemon (Phase 8)')
    .action(async () => {
      const global = program.opts<CliOptions>();
      const result = await runStop();
      emit(result, global);
      process.exit(result.exitCode);
    });

  program
    .command('doctor')
    .description('run health checks on the installation')
    .option('--auto-fix', 'attempt auto-remediation on failing checks', false)
    .action(async (opts: { autoFix: boolean }) => {
      const global = program.opts<CliOptions>();
      const result = await runDoctor({ autoFix: opts.autoFix });
      emit(result, global);
      process.exit(result.exitCode);
    });

  const skill = program.command('skill').description('discover and scaffold skills');
  skill
    .command('list')
    .description('list all installed skills')
    .action(async () => {
      const global = program.opts<CliOptions>();
      const result = await runSkillList();
      emit(result, global);
      process.exit(result.exitCode);
    });
  skill
    .command('search')
    .argument('<query>', 'substring match over name/description/tags')
    .action(async (query: string) => {
      const global = program.opts<CliOptions>();
      const result = await runSkillSearch(query);
      emit(result, global);
      process.exit(result.exitCode);
    });
  skill
    .command('audit')
    .description('validate every skill manifest')
    .action(async () => {
      const global = program.opts<CliOptions>();
      const result = await runSkillAudit();
      emit(result, global);
      process.exit(result.exitCode);
    });
  skill
    .command('create')
    .argument('<name>', 'skill slug (lowercase, hyphens allowed)')
    .description('scaffold a new skill in the workspace directory')
    .action(async (name: string) => {
      const global = program.opts<CliOptions>();
      const result = await runSkillCreate(name);
      emit(result, global);
      process.exit(result.exitCode);
    });
  for (const sub of ['install', 'test', 'remove']) {
    skill
      .command(sub)
      .description(`${sub} a skill (Phase 8 placeholder)`)
      .action(async () => {
        const global = program.opts<CliOptions>();
        const result = await runSkillDeferred(sub);
        emit(result, global);
        process.exit(result.exitCode);
      });
  }

  const agent = program.command('agent').description('manage configured agents');
  agent
    .command('add')
    .argument('<name>', 'agent name')
    .option('-d, --domain <domain>', 'agent domain')
    .option('-s, --skills <skills>', 'comma-separated skill list')
    .action(async (name: string, opts: { domain?: string; skills?: string }) => {
      const global = program.opts<CliOptions>();
      const skillList = opts.skills?.split(',').map((s) => s.trim()).filter(Boolean);
      const result = await runAgentAdd(name, { domain: opts.domain, skills: skillList });
      emit(result, global);
      process.exit(result.exitCode);
    });
  agent
    .command('list')
    .action(async () => {
      const global = program.opts<CliOptions>();
      const result = await runAgentList();
      emit(result, global);
      process.exit(result.exitCode);
    });
  agent
    .command('remove')
    .argument('<name>', 'agent name')
    .action(async (name: string) => {
      const global = program.opts<CliOptions>();
      const result = await runAgentRemove(name);
      emit(result, global);
      process.exit(result.exitCode);
    });

  const cron = program.command('cron').description('manage cron tasks');
  cron
    .command('add')
    .argument('<id>', 'cron task id')
    .argument('<schedule>', 'cron expression or natural-language (e.g. "every 30 minutes")')
    .option('-d, --description <desc>', 'human description')
    .option('--disabled', 'add task in disabled state', false)
    .action(
      async (
        id: string,
        schedule: string,
        opts: { description?: string; disabled: boolean },
      ) => {
        const global = program.opts<CliOptions>();
        const result = await runCronAdd(id, schedule, {
          description: opts.description,
          enabled: !opts.disabled,
        });
        emit(result, global);
        process.exit(result.exitCode);
      },
    );
  cron
    .command('list')
    .action(async () => {
      const global = program.opts<CliOptions>();
      const result = await runCronList();
      emit(result, global);
      process.exit(result.exitCode);
    });
  cron
    .command('remove')
    .argument('<id>', 'cron task id')
    .action(async (id: string) => {
      const global = program.opts<CliOptions>();
      const result = await runCronRemove(id);
      emit(result, global);
      process.exit(result.exitCode);
    });

  const memory = program.command('memory').description('inspect the memory database');
  memory
    .command('stats')
    .description('row counts across decisions/skills/memory/sessions')
    .action(async () => {
      const global = program.opts<CliOptions>();
      const result = await runMemoryStats();
      emit(result, global);
      process.exit(result.exitCode);
    });
  memory
    .command('search')
    .argument('<query>', 'FTS5 search query')
    .requiredOption('-p, --project <id>', 'project id to search within')
    .option('-l, --limit <n>', 'max hits (default 10)', (v) => parseInt(v, 10), 10)
    .option('--agent <id>', 'filter by agent id')
    .option('--user <id>', 'filter by user id')
    .action(
      async (
        query: string,
        opts: { project: string; limit: number; agent?: string; user?: string },
      ) => {
        const global = program.opts<CliOptions>();
        const searchOpts: Parameters<typeof runMemorySearch>[1] = {
          projectId: opts.project,
          limit: opts.limit,
        };
        if (opts.agent !== undefined) searchOpts.agentId = opts.agent;
        if (opts.user !== undefined) searchOpts.userId = opts.user;
        const result = await runMemorySearch(query, searchOpts);
        emit(result, global);
        process.exit(result.exitCode);
      },
    );

  const migrate = program.command('migrate').description('dump / restore / copy the SQLite DB');
  migrate
    .command('dump')
    .argument('<out>', 'output file path')
    .action(async (out: string) => {
      const global = program.opts<CliOptions>();
      const result = await runMigrateDump(out);
      emit(result, global);
      process.exit(result.exitCode);
    });
  migrate
    .command('restore')
    .argument('<in>', 'input file path')
    .option('-f, --force', 'overwrite the current DB', false)
    .action(async (inp: string, opts: { force: boolean }) => {
      const global = program.opts<CliOptions>();
      const result = await runMigrateRestore(inp, { force: opts.force });
      emit(result, global);
      process.exit(result.exitCode);
    });
  migrate
    .command('copy')
    .argument('<src>')
    .argument('<dst>')
    .action(async (src: string, dst: string) => {
      const global = program.opts<CliOptions>();
      const result = await runMigrateCopy(src, dst);
      emit(result, global);
      process.exit(result.exitCode);
    });

  migrate
    .command('openclaw')
    .description('migrate from ~/.openclaw (or .clawdbot/.moltbot) → ~/.hipp0')
    .option('--source <path>', 'override auto-detected source directory')
    .option('--preset <preset>', 'full | user-data (default user-data)', 'user-data')
    .option('--dry-run', 'preview without writing anything', false)
    .option('--non-interactive', 'implies --dry-run unless --dry-run=false', false)
    .action(
      async (opts: { source?: string; preset: string; dryRun: boolean; nonInteractive: boolean }) => {
        const global = program.opts<CliOptions>();
        const preset: 'full' | 'user-data' = opts.preset === 'full' ? 'full' : 'user-data';
        const runOpts: Parameters<typeof runMigrateOpenClaw>[0] = {
          preset,
          dryRun: opts.dryRun,
          nonInteractive: opts.nonInteractive,
        };
        if (opts.source !== undefined) runOpts.source = opts.source;
        const result = await runMigrateOpenClaw(runOpts);
        emit(result, global);
        process.exit(result.exitCode);
      },
    );

  migrate
    .command('hermes')
    .description('migrate from ~/.hermes → ~/.hipp0')
    .option('--source <path>', 'override auto-detected source directory')
    .option('--preset <preset>', 'full | user-data (default user-data)', 'user-data')
    .option('--dry-run', 'preview without writing anything', false)
    .option('--non-interactive', 'implies --dry-run unless --dry-run=false', false)
    .action(
      async (opts: { source?: string; preset: string; dryRun: boolean; nonInteractive: boolean }) => {
        const global = program.opts<CliOptions>();
        const preset: 'full' | 'user-data' = opts.preset === 'full' ? 'full' : 'user-data';
        const runOpts: Parameters<typeof runMigrateHermes>[0] = {
          preset,
          dryRun: opts.dryRun,
          nonInteractive: opts.nonInteractive,
        };
        if (opts.source !== undefined) runOpts.source = opts.source;
        const result = await runMigrateHermes(runOpts);
        emit(result, global);
        process.exit(result.exitCode);
      },
    );

  program
    .command('benchmark')
    .description('list available benchmark suites')
    .option('--suite <name>', 'suite name (default: all)', 'all')
    .action(async (opts: { suite: string }) => {
      const global = program.opts<CliOptions>();
      const result = await runBenchmark({ suite: opts.suite });
      emit(result, global);
      process.exit(result.exitCode);
    });

  program
    .command('update')
    .description('check for updates, install the latest release, rollback, or switch to canary')
    .option('--check', 'check the registry without installing', false)
    .option('--dry-run', 'show what would be upgraded without applying', false)
    .option('--rollback', 'revert to the previous version', false)
    .option('--canary', 'install the canary (pre-release) channel', false)
    .action(
      async (opts: { check: boolean; dryRun: boolean; rollback: boolean; canary: boolean }) => {
        const global = program.opts<CliOptions>();
        const result = await runUpdate({
          check: opts.check,
          dryRun: opts.dryRun,
          rollback: opts.rollback,
          canary: opts.canary,
          currentVersion: version,
        });
        emit(result, global);
        process.exit(result.exitCode);
      },
    );

  return program;
}

/** Production entrypoint. Translates Hipp0CliError into structured output. */
export async function runCli(argv: readonly string[]): Promise<never> {
  const program = createProgram();
  try {
    await program.parseAsync([...argv], { from: 'user' });
  } catch (err) {
    if (err instanceof Hipp0CliError) {
      const global = program.opts<CliOptions>();
      emit({ exitCode: err.exitCode, stderr: [`error: ${err.message}`] }, global);
      process.exit(err.exitCode);
    }
    console.error('fatal:', (err as Error).stack ?? String(err));
    process.exit(1);
  }
  process.exit(0);
}
