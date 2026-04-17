/**
 * Posture diff for install-time audit. Operators see what tools / domains
 * / paths / env vars / signature state change BEFORE accepting an install.
 */

import type { McpServerBundle, PostureDiff } from './types.js';

export function diffPostures(
  prev: McpServerBundle | undefined,
  next: McpServerBundle,
): PostureDiff {
  const prevTools = new Set(prev?.posture.tools ?? []);
  const nextTools = new Set(next.posture.tools);
  const prevNet = new Set(prev?.posture.networkAllowlist ?? []);
  const nextNet = new Set(next.posture.networkAllowlist);
  const prevFs = new Set(prev?.posture.fsPaths ?? []);
  const nextFs = new Set(next.posture.fsPaths);
  const prevEnv = new Set(prev?.posture.envVarsRead ?? []);
  const nextEnv = new Set(next.posture.envVarsRead);

  const commandChanged =
    !prev ||
    prev.command.cmd !== next.command.cmd ||
    !arrayEquals(prev.command.args, next.command.args) ||
    !recordEquals(prev.command.env ?? {}, next.command.env ?? {});

  let signatureState: PostureDiff['signatureState'];
  if (!prev) {
    signatureState = next.signature ? 'added' : 'unsigned';
  } else if (!prev.signature && !next.signature) {
    signatureState = 'unsigned';
  } else if (!prev.signature && next.signature) {
    signatureState = 'added';
  } else if (prev.signature && !next.signature) {
    signatureState = 'removed';
  } else if (
    prev.signature &&
    next.signature &&
    prev.signature.publicKey !== next.signature.publicKey
  ) {
    signatureState = 'rotated';
  } else {
    signatureState = 'unchanged';
  }

  return {
    toolsAdded: [...diffSet(nextTools, prevTools)].sort(),
    toolsRemoved: [...diffSet(prevTools, nextTools)].sort(),
    networkAdded: [...diffSet(nextNet, prevNet)].sort(),
    networkRemoved: [...diffSet(prevNet, nextNet)].sort(),
    fsPathsAdded: [...diffSet(nextFs, prevFs)].sort(),
    fsPathsRemoved: [...diffSet(prevFs, nextFs)].sort(),
    envVarsAdded: [...diffSet(nextEnv, prevEnv)].sort(),
    commandChanged,
    signatureState,
  };
}

export function renderPostureDiff(diff: PostureDiff, bundleName: string): string {
  const lines: string[] = [
    `About to install / update MCP server: ${bundleName}`,
    `Signature state: ${diff.signatureState}`,
  ];
  if (diff.commandChanged) lines.push('  ! launch command changed');
  if (diff.toolsAdded.length > 0) lines.push(`  + tools: ${diff.toolsAdded.join(', ')}`);
  if (diff.toolsRemoved.length > 0) lines.push(`  - tools: ${diff.toolsRemoved.join(', ')}`);
  if (diff.networkAdded.length > 0) lines.push(`  + network: ${diff.networkAdded.join(', ')}`);
  if (diff.networkRemoved.length > 0) lines.push(`  - network: ${diff.networkRemoved.join(', ')}`);
  if (diff.fsPathsAdded.length > 0) lines.push(`  + fs paths: ${diff.fsPathsAdded.join(', ')}`);
  if (diff.fsPathsRemoved.length > 0) lines.push(`  - fs paths: ${diff.fsPathsRemoved.join(', ')}`);
  if (diff.envVarsAdded.length > 0) lines.push(`  + env reads: ${diff.envVarsAdded.join(', ')}`);
  return lines.join('\n');
}

function diffSet<T>(a: Set<T>, b: Set<T>): Set<T> {
  const out = new Set<T>();
  for (const x of a) if (!b.has(x)) out.add(x);
  return out;
}

function arrayEquals(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function recordEquals(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i] || a[ka[i]!] !== b[kb[i]!]) return false;
  return true;
}
