import { describe, it, expect } from 'vitest';
import {
  getConfigValue,
  readConfig,
  setConfigValue,
  writeConfig,
} from '../src/config.js';
import { Hipp0CliError, Hipp0ConfigSchema } from '../src/types.js';
import { createMemoryFs } from './helpers/memory-fs.js';

const CONFIG_PATH = '/tmp/hipp0-test/config.json';

describe('config read/write', () => {
  it('readConfig returns default when file missing', async () => {
    const fs = createMemoryFs();
    const cfg = await readConfig(CONFIG_PATH, fs);
    expect(cfg.agents).toEqual([]);
    expect(cfg.cronTasks).toEqual([]);
    expect(cfg.project).toBeUndefined();
  });

  it('writeConfig persists valid JSON that readConfig can parse back', async () => {
    const fs = createMemoryFs();
    const cfg = Hipp0ConfigSchema.parse({
      project: { name: 'demo', createdAt: '2026-01-01T00:00:00Z' },
      llm: { provider: 'anthropic' },
      bridges: ['web'],
      database: { type: 'sqlite' },
    });
    await writeConfig(cfg, CONFIG_PATH, fs);
    const round = await readConfig(CONFIG_PATH, fs);
    expect(round.project?.name).toBe('demo');
    expect(round.llm?.provider).toBe('anthropic');
    expect(round.bridges).toEqual(['web']);
  });

  it('readConfig throws Hipp0CliError on invalid JSON', async () => {
    const fs = createMemoryFs({ [CONFIG_PATH]: 'not json {' });
    await expect(readConfig(CONFIG_PATH, fs)).rejects.toBeInstanceOf(Hipp0CliError);
  });

  it('readConfig throws Hipp0CliError on invalid schema', async () => {
    const fs = createMemoryFs({ [CONFIG_PATH]: JSON.stringify({ llm: { provider: 'gemini' } }) });
    await expect(readConfig(CONFIG_PATH, fs)).rejects.toThrow(/schema invalid/);
  });
});

describe('getConfigValue / setConfigValue', () => {
  it('sets top-level and nested keys', () => {
    const cfg = Hipp0ConfigSchema.parse({});
    const next = setConfigValue(cfg, 'llm.provider', 'openai');
    expect(next.llm?.provider).toBe('openai');
  });

  it('coerces boolean and numeric values', () => {
    const cfg = Hipp0ConfigSchema.parse({});
    const withBool = setConfigValue(cfg, 'database.type', 'postgres');
    expect(withBool.database?.type).toBe('postgres');
  });

  it('rejects invalid values', () => {
    const cfg = Hipp0ConfigSchema.parse({});
    expect(() => setConfigValue(cfg, 'llm.provider', 'gemini')).toThrow(Hipp0CliError);
  });

  it('getConfigValue returns undefined for missing keys', () => {
    const cfg = Hipp0ConfigSchema.parse({});
    expect(getConfigValue(cfg, 'nothing.here')).toBeUndefined();
  });

  it('getConfigValue returns nested values', () => {
    const cfg = Hipp0ConfigSchema.parse({ llm: { provider: 'anthropic' } });
    expect(getConfigValue(cfg, 'llm.provider')).toBe('anthropic');
  });
});
