import { describe, it, expect } from 'vitest';
import { runCronAdd, runCronList, runCronRemove } from '../../src/commands/cron.js';
import { Hipp0CliError } from '../../src/types.js';
import { readConfig } from '../../src/config.js';
import { createMemoryFs } from '../helpers/memory-fs.js';

const CONFIG_PATH = '/tmp/hipp0-test-cron/config.json';

describe('runCronAdd', () => {
  it('adds cron task with natural-language schedule', async () => {
    const fs = createMemoryFs();
    const result = await runCronAdd('nightly', 'every day at 2:00', {
      configPath: CONFIG_PATH,
      filesystem: fs,
      now: new Date('2026-04-15T12:00:00Z'),
    });
    expect(result.exitCode).toBe(0);
    expect(result.data).toMatchObject({
      id: 'nightly',
      schedule: 'every day at 2:00',
      cronExpression: '0 2 * * *',
    });
    const cfg = await readConfig(CONFIG_PATH, fs);
    expect(cfg.cronTasks).toHaveLength(1);
    expect(cfg.cronTasks[0]).toMatchObject({ id: 'nightly', enabled: true });
  });

  it('adds cron task with raw 5-field expression', async () => {
    const fs = createMemoryFs();
    const result = await runCronAdd('five', '0 */5 * * *', {
      configPath: CONFIG_PATH,
      filesystem: fs,
    });
    expect(result.exitCode).toBe(0);
  });

  it('rejects invalid cron', async () => {
    const fs = createMemoryFs();
    await expect(
      runCronAdd('bad', 'this is not a cron', { configPath: CONFIG_PATH, filesystem: fs }),
    ).rejects.toBeInstanceOf(Hipp0CliError);
  });

  it('rejects empty id', async () => {
    const fs = createMemoryFs();
    await expect(
      runCronAdd('', '* * * * *', { configPath: CONFIG_PATH, filesystem: fs }),
    ).rejects.toThrow(/required/);
  });

  it('rejects duplicate id', async () => {
    const fs = createMemoryFs();
    await runCronAdd('nightly', '0 2 * * *', { configPath: CONFIG_PATH, filesystem: fs });
    await expect(
      runCronAdd('nightly', '0 3 * * *', { configPath: CONFIG_PATH, filesystem: fs }),
    ).rejects.toThrow(/already exists/);
  });

  it('honors --disabled flag', async () => {
    const fs = createMemoryFs();
    await runCronAdd('paused', '0 1 * * *', {
      configPath: CONFIG_PATH,
      filesystem: fs,
      enabled: false,
    });
    const cfg = await readConfig(CONFIG_PATH, fs);
    expect(cfg.cronTasks[0]?.enabled).toBe(false);
  });
});

describe('runCronList', () => {
  it('reports empty when no tasks', async () => {
    const fs = createMemoryFs();
    const result = await runCronList({ configPath: CONFIG_PATH, filesystem: fs });
    expect(result.stdout?.[0]).toMatch(/No cron tasks/);
  });

  it('lists tasks with state tag', async () => {
    const fs = createMemoryFs();
    await runCronAdd('t1', 'every hour', { configPath: CONFIG_PATH, filesystem: fs });
    await runCronAdd('t2', '0 0 * * *', {
      configPath: CONFIG_PATH,
      filesystem: fs,
      enabled: false,
    });
    const result = await runCronList({ configPath: CONFIG_PATH, filesystem: fs });
    const joined = result.stdout?.join('\n') ?? '';
    expect(joined).toContain('[on ] t1');
    expect(joined).toContain('[off] t2');
  });
});

describe('runCronRemove', () => {
  it('removes existing task', async () => {
    const fs = createMemoryFs();
    await runCronAdd('t1', 'every hour', { configPath: CONFIG_PATH, filesystem: fs });
    const result = await runCronRemove('t1', { configPath: CONFIG_PATH, filesystem: fs });
    expect(result.exitCode).toBe(0);
    const cfg = await readConfig(CONFIG_PATH, fs);
    expect(cfg.cronTasks).toHaveLength(0);
  });

  it('throws on missing task', async () => {
    const fs = createMemoryFs();
    await expect(
      runCronRemove('ghost', { configPath: CONFIG_PATH, filesystem: fs }),
    ).rejects.toThrow(/not found/);
  });
});
