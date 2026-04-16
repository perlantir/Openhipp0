/**
 * Config file helpers — read, write, and locate ~/.hipp0/config.json.
 *
 * All I/O is injected via a FileSystem interface so tests can use an
 * in-memory fake without hitting disk. The production FileSystem wraps
 * node:fs/promises.
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { Hipp0CliError, Hipp0ConfigSchema, type Hipp0Config } from './types.js';

export interface FileSystem {
  readFile(p: string): Promise<string>;
  writeFile(p: string, content: string): Promise<void>;
  mkdir(p: string, opts: { recursive: boolean }): Promise<void>;
  exists(p: string): Promise<boolean>;
}

export const nodeFileSystem: FileSystem = {
  async readFile(p) {
    return fs.readFile(p, 'utf8');
  },
  async writeFile(p, content) {
    await fs.writeFile(p, content, 'utf8');
  },
  async mkdir(p, opts) {
    await fs.mkdir(p, opts);
  },
  async exists(p) {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  },
};

/** Default config directory: $HIPP0_HOME || ~/.hipp0 */
export function defaultConfigDir(): string {
  return process.env['HIPP0_HOME'] ?? path.join(homedir(), '.hipp0');
}

export function defaultConfigPath(configDir: string = defaultConfigDir()): string {
  return path.join(configDir, 'config.json');
}

export async function readConfig(
  configPath: string = defaultConfigPath(),
  filesystem: FileSystem = nodeFileSystem,
): Promise<Hipp0Config> {
  if (!(await filesystem.exists(configPath))) {
    // Return default empty config.
    return Hipp0ConfigSchema.parse({});
  }
  const raw = await filesystem.readFile(configPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Hipp0CliError(
      `Config file is not valid JSON: ${configPath} (${(err as Error).message})`,
      'HIPP0_CLI_CONFIG_INVALID',
    );
  }
  const result = Hipp0ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Hipp0CliError(
      `Config file schema invalid at ${configPath}: ${result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
      'HIPP0_CLI_CONFIG_INVALID',
    );
  }
  return result.data;
}

export async function writeConfig(
  config: Hipp0Config,
  configPath: string = defaultConfigPath(),
  filesystem: FileSystem = nodeFileSystem,
): Promise<void> {
  const dir = path.dirname(configPath);
  await filesystem.mkdir(dir, { recursive: true });
  // Validate before writing so we never persist an invalid shape.
  const validated = Hipp0ConfigSchema.parse(config);
  await filesystem.writeFile(configPath, JSON.stringify(validated, null, 2));
}

/** Apply a JSON-path-like key to config. Supports top-level + `agents.0.name`. */
export function setConfigValue(config: Hipp0Config, key: string, value: string): Hipp0Config {
  const parts = key.split('.');
  // Deep clone to stay immutable. Config is a plain JSON object.
  const next = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  let cursor: Record<string, unknown> | unknown[] = next;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const cur = cursor as Record<string, unknown>;
    if (cur[p] === undefined || cur[p] === null) {
      cur[p] = {};
    }
    cursor = cur[p] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1]!;
  (cursor as Record<string, unknown>)[last] = coerce(value);
  const parsed = Hipp0ConfigSchema.safeParse(next);
  if (!parsed.success) {
    throw new Hipp0CliError(
      `Invalid value for ${key}: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
      'HIPP0_CLI_CONFIG_INVALID',
    );
  }
  return parsed.data;
}

/** Extract a value from config by dotted key. Returns undefined if missing. */
export function getConfigValue(config: Hipp0Config, key: string): unknown {
  const parts = key.split('.');
  let cursor: unknown = config;
  for (const p of parts) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[p];
  }
  return cursor;
}

/** Coerce a string CLI argument into the natural type (bool/number/string). */
function coerce(value: string): string | number | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}
