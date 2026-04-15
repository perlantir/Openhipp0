/**
 * Sandbox — executes shell commands under increasing levels of isolation.
 *
 *   none   — spawn the command directly. NEVER use this with untrusted input.
 *   native — spawn via /bin/sh -c with timeout + (on Linux) a process group.
 *            No resource limits; protects against infinite loops, not malicious code.
 *   docker — `docker run --rm --network=none --memory=<m> --cpus=<c> --read-only
 *            --tmpfs /tmp:size=64m [--volume ...]` using an ephemeral container.
 *            Treat as the production default.
 *
 * Each sandbox returns an ExecOutcome. Network / filesystem isolation is the
 * sandbox's responsibility; tools can trust the outcome.
 */

import { spawn } from 'node:child_process';
import type { SandboxMode } from './types.js';

export interface SandboxExecOptions {
  /** Working directory for the command. */
  cwd?: string;
  /** Environment variables injected into the container/process. */
  env?: Record<string, string>;
  /** Total execution budget. The sandbox SIGKILLs on expiry. */
  timeoutMs: number;
  /** Abort the execution externally. */
  signal?: AbortSignal;
  /** Read-only bind mounts for docker mode. Ignored by native/none. */
  readOnlyMounts?: readonly string[];
  /** Image for docker mode. Default: `alpine:latest`. */
  dockerImage?: string;
  /** Memory limit for docker mode (e.g. "256m"). Default: "256m". */
  dockerMemory?: string;
  /** CPU limit for docker mode (e.g. "0.5"). Default: "0.5". */
  dockerCpus?: string;
}

export interface ExecOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  mode: SandboxMode;
}

/**
 * Run a shell command under the specified sandbox mode. Never throws on
 * non-zero exit; timeouts are reported via `timedOut=true` with whatever
 * output was captured before the kill.
 */
export async function runInSandbox(
  mode: SandboxMode,
  cmd: string,
  opts: SandboxExecOptions,
): Promise<ExecOutcome> {
  switch (mode) {
    case 'none':
    case 'native':
      return runNative(cmd, opts, mode);
    case 'docker':
      return runDocker(cmd, opts);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Native mode (no container)
// ─────────────────────────────────────────────────────────────────────────────

async function runNative(
  cmd: string,
  opts: SandboxExecOptions,
  mode: 'none' | 'native',
): Promise<ExecOutcome> {
  return new Promise<ExecOutcome>((resolvePromise) => {
    // `detached: true` puts the child (sh) in its own process group. On
    // timeout we signal -pid which reaches sh AND any descendants like sleep
    // that inherited the stdio pipes — otherwise close() never fires.
    const child = spawn('sh', ['-c', cmd], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    const killGroup = (sig: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, sig);
      } catch {
        // Process group already gone — fine.
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      setTimeout(() => {
        if (!settled) killGroup('SIGKILL');
      }, 250);
    }, opts.timeoutMs);

    const onAbort = (): void => {
      timedOut = true;
      killGroup('SIGKILL');
    };
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });

    child.on('close', (code) => {
      settled = true;
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      resolvePromise({
        exitCode: code ?? -1,
        stdout,
        stderr,
        timedOut,
        mode,
      });
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        exitCode: -1,
        stdout,
        stderr: stderr + `\n[spawn error: ${err.message}]`,
        timedOut,
        mode,
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Docker mode (ephemeral container)
// ─────────────────────────────────────────────────────────────────────────────

async function runDocker(cmd: string, opts: SandboxExecOptions): Promise<ExecOutcome> {
  const image = opts.dockerImage ?? 'alpine:latest';
  const memory = opts.dockerMemory ?? '256m';
  const cpus = opts.dockerCpus ?? '0.5';

  const args: string[] = [
    'run',
    '--rm',
    '--network=none',
    `--memory=${memory}`,
    `--cpus=${cpus}`,
    '--read-only',
    '--tmpfs',
    '/tmp:size=64m,exec',
    '--security-opt',
    'no-new-privileges',
  ];

  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      args.push('-e', `${k}=${v}`);
    }
  }
  if (opts.cwd) args.push('-w', opts.cwd);

  for (const mount of opts.readOnlyMounts ?? []) {
    args.push('-v', `${mount}:${mount}:ro`);
  }

  args.push(image, 'sh', '-c', cmd);

  return new Promise<ExecOutcome>((resolvePromise) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);

    const onAbort = (): void => {
      timedOut = true;
      child.kill('SIGKILL');
    };
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });

    child.on('close', (code) => {
      settled = true;
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      resolvePromise({ exitCode: code ?? -1, stdout, stderr, timedOut, mode: 'docker' });
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        exitCode: -1,
        stdout,
        stderr: stderr + `\n[docker spawn error: ${err.message}]`,
        timedOut,
        mode: 'docker',
      });
    });
  });
}
