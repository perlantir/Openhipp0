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

function isBlockedPath(p: string): boolean {
  const expanded = expandHome(p);
  return ALWAYS_BLOCKED_PATHS.some((pattern) => {
    const expandedPattern = expandHome(pattern);
    return minimatch(expanded, expandedPattern);
  });
}

function matchesAny(p: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return false;
  const expanded = expandHome(p);
  return patterns.some((pattern) => minimatch(expanded, expandHome(pattern)));
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
