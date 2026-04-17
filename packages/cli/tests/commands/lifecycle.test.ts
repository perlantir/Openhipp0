import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  runRestart,
  runStart,
  runStatus,
  runStop,
} from '../../src/commands/lifecycle.js';
import { createMemoryFs } from '../helpers/memory-fs.js';

const MEMFS_PID_DIR = '/tmp/hipp0-test-lifecycle-memfs';

function mkTempConfigDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'hipp0-lifecycle-'));
}

function fakeChild(pid: number): ChildProcess {
  return {
    pid,
    unref() {
      /* no-op */
    },
  } as unknown as ChildProcess;
}

describe('runStatus', () => {
  const PID_FILE = path.join(MEMFS_PID_DIR, 'hipp0.pid');

  it('exits 3 when no pidfile', async () => {
    const mem = createMemoryFs();
    const result = await runStatus({ configDir: MEMFS_PID_DIR, filesystem: mem });
    expect(result.exitCode).toBe(3);
    expect(result.data).toMatchObject({ running: false, pid: null });
  });

  it('exits 0 when pid is alive', async () => {
    const mem = createMemoryFs({ [PID_FILE]: '12345\n' });
    const result = await runStatus({
      configDir: MEMFS_PID_DIR,
      filesystem: mem,
      checkAlive: () => true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.data).toMatchObject({ running: true, pid: 12345 });
  });

  it('exits 3 when pid is stale', async () => {
    const mem = createMemoryFs({ [PID_FILE]: '999\n' });
    const result = await runStatus({
      configDir: MEMFS_PID_DIR,
      filesystem: mem,
      checkAlive: () => false,
    });
    expect(result.exitCode).toBe(3);
  });

  it('exits 1 on corrupt pidfile', async () => {
    const mem = createMemoryFs({ [PID_FILE]: 'not-a-number' });
    const result = await runStatus({ configDir: MEMFS_PID_DIR, filesystem: mem });
    expect(result.exitCode).toBe(1);
  });
});

describe('runStart', () => {
  let configDir: string;
  beforeEach(() => {
    configDir = mkTempConfigDir();
  });
  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('spawns a detached child, writes pidfile, returns pid + paths', async () => {
    let spawnedCmd: string | undefined;
    let spawnedArgs: readonly string[] | undefined;
    const result = await runStart({
      configDir,
      spawnImpl: (cmd, args) => {
        spawnedCmd = cmd;
        spawnedArgs = args;
        return fakeChild(54321);
      },
      execPath: '/usr/local/bin/hipp0',
      args: ['--port', '3150'],
    });

    expect(result.exitCode).toBe(0);
    expect(result.data).toMatchObject({ running: true, pid: 54321 });
    expect(spawnedCmd).toBe('/usr/local/bin/hipp0');
    expect(spawnedArgs).toEqual(['serve', '--port', '3150']);
    const pidFile = await fs.readFile(path.join(configDir, 'hipp0.pid'), 'utf8');
    expect(pidFile).toBe('54321');
    const logStat = await fs.stat(path.join(configDir, 'logs', 'hipp0.log'));
    expect(logStat.isFile()).toBe(true);
  });

  it('refuses to double-start when a live pid is recorded', async () => {
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'hipp0.pid'), '111');
    const result = await runStart({
      configDir,
      checkAlive: () => true,
      spawnImpl: () => {
        throw new Error('should not spawn');
      },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr?.[0]).toMatch(/already running/);
  });

  it('overwrites a stale pidfile on start', async () => {
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'hipp0.pid'), '99999');
    const result = await runStart({
      configDir,
      checkAlive: () => false, // stale
      spawnImpl: () => fakeChild(7777),
      execPath: '/usr/local/bin/hipp0',
    });
    expect(result.exitCode).toBe(0);
    const pidFile = await fs.readFile(path.join(configDir, 'hipp0.pid'), 'utf8');
    expect(pidFile).toBe('7777');
  });
});

describe('runStop', () => {
  let configDir: string;
  beforeEach(() => {
    configDir = mkTempConfigDir();
  });
  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('reports not running when no pidfile', async () => {
    const result = await runStop({ configDir });
    expect(result.exitCode).toBe(3);
  });

  it('SIGTERM + exits gracefully within the grace window', async () => {
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'hipp0.pid'), '42');

    let terminated = false;
    const killImpl = vi.fn((_pid: number, sig: NodeJS.Signals | 0) => {
      if (sig === 'SIGTERM') terminated = true;
    });
    const result = await runStop({
      configDir,
      checkAlive: () => !terminated,
      killImpl,
      graceMs: 1_000,
      pollMs: 10,
      sleep: () => Promise.resolve(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout?.[0]).toMatch(/stopped/);
    expect(killImpl).toHaveBeenCalledWith(42, 'SIGTERM');
    // Pidfile cleaned up.
    await expect(fs.access(path.join(configDir, 'hipp0.pid'))).rejects.toThrow();
  });

  it('falls back to SIGKILL when grace expires', async () => {
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'hipp0.pid'), '42');

    const kills: NodeJS.Signals[] = [];
    const killImpl = vi.fn((_pid: number, sig: NodeJS.Signals | 0) => {
      kills.push(sig as NodeJS.Signals);
    });

    // Pretend the process is alive forever until SIGKILL lands.
    const alive = (): boolean => !kills.includes('SIGKILL');

    const result = await runStop({
      configDir,
      checkAlive: alive,
      killImpl,
      graceMs: 20, // tiny
      pollMs: 5,
      sleep: () => Promise.resolve(),
    });

    expect(result.exitCode).toBe(0);
    expect(kills).toEqual(['SIGTERM', 'SIGKILL']);
    expect(result.stdout?.[0]).toMatch(/SIGKILL/);
  });

  it('cleans up a stale pidfile without killing anything', async () => {
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'hipp0.pid'), '5');
    const killImpl = vi.fn();
    const result = await runStop({
      configDir,
      checkAlive: () => false,
      killImpl,
    });
    expect(result.exitCode).toBe(0);
    expect(killImpl).not.toHaveBeenCalled();
    await expect(fs.access(path.join(configDir, 'hipp0.pid'))).rejects.toThrow();
  });
});

describe('runRestart', () => {
  let configDir: string;
  beforeEach(() => {
    configDir = mkTempConfigDir();
  });
  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('stops then starts — surfaces combined stdout', async () => {
    // Seed with a "running" daemon we can stop.
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'hipp0.pid'), '100');

    const kills: NodeJS.Signals[] = [];
    const killImpl = (_pid: number, sig: NodeJS.Signals | 0) => {
      kills.push(sig as NodeJS.Signals);
    };
    let aliveFlag = true;
    const checkAlive = (): boolean => aliveFlag;

    // When SIGTERM lands, flip alive=false.
    const killImplWrap = (pid: number, sig: NodeJS.Signals | 0) => {
      killImpl(pid, sig);
      if (sig === 'SIGTERM') aliveFlag = false;
    };

    const result = await runRestart({
      configDir,
      checkAlive,
      killImpl: killImplWrap,
      graceMs: 500,
      pollMs: 5,
      sleep: () => Promise.resolve(),
      spawnImpl: () => fakeChild(9000),
      execPath: '/usr/local/bin/hipp0',
    });

    expect(result.exitCode).toBe(0);
    expect(kills).toContain('SIGTERM');
    const pidFile = await fs.readFile(path.join(configDir, 'hipp0.pid'), 'utf8');
    expect(pidFile).toBe('9000');
  });
});
