import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CanaryUpdater } from '../../src/index.js';

describe('CanaryUpdater', () => {
  let workdir: string;
  let dataFile: string;
  let destDir: string;

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'hipp0-canary-'));
    dataFile = path.join(workdir, 'data.db');
    destDir = path.join(workdir, 'backups');
    await fs.mkdir(destDir, { recursive: true });
    await fs.writeFile(dataFile, 'v1', 'utf8');
  });

  afterEach(async () => {
    await fs.rm(workdir, { recursive: true, force: true });
  });

  it('runs observe at least once even with a tiny window', async () => {
    let observeCount = 0;
    const result = await new CanaryUpdater().run({
      backup: { sources: [dataFile], destDir },
      migrate: async () => {
        await fs.writeFile(dataFile, 'v2', 'utf8');
      },
      smokeTest: async () => {},
      observeWindowMs: 5,
      observeIntervalMs: 100,
      observe: async () => {
        observeCount++;
      },
    });
    expect(observeCount).toBeGreaterThanOrEqual(1);
    expect(result.status).toBe('success');
    expect(result.stages.some((s) => s.name === 'observe')).toBe(true);
  });

  it('rolls back when observe throws during the window', async () => {
    const result = await new CanaryUpdater().run({
      backup: { sources: [dataFile], destDir },
      migrate: async () => {
        await fs.writeFile(dataFile, 'v2', 'utf8');
      },
      smokeTest: async () => {},
      observeWindowMs: 5,
      observeIntervalMs: 100,
      observe: async () => {
        throw new Error('canary degradation');
      },
    });
    expect(result.status).toBe('rolled_back');
    expect(await fs.readFile(dataFile, 'utf8')).toBe('v1');
  });

  it('polls observe multiple times within the window', async () => {
    let observeCount = 0;
    await new CanaryUpdater().run({
      backup: { sources: [dataFile], destDir },
      migrate: async () => {},
      smokeTest: async () => {},
      observeWindowMs: 90,
      observeIntervalMs: 25,
      observe: async () => {
        observeCount++;
      },
    });
    // Window 90ms / 25ms interval → observe runs at t=0, then ≥3 polls fit. Allow slop.
    expect(observeCount).toBeGreaterThanOrEqual(2);
  });
});
