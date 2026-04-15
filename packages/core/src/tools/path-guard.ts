/**
 * Path guard — validates file-system paths against the allow/deny model.
 *
 * The core contract: a path is OK iff
 *   1. It resolves to a canonical absolute path (no `..` ambiguity).
 *   2. It is NOT under any always-blocked prefix.
 *   3. It IS under at least one entry in `allowedRoots`.
 *
 * Always-blocked prefixes cover OS secrets (~/.ssh, ~/.aws, ~/.gnupg),
 * Hipp0's own secret store (~/.hipp0/secrets), and the handful of system
 * paths that should never be accessible to tools even when explicitly listed.
 *
 * The guard rejects any path where Path.resolve(expanded) does not live under
 * one of `allowedRoots` — catches `../../../etc/passwd` trivially.
 */

import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';
import { Hipp0PathDeniedError } from './types.js';

/** Paths that may never be accessed regardless of allowlist. */
export const ALWAYS_BLOCKED_PATHS: readonly string[] = [
  '~/.ssh',
  '~/.aws',
  '~/.gnupg',
  '~/.hipp0/secrets',
  '/etc/shadow',
  '/etc/sudoers',
  '/etc/ssh',
  '/proc/self/environ',
  '/proc/self/mem',
];

/** Expand a leading `~` to the user's home directory. Non-relative `~/x` only. */
export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  return p;
}

/** Does `child` live under `parent` (including equal)? Both must already be canonical. */
export function isUnder(parent: string, child: string): boolean {
  const p = parent.endsWith(sep) ? parent : parent + sep;
  return child === parent || child.startsWith(p);
}

export interface PathGuardOptions {
  /** Directories the caller may read/write, recursively. `~`-prefixed OK. */
  allowedRoots: readonly string[];
  /** Override or extend the blocklist (blocklist always applied). */
  extraBlocked?: readonly string[];
  /** Tool name for error attribution. */
  tool: string;
}

/**
 * Resolve the requested path and assert it is allowed. Returns the canonical
 * absolute path on success. Throws Hipp0PathDeniedError on any violation.
 */
export function assertPathAllowed(requestedPath: string, opts: PathGuardOptions): string {
  const canonical = resolve(expandHome(requestedPath));

  const blocklist = [...ALWAYS_BLOCKED_PATHS, ...(opts.extraBlocked ?? [])].map(expandHome);
  for (const bad of blocklist) {
    if (isUnder(bad, canonical)) {
      throw new Hipp0PathDeniedError(opts.tool, canonical, 'blocked');
    }
  }

  const roots = opts.allowedRoots.map((r) => resolve(expandHome(r)));
  const underAnyRoot = roots.some((r) => isUnder(r, canonical));
  if (!underAnyRoot) {
    throw new Hipp0PathDeniedError(opts.tool, canonical, 'outside_allowed');
  }
  return canonical;
}

/**
 * Check an allow/block for a hostname. Allowlist entries may be:
 *   - exact: "example.com"
 *   - wildcard: "*.example.com" (matches any subdomain, not the apex)
 */
export function isHostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase();
  for (const entry of allowed) {
    const e = entry.toLowerCase();
    if (e.startsWith('*.')) {
      const suffix = e.slice(1); // ".example.com"
      if (h.endsWith(suffix) && h.length > suffix.length) return true;
    } else if (h === e) {
      return true;
    }
  }
  return false;
}
