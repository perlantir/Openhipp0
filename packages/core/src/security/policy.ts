/**
 * PolicyEnforcer — evaluates whether a proposed tool call is allowed under
 * the active AgentPolicy. Checks run in order:
 *
 *   1. Permission check (tool.permissions ⊆ policy.permissions).
 *   2. Path check (requested paths against policy.allowedPaths, always-blocked
 *      paths can never be overridden).
 *   3. Domain check (net.fetch targets against policy.allowedDomains).
 *   4. Approval check (if action is in policy.requireApproval, an approval
 *      request must be satisfied before proceeding).
 *
 * Path hardening (Phase 3-H4):
 *   - Blocked paths are compared against the normalized absolute form of
 *     the input (`path.resolve` + `expandHome`). Traversal sequences (`..`,
 *     relative refs, trailing-slash evasion) are resolved BEFORE matching.
 *   - Blocked patterns are normalized the same way and match both the
 *     directory itself AND anything under it (prefix match, not glob).
 *
 * The enforcer is pure logic — it has no side effects and no I/O. The actual
 * "ask the user to approve" flow lives in governance.ts.
 */

import * as path from 'node:path';
import * as os from 'node:os';
import type { AgentPolicy } from './types.js';
import { ALWAYS_BLOCKED_PATHS } from './templates.js';

export interface EnforcementResult {
  allowed: boolean;
  /** Which check denied (if any). */
  deniedBy?: 'permission' | 'path' | 'domain' | 'approval_required';
  /** Human-readable reason. */
  reason?: string;
}

export interface ToolCallRequest {
  toolName: string;
  requiredPermissions: readonly string[];
  /** File paths the tool intends to touch. */
  paths?: readonly string[];
  /** Network domains the tool intends to reach. */
  domains?: readonly string[];
}

export function enforce(policy: AgentPolicy, req: ToolCallRequest): EnforcementResult {
  // 1) Permission check
  const missing = req.requiredPermissions.filter((p) => !policy.permissions.includes(p));
  if (missing.length > 0) {
    return {
      allowed: false,
      deniedBy: 'permission',
      reason: `Missing permission(s): ${missing.join(', ')}`,
    };
  }

  // 2) Path check
  if (req.paths) {
    for (const p of req.paths) {
      if (isBlockedPath(p)) {
        return { allowed: false, deniedBy: 'path', reason: `Blocked path: ${p}` };
      }
      if (!matchesAny(p, policy.allowedPaths)) {
        return { allowed: false, deniedBy: 'path', reason: `Path not allowed: ${p}` };
      }
    }
  }

  // 3) Domain check
  if (req.domains) {
    for (const d of req.domains) {
      if (!matchesDomain(d, policy.allowedDomains)) {
        return { allowed: false, deniedBy: 'domain', reason: `Domain not allowed: ${d}` };
      }
    }
  }

  // 4) Approval check
  if (policy.requireApproval.some((a) => req.requiredPermissions.includes(a))) {
    return {
      allowed: false,
      deniedBy: 'approval_required',
      reason: `Action requires human approval: ${req.toolName}`,
    };
  }

  return { allowed: true };
}

/**
 * True iff the requested path is (or is inside) any ALWAYS_BLOCKED root,
 * regardless of traversal / normalization tricks. Specifically:
 *   - `~/.ssh` with no trailing slash  → blocked (was allowed).
 *   - `~/foo/../.ssh/id_rsa`           → blocked (was allowed).
 *   - `/tmp/../root/.ssh/id_rsa`       → blocked (was allowed).
 *   - Plain case where `./myfile` is fine → still fine.
 */
function isBlockedPath(p: string): boolean {
  const normalized = normalizePath(p);
  return ALWAYS_BLOCKED_PATHS.some((pattern) => {
    const patternRoot = normalizePath(stripGlobSuffix(pattern));
    return isUnderOrEquals(normalized, patternRoot);
  });
}

function matchesAny(p: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return false;
  const expanded = expandHome(p);
  return patterns.some((pattern) => minimatch(expanded, expandHome(pattern)));
}

/**
 * Full normalization: expand `~/`, resolve relative segments, produce an
 * absolute path that cannot be bypassed via traversal. No filesystem I/O
 * (so undefined symlink behavior — Phase 5+ can add realpath when the
 * caller runs under an fs context). For the always-blocked guard, syntactic
 * normalization is sufficient because the root is always a literal prefix
 * like `$HOME/.ssh`.
 */
function normalizePath(p: string): string {
  const expanded = expandHome(p);
  return path.resolve(expanded);
}

function stripGlobSuffix(pattern: string): string {
  // `~/.ssh/**` → `~/.ssh`, `~/.hipp0/secrets/**` → `~/.hipp0/secrets`.
  return pattern.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
}

/** Prefix-match a normalized path against a normalized directory root. */
function isUnderOrEquals(p: string, root: string): boolean {
  if (p === root) return true;
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  return p.startsWith(rootWithSep);
}

function matchesDomain(domain: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return false;
  return allowed.some((a) => a === '*' || a === domain || domain.endsWith(`.${a}`));
}

function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Minimal glob matcher — supports only `**` (any path segments) and `*`
 * (single segment / partial). This is intentionally limited; we don't pull
 * in `minimatch` to keep the core package dependency-free.
 */
function minimatch(value: string, pattern: string): boolean {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__GLOBSTAR__/g, '.*');
  return new RegExp(`^${re}$`).test(value);
}
