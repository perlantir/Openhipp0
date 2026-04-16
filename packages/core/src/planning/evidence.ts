/**
 * Evidence validators — run server-side before accepting a step's transition
 * to `completed`. This is what stops the agent from lying to its own plan.
 *
 * Every validator is pure / deterministic OR operates on caller-supplied
 * payloads (exit codes, HTTP status, tool-result ok flags). Filesystem
 * validators must be gated by the same policy engine as tools — they respect
 * `allowedPaths` via the caller-supplied `pathGuard`.
 */

import { existsSync, statSync, readFileSync } from 'node:fs';
import type { EvidenceKind, EvidenceRecord, EvidenceValidator } from './types.js';

export interface ValidatorContext {
  /** When defined, any filesystem evidence path must pass this guard. */
  pathGuard?: (path: string) => boolean;
}

export function createEvidenceValidator(ctx: ValidatorContext = {}): EvidenceValidator {
  return async (ev) => {
    const kind = ev.kind;
    switch (kind) {
      case 'file-exists':
        return validateFileExists(ev, ctx);
      case 'file-content-matches':
        return validateFileContentMatches(ev, ctx);
      case 'exit-code-zero':
        return validateExitCode(ev);
      case 'http-2xx':
        return validateHttp(ev);
      case 'tool-result-ok':
        return validateToolResult(ev);
      case 'assertion-passed':
        return validateAssertion(ev);
      case 'manual':
        return {
          ...ev,
          valid: true,
          reason: 'manual evidence — not verified server-side',
          verifiedAt: new Date().toISOString(),
        };
      default: {
        const _exhaustive: never = kind;
        return { ...ev, valid: false, reason: `unknown evidence kind: ${String(_exhaustive)}` };
      }
    }
  };
}

function validateFileExists(ev: EvidenceRecord, ctx: ValidatorContext): EvidenceRecord {
  const p = String(ev.detail['path'] ?? '');
  if (!p) return reject(ev, 'missing detail.path');
  if (ctx.pathGuard && !ctx.pathGuard(p)) return reject(ev, 'path blocked by policy');
  try {
    if (!existsSync(p)) return reject(ev, 'file does not exist');
    statSync(p); // throws on broken symlinks
    return accept(ev);
  } catch (err) {
    return reject(ev, (err as Error).message);
  }
}

function validateFileContentMatches(ev: EvidenceRecord, ctx: ValidatorContext): EvidenceRecord {
  const p = String(ev.detail['path'] ?? '');
  const expected = String(ev.detail['contains'] ?? '');
  if (!p || !expected) return reject(ev, 'missing detail.path / detail.contains');
  if (ctx.pathGuard && !ctx.pathGuard(p)) return reject(ev, 'path blocked by policy');
  try {
    const body = readFileSync(p, 'utf8');
    if (body.includes(expected)) return accept(ev);
    return reject(ev, 'file exists but does not contain expected substring');
  } catch (err) {
    return reject(ev, (err as Error).message);
  }
}

function validateExitCode(ev: EvidenceRecord): EvidenceRecord {
  const code = ev.detail['exitCode'];
  if (typeof code !== 'number') return reject(ev, 'missing detail.exitCode (number)');
  if (code === 0) return accept(ev);
  return reject(ev, `non-zero exit: ${code}`);
}

function validateHttp(ev: EvidenceRecord): EvidenceRecord {
  const status = ev.detail['status'];
  if (typeof status !== 'number') return reject(ev, 'missing detail.status (number)');
  if (status >= 200 && status < 300) return accept(ev);
  return reject(ev, `non-2xx status: ${status}`);
}

function validateToolResult(ev: EvidenceRecord): EvidenceRecord {
  const ok = ev.detail['ok'];
  if (typeof ok !== 'boolean') return reject(ev, 'missing detail.ok (boolean)');
  if (ok) return accept(ev);
  return reject(ev, 'tool result was ok=false');
}

function validateAssertion(ev: EvidenceRecord): EvidenceRecord {
  const passed = ev.detail['passed'];
  if (typeof passed !== 'boolean') return reject(ev, 'missing detail.passed (boolean)');
  if (passed) return accept(ev);
  return reject(ev, 'assertion reported false');
}

function accept(ev: EvidenceRecord): EvidenceRecord {
  return { ...ev, valid: true, verifiedAt: new Date().toISOString() };
}

function reject(ev: EvidenceRecord, reason: string): EvidenceRecord {
  return { ...ev, valid: false, reason, verifiedAt: new Date().toISOString() };
}

export const SUPPORTED_EVIDENCE_KINDS: readonly EvidenceKind[] = [
  'manual',
  'file-exists',
  'file-content-matches',
  'exit-code-zero',
  'http-2xx',
  'tool-result-ok',
  'assertion-passed',
];
