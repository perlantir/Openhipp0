import { describe, it, expect } from 'vitest';
import { runStart, runStatus, runStop } from '../../src/commands/lifecycle.js';
import { createMemoryFs } from '../helpers/memory-fs.js';
import path from 'node:path';

const CONFIG_DIR = '/tmp/hipp0-test-lifecycle';
const PID_FILE = path.join(CONFIG_DIR, 'hipp0.pid');

describe('runStatus', () => {
  it('exits 3 when no pidfile', async () => {
    const fs = createMemoryFs();
    const result = await runStatus({ configDir: CONFIG_DIR, filesystem: fs });
    expect(result.exitCode).toBe(3);
    expect(result.data).toMatchObject({ running: false, pid: null });
  });

  it('exits 0 when pid is alive', async () => {
    const fs = createMemoryFs({ [PID_FILE]: '12345\n' });
    const result = await runStatus({
      configDir: CONFIG_DIR,
      filesystem: fs,
      checkAlive: () => true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.data).toMatchObject({ running: true, pid: 12345 });
  });

  it('exits 3 when pid is stale', async () => {
    const fs = createMemoryFs({ [PID_FILE]: '999\n' });
    const result = await runStatus({
      configDir: CONFIG_DIR,
      filesystem: fs,
      checkAlive: () => false,
    });
    expect(result.exitCode).toBe(3);
  });

  it('exits 1 on corrupt pidfile', async () => {
    const fs = createMemoryFs({ [PID_FILE]: 'not-a-number' });
    const result = await runStatus({ configDir: CONFIG_DIR, filesystem: fs });
    expect(result.exitCode).toBe(1);
  });
});

describe('runStart', () => {
  it('returns helpful message (Phase 8 placeholder)', async () => {
    const result = await runStart();
    expect(result.exitCode).toBe(0);
    expect(result.stdout?.some((l) => l.includes('Phase 8'))).toBe(true);
  });
});

describe('runStop', () => {
  it('reports not running when no pidfile', async () => {
    const fs = createMemoryFs();
    const result = await runStop({ configDir: CONFIG_DIR, filesystem: fs });
    expect(result.exitCode).toBe(3);
  });

  it('reports kill instructions when pidfile exists', async () => {
    const fs = createMemoryFs({ [PID_FILE]: '12345' });
    const result = await runStop({ configDir: CONFIG_DIR, filesystem: fs });
    expect(result.exitCode).toBe(0);
    expect(result.stdout?.some((l) => l.includes('kill'))).toBe(true);
  });
});
