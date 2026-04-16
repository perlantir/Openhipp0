/**
 * `hipp0 start|stop|status` — lifecycle of the hipp0 daemon.
 *
 * The actual daemon process manager is Phase 8 territory (systemd/pm2/docker).
 * Here we implement a lightweight pidfile-based `status` that reads
 * $HIPP0_HOME/hipp0.pid and checks `process.kill(pid, 0)`. `start` and `stop`
 * are stubs that explain what to run instead (bridge gateway).
 *
 * status exit codes: 0 = running, 3 = not running, 1 = other error.
 */

import path from 'node:path';
import { defaultConfigDir, nodeFileSystem, type FileSystem } from '../config.js';
import { type CommandResult } from '../types.js';

export interface LifecycleOptions {
  configDir?: string;
  filesystem?: FileSystem;
  /** Injected for tests; defaults to process.kill. */
  checkAlive?: (pid: number) => boolean;
}

function defaultCheckAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pidFilePath(configDir: string): string {
  return path.join(configDir, 'hipp0.pid');
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

export async function runStart(): Promise<CommandResult> {
  return {
    exitCode: 0,
    stdout: [
      'hipp0 start: daemon manager is a Phase 8 feature.',
      'For now, run the bridge gateway directly from your application code',
      '(see `@openhipp0/bridge` Gateway) or a process manager (systemd/pm2).',
    ],
  };
}

export async function runStop(opts: LifecycleOptions = {}): Promise<CommandResult> {
  const filesystem = opts.filesystem ?? nodeFileSystem;
  const configDir = opts.configDir ?? defaultConfigDir();
  const pidFile = pidFilePath(configDir);

  if (!(await filesystem.exists(pidFile))) {
    return { exitCode: 3, stdout: ['hipp0: not running (no pidfile).'] };
  }
  return {
    exitCode: 0,
    stdout: [
      `hipp0 stop: found pidfile at ${pidFile}.`,
      'Daemon manager is a Phase 8 feature — send SIGTERM manually:',
      `  kill $(cat ${pidFile})`,
    ],
  };
}
