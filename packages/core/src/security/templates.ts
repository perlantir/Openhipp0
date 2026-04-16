/**
 * Policy templates — sensible defaults for strict, moderate, permissive modes.
 *
 * All templates share the hardcoded blocked-paths list (ssh, aws, gnupg,
 * hipp0 secrets) which CANNOT be overridden by the agent.
 */

import type { AgentPolicy } from './types.js';

export const ALWAYS_BLOCKED_PATHS = [
  '~/.ssh/**',
  '~/.aws/**',
  '~/.gnupg/**',
  '~/.hipp0/secrets/**',
] as const;

export const POLICY_TEMPLATES: Record<AgentPolicy['level'], AgentPolicy> = {
  strict: {
    level: 'strict',
    permissions: ['fs.read', 'fs.list'],
    allowedPaths: ['./**'],
    allowedDomains: [],
    blockedPaths: [...ALWAYS_BLOCKED_PATHS],
    requireApproval: ['shell.execute', 'fs.write', 'net.fetch'],
    maxConcurrentTools: 1,
    toolTimeoutMs: 15_000,
  },
  moderate: {
    level: 'moderate',
    permissions: ['fs.read', 'fs.write', 'fs.list', 'net.fetch'],
    allowedPaths: ['./**'],
    allowedDomains: ['*'],
    blockedPaths: [...ALWAYS_BLOCKED_PATHS],
    requireApproval: ['shell.execute'],
    maxConcurrentTools: 5,
    toolTimeoutMs: 30_000,
  },
  permissive: {
    level: 'permissive',
    permissions: ['fs.read', 'fs.write', 'fs.list', 'shell.execute', 'net.fetch'],
    allowedPaths: ['./**'],
    allowedDomains: ['*'],
    blockedPaths: [...ALWAYS_BLOCKED_PATHS],
    requireApproval: [],
    maxConcurrentTools: 10,
    toolTimeoutMs: 60_000,
  },
};

/** Resolve a level name to a fresh deep copy of the template. Mutation-safe. */
export function getTemplate(level: AgentPolicy['level']): AgentPolicy {
  const t = POLICY_TEMPLATES[level];
  return {
    ...t,
    permissions: [...t.permissions],
    allowedPaths: [...t.allowedPaths],
    allowedDomains: [...t.allowedDomains],
    blockedPaths: [...t.blockedPaths],
    requireApproval: [...t.requireApproval],
  };
}
