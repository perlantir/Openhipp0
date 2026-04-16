/**
 * `hipp0 init [name]` — interactive project wizard.
 *
 * Walks the user through selecting LLM provider, enabled bridges, and database
 * backend. Writes the result to ~/.hipp0/config.json (or HIPP0_HOME).
 *
 * In tests, the prompt + filesystem are injected so the wizard runs fully
 * offline and deterministically.
 */

import { nodeFileSystem, defaultConfigPath, writeConfig, type FileSystem } from '../config.js';
import { Hipp0CliError, type CommandResult, type Hipp0Config, type PromptFn } from '../types.js';

export interface InitOptions {
  /** Project name passed positionally; if missing, we prompt for it. */
  name?: string;
  /** Overwrite an existing config without prompting. */
  force?: boolean;
  /** Non-interactive: accept all defaults, require name. */
  nonInteractive?: boolean;
  configPath?: string;
  filesystem?: FileSystem;
  prompt?: PromptFn;
}

const VALID_PROVIDERS = ['anthropic', 'openai', 'ollama'] as const;
const VALID_BRIDGES = ['discord', 'telegram', 'slack', 'web', 'cli'] as const;
const VALID_DB = ['sqlite', 'postgres'] as const;

export async function runInit(opts: InitOptions = {}): Promise<CommandResult> {
  const filesystem = opts.filesystem ?? nodeFileSystem;
  const configPath = opts.configPath ?? defaultConfigPath();
  const prompt = opts.prompt;
  const stdout: string[] = [];

  if ((await filesystem.exists(configPath)) && !opts.force) {
    throw new Hipp0CliError(
      `Config already exists at ${configPath}. Re-run with --force to overwrite.`,
      'HIPP0_CLI_CONFIG_EXISTS',
    );
  }

  // --- name ---
  let name = opts.name?.trim();
  if (!name) {
    if (opts.nonInteractive) {
      throw new Hipp0CliError(
        'Project name required in non-interactive mode (pass it positionally).',
        'HIPP0_CLI_INIT_MISSING_NAME',
      );
    }
    if (!prompt) {
      throw new Hipp0CliError(
        'Interactive mode requires a prompt function.',
        'HIPP0_CLI_INIT_NO_PROMPT',
      );
    }
    name = (await prompt('Project name: ')).trim();
    if (!name) {
      throw new Hipp0CliError('Project name cannot be empty.', 'HIPP0_CLI_INIT_EMPTY_NAME');
    }
  }

  // --- LLM provider ---
  let provider: (typeof VALID_PROVIDERS)[number] = 'anthropic';
  if (!opts.nonInteractive && prompt) {
    const answer = (await prompt('LLM provider (anthropic/openai/ollama) [anthropic]: ')).trim();
    if (answer !== '') {
      if (!(VALID_PROVIDERS as readonly string[]).includes(answer)) {
        throw new Hipp0CliError(
          `Unknown provider "${answer}". Valid: ${VALID_PROVIDERS.join(', ')}.`,
          'HIPP0_CLI_INIT_BAD_PROVIDER',
        );
      }
      provider = answer as (typeof VALID_PROVIDERS)[number];
    }
  }

  // --- bridges (comma-separated) ---
  let bridges: (typeof VALID_BRIDGES)[number][] = ['web', 'cli'];
  if (!opts.nonInteractive && prompt) {
    const answer = (
      await prompt('Enable bridges (comma-separated: discord,telegram,slack,web,cli) [web,cli]: ')
    ).trim();
    if (answer !== '') {
      const tokens = answer
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      for (const t of tokens) {
        if (!(VALID_BRIDGES as readonly string[]).includes(t)) {
          throw new Hipp0CliError(
            `Unknown bridge "${t}". Valid: ${VALID_BRIDGES.join(', ')}.`,
            'HIPP0_CLI_INIT_BAD_BRIDGE',
          );
        }
      }
      bridges = tokens as (typeof VALID_BRIDGES)[number][];
    }
  }

  // --- database ---
  let database: (typeof VALID_DB)[number] = 'sqlite';
  if (!opts.nonInteractive && prompt) {
    const answer = (await prompt('Database (sqlite/postgres) [sqlite]: ')).trim();
    if (answer !== '') {
      if (!(VALID_DB as readonly string[]).includes(answer)) {
        throw new Hipp0CliError(
          `Unknown database "${answer}". Valid: ${VALID_DB.join(', ')}.`,
          'HIPP0_CLI_INIT_BAD_DB',
        );
      }
      database = answer as (typeof VALID_DB)[number];
    }
  }

  const config: Hipp0Config = {
    project: { name, createdAt: new Date().toISOString() },
    llm: { provider },
    bridges,
    database: { type: database },
    agents: [],
    cronTasks: [],
  };

  await writeConfig(config, configPath, filesystem);
  stdout.push(`✓ Initialized hipp0 project "${name}".`);
  stdout.push(`  config: ${configPath}`);
  stdout.push(`  LLM:    ${provider}`);
  stdout.push(`  bridges: ${bridges.join(', ')}`);
  stdout.push(`  database: ${database}`);
  return { exitCode: 0, stdout, data: { config, configPath } };
}

/** Bind node:readline/promises to a PromptFn (lazy-import to keep browsers happy). */
export async function nodePrompt(): Promise<PromptFn> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const prompt: PromptFn = async (q) => rl.question(q);
  // Note: caller is responsible for closing via rl.close() after last prompt.
  (prompt as PromptFn & { close: () => void }).close = () => rl.close();
  return prompt;
}
