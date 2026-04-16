import { describe, it, expect } from 'vitest';
import { runAgentAdd, runAgentList, runAgentRemove } from '../../src/commands/agent.js';
import { Hipp0CliError } from '../../src/types.js';
import { readConfig } from '../../src/config.js';
import { createMemoryFs } from '../helpers/memory-fs.js';

const CONFIG_PATH = '/tmp/hipp0-test-agent/config.json';

describe('runAgentAdd', () => {
  it('adds agent with name+domain+skills', async () => {
    const fs = createMemoryFs();
    const result = await runAgentAdd('coder', {
      configPath: CONFIG_PATH,
      filesystem: fs,
      domain: 'dev',
      skills: ['typescript', 'testing'],
    });
    expect(result.exitCode).toBe(0);
    const cfg = await readConfig(CONFIG_PATH, fs);
    expect(cfg.agents).toHaveLength(1);
    expect(cfg.agents[0]).toMatchObject({ name: 'coder', domain: 'dev' });
    expect(cfg.agents[0]!.skills).toEqual(['typescript', 'testing']);
  });

  it('rejects duplicate agent name', async () => {
    const fs = createMemoryFs();
    await runAgentAdd('coder', { configPath: CONFIG_PATH, filesystem: fs });
    await expect(
      runAgentAdd('coder', { configPath: CONFIG_PATH, filesystem: fs }),
    ).rejects.toBeInstanceOf(Hipp0CliError);
  });

  it('rejects empty name', async () => {
    const fs = createMemoryFs();
    await expect(runAgentAdd('', { configPath: CONFIG_PATH, filesystem: fs })).rejects.toThrow(
      /required/,
    );
  });
});

describe('runAgentList', () => {
  it('reports empty when no agents', async () => {
    const fs = createMemoryFs();
    const result = await runAgentList({ configPath: CONFIG_PATH, filesystem: fs });
    expect(result.exitCode).toBe(0);
    expect(result.stdout?.[0]).toMatch(/No agents/);
  });

  it('lists agents after add', async () => {
    const fs = createMemoryFs();
    await runAgentAdd('a1', { configPath: CONFIG_PATH, filesystem: fs, domain: 'd1' });
    await runAgentAdd('a2', { configPath: CONFIG_PATH, filesystem: fs });
    const result = await runAgentList({ configPath: CONFIG_PATH, filesystem: fs });
    expect(result.stdout?.[0]).toMatch(/Agents \(2\)/);
    const joined = result.stdout?.join('\n') ?? '';
    expect(joined).toContain('a1');
    expect(joined).toContain('a2');
  });
});

describe('runAgentRemove', () => {
  it('removes existing agent', async () => {
    const fs = createMemoryFs();
    await runAgentAdd('a1', { configPath: CONFIG_PATH, filesystem: fs });
    const result = await runAgentRemove('a1', { configPath: CONFIG_PATH, filesystem: fs });
    expect(result.exitCode).toBe(0);
    const cfg = await readConfig(CONFIG_PATH, fs);
    expect(cfg.agents).toHaveLength(0);
  });

  it('throws on missing agent', async () => {
    const fs = createMemoryFs();
    await expect(
      runAgentRemove('ghost', { configPath: CONFIG_PATH, filesystem: fs }),
    ).rejects.toThrow(/not found/);
  });
});
