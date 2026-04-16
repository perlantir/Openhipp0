/**
 * `hipp0 agent add|list|remove` — manages the agent list in config.agents[].
 *
 * Agents here are declarative — this command does not spawn runtimes. The
 * orchestrator (Phase 6) reads the same config at start time to route tasks.
 */

import {
  defaultConfigPath,
  nodeFileSystem,
  readConfig,
  writeConfig,
  type FileSystem,
} from '../config.js';
import { Hipp0CliError, type CommandResult } from '../types.js';

export interface AgentCommandOptions {
  configPath?: string;
  filesystem?: FileSystem;
}

export interface AddAgentOptions extends AgentCommandOptions {
  domain?: string;
  skills?: readonly string[];
}

export async function runAgentAdd(
  name: string,
  opts: AddAgentOptions = {},
): Promise<CommandResult> {
  if (!name || !name.trim()) {
    throw new Hipp0CliError('Agent name is required.', 'HIPP0_CLI_AGENT_MISSING_NAME');
  }
  const filesystem = opts.filesystem ?? nodeFileSystem;
  const configPath = opts.configPath ?? defaultConfigPath();
  const config = await readConfig(configPath, filesystem);
  if (config.agents.some((a) => a.name === name)) {
    throw new Hipp0CliError(`Agent already exists: ${name}`, 'HIPP0_CLI_AGENT_EXISTS');
  }
  const next = {
    ...config,
    agents: [
      ...config.agents,
      { name, domain: opts.domain ?? '', skills: [...(opts.skills ?? [])] },
    ],
  };
  await writeConfig(next, configPath, filesystem);
  return {
    exitCode: 0,
    stdout: [`✓ Added agent "${name}"${opts.domain ? ` (${opts.domain})` : ''}`],
    data: { name, domain: opts.domain ?? '', skills: opts.skills ?? [] },
  };
}

export async function runAgentList(opts: AgentCommandOptions = {}): Promise<CommandResult> {
  const filesystem = opts.filesystem ?? nodeFileSystem;
  const configPath = opts.configPath ?? defaultConfigPath();
  const config = await readConfig(configPath, filesystem);
  if (config.agents.length === 0) {
    return { exitCode: 0, stdout: ['No agents configured.'], data: { agents: [] } };
  }
  const lines: string[] = [`Agents (${config.agents.length}):`];
  for (const a of config.agents) {
    const skills = a.skills.length > 0 ? ` [${a.skills.join(', ')}]` : '';
    const domain = a.domain ? ` — ${a.domain}` : '';
    lines.push(`  ${a.name}${domain}${skills}`);
  }
  return { exitCode: 0, stdout: lines, data: { agents: config.agents } };
}

export async function runAgentRemove(
  name: string,
  opts: AgentCommandOptions = {},
): Promise<CommandResult> {
  const filesystem = opts.filesystem ?? nodeFileSystem;
  const configPath = opts.configPath ?? defaultConfigPath();
  const config = await readConfig(configPath, filesystem);
  const before = config.agents.length;
  const next = { ...config, agents: config.agents.filter((a) => a.name !== name) };
  if (next.agents.length === before) {
    throw new Hipp0CliError(`Agent not found: ${name}`, 'HIPP0_CLI_AGENT_NOT_FOUND');
  }
  await writeConfig(next, configPath, filesystem);
  return { exitCode: 0, stdout: [`✓ Removed agent "${name}"`], data: { name } };
}
