/**
 * Path helpers. Pure — no I/O except `tmpfsCandidate` which stats `/dev/shm`.
 */

import { accessSync, constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export type Platform = 'darwin' | 'linux' | 'win32';

/** Location of Chrome/Chromium user-data-dir on each supported OS. */
export function systemChromeUserDataDir(platform: Platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  }
  if (platform === 'linux') {
    const xdg = env['XDG_CONFIG_HOME'];
    const base = xdg && xdg.length > 0 ? xdg : path.join(homedir(), '.config');
    return path.join(base, 'google-chrome');
  }
  if (platform === 'win32') {
    const local = env['LOCALAPPDATA'] ?? path.join(homedir(), 'AppData', 'Local');
    return path.join(local, 'Google', 'Chrome', 'User Data');
  }
  throw new Error(`unsupported platform: ${platform as string}`);
}

/** Root directory where the profile store keeps encrypted archives + manifests. */
export function defaultProfilesDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env['HIPP0_HOME'];
  const base = home && home.length > 0 ? home : path.join(homedir(), '.hipp0');
  return path.join(base, 'browser-profiles');
}

/**
 * Returns a tmpfs path candidate on Linux when one is writable, else null.
 * Preference order: `$XDG_RUNTIME_DIR` (per-user tmpfs), then `/dev/shm`.
 * macOS / Windows: always null — fall back to disk under the profile dir.
 */
export function tmpfsCandidate(platform: Platform, env: NodeJS.ProcessEnv = process.env): string | null {
  if (platform !== 'linux') return null;
  const xdgRun = env['XDG_RUNTIME_DIR'];
  if (xdgRun && xdgRun.length > 0 && isWritable(xdgRun)) {
    return xdgRun;
  }
  if (isWritable('/dev/shm')) return '/dev/shm';
  return null;
}

function isWritable(p: string): boolean {
  try {
    accessSync(p, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}
