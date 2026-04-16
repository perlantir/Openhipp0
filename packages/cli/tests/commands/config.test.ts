import { describe, it, expect } from 'vitest';
import { runConfigGet, runConfigSet } from '../../src/commands/config.js';
import { Hipp0CliError } from '../../src/types.js';
import { readConfig } from '../../src/config.js';
import { createMemoryFs } from '../helpers/memory-fs.js';

const CONFIG_PATH = '/tmp/hipp0-test/config.json';

describe('runConfigSet', () => {
  it('creates config and sets key when none exists', async () => {
    const fs = createMemoryFs();
    const result = await runConfigSet('llm.provider', 'openai', {
      configPath: CONFIG_PATH,
      filesystem: fs,
    });
    expect(result.exitCode).toBe(0);
    const cfg = await readConfig(CONFIG_PATH, fs);
    expect(cfg.llm?.provider).toBe('openai');
  });

  it('rejects invalid value', async () => {
    const fs = createMemoryFs();
    await expect(
      runConfigSet('llm.provider', 'gemini', { configPath: CONFIG_PATH, filesystem: fs }),
    ).rejects.toBeInstanceOf(Hipp0CliError);
  });
});

describe('runConfigGet', () => {
  it('returns value when set', async () => {
    const fs = createMemoryFs();
    await runConfigSet('llm.provider', 'openai', { configPath: CONFIG_PATH, filesystem: fs });
    const result = await runConfigGet('llm.provider', { configPath: CONFIG_PATH, filesystem: fs });
    expect(result.exitCode).toBe(0);
    expect(result.data).toMatchObject({ key: 'llm.provider', value: 'openai' });
  });

  it('throws when key missing', async () => {
    const fs = createMemoryFs();
    await expect(
      runConfigGet('llm.provider', { configPath: CONFIG_PATH, filesystem: fs }),
    ).rejects.toThrow(/not set/);
  });
});
