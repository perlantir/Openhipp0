/**
 * `hipp0 start | stop | restart | status` — lifecycle of the hipp0 daemon.
 *
 * start  — spawns a detached child running `hipp0 serve`, writes the child's
 *          PID to `$HIPP0_HOME/hipp0.pid`, and exits 0. The child's stdout +
 *          stderr are appended to `$HIPP0_HOME/logs/hipp0.log`. Refuses to
 *          start if a live PID is already recorded (prevents double-bind).
 * stop   — reads the pidfile, sends SIGTERM. If the process hasn't exited
 *          within the grace window (default 10s) sends SIGKILL. Removes the
 *          pidfile on success.
 * restart— stop → wait for exit → start.
 * status — reads the pidfile + checks `process.kill(pid, 0)` liveness.
 *
 * status exit codes: 0 = running, 3 = not running, 1 = other error.
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { defaultConfigDir, nodeFileSystem, type FileSystem } from '../config.js';
import { type CommandResult } from '../types.js';

export interface LifecycleOptions {
  configDir?: string;
  filesystem?: FileSystem;
  /** Injected for tests; defaults to process.kill. */
  checkAlive?: (pid: number) => boolean;
}

export interface StartOptions extends LifecycleOptions {
  /** Args passed to the child `hipp0 serve` (e.g. ['--port', '3150']). */
  args?: readonly string[];
  /** Env vars layered onto process.env for the child. */
  env?: Readonly<Record<string, string>>;
  /** Test seam: override child_process.spawn. */
  spawnImpl?: (cmd: string, args: readonly string[], opts: SpawnOptions) => ChildProcess;
  /** Override the path to the hipp0 entrypoint (default resolves from process.argv[1] / PATH). */
  execPath?: string;
}

export interface StopOptions extends LifecycleOptions {
  /** Ms to wait after SIGTERM before SIGKILL. Default 10_000. */
  graceMs?: number;
  /** Sampling interval while waiting for exit. Default 200. */
  pollMs?: number;
  /** Test seam: override process.kill + wait. */
  killImpl?: (pid: number, sig: NodeJS.Signals | 0) => void;
  /** Abortable clock for tests. Defaults to real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

export type RestartOptions = StartOptions & StopOptions;

function defaultCheckAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function pidFilePath(configDir: string): string {
  return path.join(configDir, 'hipp0.pid');
}

function logsDir(configDir: string): string {
  return path.join(configDir, 'logs');
}

function logFilePath(configDir: string): string {
  return path.join(logsDir(configDir), 'hipp0.log');
}

export async function runStatus(opts: LifecycleOptions = {}): Promise<CommandResult> {
  const filesystem = opts.filesystem ?? nodeFileSystem;
  const configDir = opts.configDir ?? defaultConfigDir();
  const checkAlive = opts.checkAlive ?? defaultCheckAlive;
  const pidFile = pidFilePath(configDir);

  if (!(await filesystem.exists(pidFile))) {
    return {
      exitCode: 3,
      stdout: ['hipp0: not running (no pidfile)'],
      data: { running: false, pid: null },
    };
  }
  const raw = (await filesystem.readFile(pidFile)).trim();
  const pid = parseInt(raw, 10);
  if (Number.isNaN(pid) || pid <= 0) {
    return {
      exitCode: 1,
      stderr: [`hipp0: corrupt pidfile at ${pidFile} ("${raw}")`],
      data: { running: false, pid: null },
    };
  }
  const alive = checkAlive(pid);
  return {
    exitCode: alive ? 0 : 3,
    stdout: [alive ? `hipp0: running (pid ${pid})` : `hipp0: stale pidfile (pid ${pid} not alive)`],
    data: { running: alive, pid },
  };
}

export async function runStart(opts: StartOptions = {}): Promise<CommandResult> {
  const filesystem = opts.filesystem ?? nodeFileSystem;
  const configDir = opts.configDir ?? defaultConfigDir();
  const checkAlive = opts.checkAlive ?? defaultCheckAlive;
  const spawnImpl = opts.spawnImpl ?? (spawn as unknown as StartOptions['spawnImpl']);
  const pidFile = pidFilePath(configDir);

  // Refuse to double-start.
  if (await filesystem.exists(pidFile)) {
    const raw = (await filesystem.readFile(pidFile)).trim();
    const pid = parseInt(raw, 10);
    if (!Number.isNaN(pid) && pid > 0 && checkAlive(pid)) {
      return {
        exitCode: 1,
        stderr: [`hipp0: already running (pid ${pid}). Use 'hipp0 stop' or 'hipp0 restart'.`],
        data: { alreadyRunning: true, pid },
      };
    }
    // Stale pidfile — overwrite.
  }

  await filesystem.mkdir(configDir, { recursive: true });
  await filesystem.mkdir(logsDir(configDir), { recursive: true });

  const logPath = logFilePath(configDir);
  const logFd = await fs.open(logPath, 'a');
  const stdio: SpawnOptions['stdio'] = ['ignore', logFd.fd, logFd.fd];

  // Resolve the hipp0 entrypoint. In most installs it's on PATH; for dev
  // it's argv[1] (the script). Fall back to `hipp0` and let PATH lookup
  // fail loudly if not present.
  const cmd = opts.execPath ?? process.argv[1] ?? 'hipp0';
  const args = ['serve', ...(opts.args ?? [])];

  const child = spawnImpl!(cmd, args, {
    detached: true,
    stdio,
    env: { ...process.env, ...(opts.env ?? {}) },
  });

  // If the child failed to spawn at all, `pid` is undefined. Surface a clean error.
  if (!child.pid) {
    await logFd.close().catch(() => undefined);
    return {
      exitCode: 1,
      stderr: ['hipp0: failed to spawn daemon (no pid).'],
      data: { running: false },
    };
  }

  await filesystem.writeFile(pidFile, String(child.pid));
  child.unref();
  // Best-effort close of the log fd on the parent — the child inherited it.
  await logFd.close().catch(() => undefined);

  return {
    exitCode: 0,
    stdout: [
      `hipp0: started (pid ${child.pid})`,
      `logs: ${logPath}`,
      `pidfile: ${pidFile}`,
    ],
    data: { running: true, pid: child.pid, logPath, pidFile },
  };
}

export async function runStop(opts: StopOptions = {}): Promise<CommandResult> {
  const filesystem = opts.filesystem ?? nodeFileSystem;
  const configDir = opts.configDir ?? defaultConfigDir();
  const checkAlive = opts.checkAlive ?? defaultCheckAlive;
  const killImpl = opts.killImpl ?? ((pid, sig) => process.kill(pid, sig));
  const sleep = opts.sleep ?? defaultSleep;
  const graceMs = opts.graceMs ?? 10_000;
  const pollMs = opts.pollMs ?? 200;
  const pidFile = pidFilePath(configDir);

  if (!(await filesystem.exists(pidFile))) {
    return { exitCode: 3, stdout: ['hipp0: not running (no pidfile).'] };
  }
  const raw = (await filesystem.readFile(pidFile)).trim();
  const pid = parseInt(raw, 10);
  if (Number.isNaN(pid) || pid <= 0) {
    await removePidFile(pidFile);
    return { exitCode: 1, stderr: [`hipp0: corrupt pidfile at ${pidFile} ("${raw}")`] };
  }
  if (!checkAlive(pid)) {
    await removePidFile(pidFile);
    return { exitCode: 0, stdout: [`hipp0: stale pidfile removed (pid ${pid} not alive).`] };
  }

  try {
    killImpl(pid, 'SIGTERM');
  } catch (err) {
    return { exitCode: 1, stderr: [`hipp0: SIGTERM to pid ${pid} failed: ${(err as Error).message}`] };
  }

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    if (!checkAlive(pid)) {
      await removePidFile(pidFile);
      return { exitCode: 0, stdout: [`hipp0: stopped (pid ${pid}).`] };
    }
  }

  // Grace expired — SIGKILL.
  try {
    killImpl(pid, 'SIGKILL');
  } catch {
    /* already gone, fine */
  }
  // Small grace for the OS to reap.
  await sleep(pollMs);
  await removePidFile(pidFile);
  return {
    exitCode: 0,
    stdout: [`hipp0: stopped (pid ${pid}, after SIGKILL after ${graceMs}ms grace).`],
  };
}

export async function runRestart(opts: RestartOptions = {}): Promise<CommandResult> {
  const stop = await runStop(opts);
  // Stop already returned (3 = not running). Both outcomes are fine — we
  // proceed to start. We preserve stop's stderr in the combined output.
  const start = await runStart(opts);
  return {
    exitCode: start.exitCode,
    stdout: [...(stop.stdout ?? []), ...(start.stdout ?? [])],
    stderr: [...(stop.stderr ?? []), ...(start.stderr ?? [])],
    data: start.data,
  };
}

async function removePidFile(pidFile: string): Promise<void> {
  await fs.rm(pidFile, { force: true }).catch(() => undefined);
}
