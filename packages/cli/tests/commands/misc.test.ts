import { describe, it, expect } from 'vitest';
import {
  runBenchmark,
  runMigrateCopy,
  runMigrateDump,
  runMigrateRestore,
  runUpdate,
} from '../../src/commands/misc.js';
import { Hipp0CliError } from '../../src/types.js';

describe('migrate commands', () => {
  it('dump copies the DB file to destination', async () => {
    const copied: Array<[string, string]> = [];
    const result = await runMigrateDump('/tmp/out.db', {
      copyFile: async (s, d) => {
        copied.push([s, d]);
      },
      resolveDbPath: () => '/tmp/hipp0.db',
    });
    expect(result.exitCode).toBe(0);
    expect(copied).toEqual([['/tmp/hipp0.db', '/tmp/out.db']]);
  });

  it('dump refuses :memory:', async () => {
    await expect(
      runMigrateDump('/tmp/out.db', {
        copyFile: async () => {},
        resolveDbPath: () => ':memory:',
      }),
    ).rejects.toBeInstanceOf(Hipp0CliError);
  });

  it('restore requires --force', async () => {
    await expect(
      runMigrateRestore('/tmp/in.db', {
        copyFile: async () => {},
        resolveDbPath: () => '/tmp/hipp0.db',
      }),
    ).rejects.toThrow(/--force/);
  });

  it('restore with --force copies into DB path', async () => {
    const copied: Array<[string, string]> = [];
    const result = await runMigrateRestore('/tmp/in.db', {
      force: true,
      copyFile: async (s, d) => {
        copied.push([s, d]);
      },
      resolveDbPath: () => '/tmp/hipp0.db',
    });
    expect(result.exitCode).toBe(0);
    expect(copied).toEqual([['/tmp/in.db', '/tmp/hipp0.db']]);
  });

  it('copy delegates to copyFile', async () => {
    const copied: Array<[string, string]> = [];
    await runMigrateCopy('/tmp/a.db', '/tmp/b.db', {
      copyFile: async (s, d) => {
        copied.push([s, d]);
      },
    });
    expect(copied).toHaveLength(1);
  });
});

describe('runBenchmark', () => {
  it('lists all suites by default', async () => {
    const result = await runBenchmark();
    expect(result.exitCode).toBe(0);
    const text = result.stdout?.join('\n') ?? '';
    expect(text).toContain('memory');
    expect(text).toContain('scheduler');
  });

  it('filters by suite name', async () => {
    const result = await runBenchmark({ suite: 'memory' });
    const text = result.stdout?.join('\n') ?? '';
    expect(text).toContain('memory');
    expect(text).not.toContain('scheduler');
  });

  it('rejects unknown suite', async () => {
    await expect(runBenchmark({ suite: 'bogus' })).rejects.toBeInstanceOf(Hipp0CliError);
  });
});

describe('runUpdate', () => {
  it('returns phase 8 placeholder with mode label', async () => {
    const result = await runUpdate({ dryRun: true, canary: true });
    expect(result.exitCode).toBe(0);
    const text = result.stdout?.join('\n') ?? '';
    expect(text).toContain('dry-run+canary');
  });
});
