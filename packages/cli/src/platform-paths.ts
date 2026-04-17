/**
 * Cross-platform path helpers. Centralize HOME / CONFIG_HOME / DATA_HOME
 * resolution so consumers aren't scattered with `process.env.HOME`
 * assumptions that break on Windows.
 */

import { homedir } from 'node:os';
import path from 'node:path';

export type SupportedPlatform = 'darwin' | 'linux' | 'win32';

export interface PlatformPathContext {
  readonly platform?: SupportedPlatform;
  readonly env?: NodeJS.ProcessEnv;
}

export function hipp0Home(ctx: PlatformPathContext = {}): string {
  const env = ctx.env ?? process.env;
  const platform = ctx.platform ?? (process.platform as SupportedPlatform);
  if (env['HIPP0_HOME']) return env['HIPP0_HOME'];
  if (platform === 'win32') {
    // Prefer LOCALAPPDATA to keep config out of roaming sync.
    const local = env['LOCALAPPDATA'] ?? path.join(homedir(), 'AppData', 'Local');
    return path.join(local, 'OpenHipp0');
  }
  return path.join(homedir(), '.hipp0');
}

export function hipp0Config(ctx: PlatformPathContext = {}): string {
  return path.join(hipp0Home(ctx), 'config.json');
}

export function hipp0Data(ctx: PlatformPathContext = {}): string {
  return path.join(hipp0Home(ctx), 'data');
}

export function hipp0Logs(ctx: PlatformPathContext = {}): string {
  return path.join(hipp0Home(ctx), 'logs');
}

/**
 * Expand `~` prefix using the supplied home; portable since we don't shell
 * out. Returns the path unchanged if it doesn't start with `~`.
 */
export function expandTilde(p: string, ctx: PlatformPathContext = {}): string {
  if (!p.startsWith('~')) return p;
  const home = (ctx.env ?? process.env)['HOME'] ?? (ctx.env ?? process.env)['USERPROFILE'] ?? homedir();
  return p === '~' ? home : path.join(home, p.slice(2));
}

/**
 * Normalize a user-supplied path with CRLF support: Windows shells often
 * paste paths with CR at the end when piped; strip and call path.normalize.
 */
export function safeNormalize(p: string): string {
  return path.normalize(p.replace(/[\r\n]+$/g, ''));
}

/**
 * Build a filesystem-safe slug from arbitrary text. Used for session/
 * snapshot dirs so user-supplied labels can't contain path separators.
 */
export function safeSlug(text: string): string {
  return text
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 120);
}
