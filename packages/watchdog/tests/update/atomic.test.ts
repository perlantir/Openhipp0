import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AtomicUpdater, Hipp0RollbackFailedError } from '../../src/index.js';

describe('AtomicUpdater', () => {
  let workdir: string;
  let dataFile: string;
  let destDir: string;

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'hipp0-atomic-'));
    dataFile = path.join(workdir, 'data.db');
    destDir = path.join(workdir, 'backups');
    await fs.mkdir(destDir, { recursive: true });
    await fs.writeFile(dataFile, 'v1-data', 'utf8');
  });

  afterEach(async () => {
    await fs.rm(workdir, { recursive: true, force: true });
  });

  it('runs backup → migrate → smoke → commit on the happy path', async () => {
    const calls: string[] = [];
    const result = await new AtomicUpdater().run({
      backup: { sources: [dataFile], destDir },
      migrate: async () => {
        calls.push('migrate');
        await fs.writeFile(dataFile, 'v2-data', 'utf8');
      },
      smokeTest: async () => {
        calls.push('smoke');
      },
      commit: async () => {
        calls.push('commit');
      },
    });
    expect(calls).toEqual(['migrate', 'smoke', 'commit']);
    expect(result.status).toBe('success');
    expect(result.stages.map((s) => s.name)).toEqual(['backup', 'migrate', 'smoke', 'commit']);
    expect(await fs.readFile(dataFile, 'utf8')).toBe('v2-data');
  });

  it('rolls back when smoke fails — data file is restored to pre-update state', async () => {
    const result = await new AtomicUpdater().run({
      backup: { sources: [dataFile], destDir },
      migrate: async () => {
        await fs.writeFile(dataFile, 'v2-data', 'utf8');
      },
      smokeTest: async () => {
        throw new Error('smoke failed');
      },
    });
    expect(result.status).toBe('rolled_back');
    expect(result.stages.map((s) => s.name)).toEqual(['backup', 'migrate', 'smoke', 'rollback']);
    expect(await fs.readFile(dataFile, 'utf8')).toBe('v1-data');
  });

  it('rolls back when migrate fails before any data change', async () => {
    const result = await new AtomicUpdater().run({
      backup: { sources: [dataFile], destDir },
      migrate: async () => {
        throw new Error('migrate failed');
      },
      smokeTest: async () => {},
    });
    expect(result.status).toBe('rolled_back');
    expect(result.stages.find((s) => s.name === 'smoke')).toBeUndefined();
  });

  it('rolls back when commit fails', async () => {
    const result = await new AtomicUpdater().run({
      backup: { sources: [dataFile], destDir },
      migrate: async () => {
        await fs.writeFile(dataFile, 'v2-data', 'utf8');
      },
      smokeTest: async () => {},
      commit: async () => {
        throw new Error('commit failed');
      },
    });
    expect(result.status).toBe('rolled_back');
    expect(await fs.readFile(dataFile, 'utf8')).toBe('v1-data');
  });

  it('dryRun stops after backup; no migrate/smoke/commit invoked', async () => {
    const calls: string[] = [];
    const result = await new AtomicUpdater().run({
      backup: { sources: [dataFile], destDir },
      migrate: async () => {
        calls.push('migrate');
      },
      smokeTest: async () => {
        calls.push('smoke');
      },
      commit: async () => {
        calls.push('commit');
      },
      dryRun: true,
    });
    expect(calls).toEqual([]);
    expect(result.status).toBe('aborted_dry_run');
    expect(result.stages.map((s) => s.name)).toEqual(['backup', 'commit']);
  });

  it('throws Hipp0RollbackFailedError when restore itself blows up', async () => {
    const updater = new AtomicUpdater();
    // Cause restore to fail by deleting the backup dir before rollback runs.
    const result = updater.run({
      backup: { sources: [dataFile], destDir },
      migrate: async () => {
        // Wipe the backups dir so restore() can't find files.
        await fs.rm(destDir, { recursive: true, force: true });
        throw new Error('migrate failed (sabotaged)');
      },
      smokeTest: async () => {},
    });
    await expect(result).rejects.toBeInstanceOf(Hipp0RollbackFailedError);
  });
});
