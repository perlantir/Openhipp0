/**
 * `hipp0 config get <key>` / `hipp0 config set <key> <value>` — read/write config.
 *
 * Dotted keys (e.g. `llm.provider`) index into the nested config object.
 * `setConfigValue` validates the full config after mutation, so an invalid
 * value is rejected without persisting.
 */

import {
  defaultConfigPath,
  getConfigValue,
  nodeFileSystem,
  readConfig,
  setConfigValue,
  writeConfig,
  type FileSystem,
} from '../config.js';
import { Hipp0CliError, type CommandResult } from '../types.js';

export interface ConfigOptions {
  configPath?: string;
  filesystem?: FileSystem;
}

export async function runConfigGet(key: string, opts: ConfigOptions = {}): Promise<CommandResult> {
  const filesystem = opts.filesystem ?? nodeFileSystem;
  const configPath = opts.configPath ?? defaultConfigPath();
  const config = await readConfig(configPath, filesystem);
  const value = getConfigValue(config, key);
  if (value === undefined) {
    throw new Hipp0CliError(`Config key not set: ${key}`, 'HIPP0_CLI_CONFIG_KEY_MISSING', 1);
  }
  const printed = typeof value === 'string' ? value : JSON.stringify(value);
  return { exitCode: 0, stdout: [printed], data: { key, value } };
}

export async function runConfigSet(
  key: string,
  value: string,
  opts: ConfigOptions = {},
): Promise<CommandResult> {
  const filesystem = opts.filesystem ?? nodeFileSystem;
  const configPath = opts.configPath ?? defaultConfigPath();
  const current = await readConfig(configPath, filesystem);
  const next = setConfigValue(current, key, value);
  await writeConfig(next, configPath, filesystem);
  return {
    exitCode: 0,
    stdout: [`✓ ${key} = ${value}`],
    data: { key, value, config: next },
  };
}
