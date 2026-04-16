/**
 * Canonical content hash + signature verification for MCP bundles.
 */

import { createHash, createVerify } from 'node:crypto';
import type { McpServerBundle } from './types.js';

/**
 * Canonical JSON serialization — sorted keys, no sig (signatures cover this
 * output). Also used by the signature verification path.
 */
export function canonicalBundleBytes(
  bundle: Pick<McpServerBundle, 'name' | 'version' | 'command' | 'posture'>,
): string {
  const sorted = {
    command: {
      args: [...bundle.command.args],
      cmd: bundle.command.cmd,
      env: Object.fromEntries(
        Object.entries(bundle.command.env ?? {}).sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
    name: bundle.name,
    posture: {
      description: bundle.posture.description,
      envVarsRead: [...bundle.posture.envVarsRead].sort(),
      fsPaths: [...bundle.posture.fsPaths].sort(),
      networkAllowlist: [...bundle.posture.networkAllowlist].sort(),
      tools: [...bundle.posture.tools].sort(),
    },
    version: bundle.version,
  };
  return JSON.stringify(sorted);
}

export function computeBundleHash(
  bundle: Pick<McpServerBundle, 'name' | 'version' | 'command' | 'posture'>,
): string {
  return createHash('sha256').update(canonicalBundleBytes(bundle)).digest('hex');
}

export function assertHashMatches(bundle: McpServerBundle): void {
  const expected = computeBundleHash(bundle);
  if (expected !== bundle.contentHash) {
    throw new Error(
      `MCP bundle contentHash mismatch: expected=${expected} got=${bundle.contentHash}`,
    );
  }
}

/**
 * Verify an Ed25519 signature over the canonical hash. Returns a verdict
 * suitable for logging, NOT a boolean you can shrug off: callers decide
 * policy (require signed, allow unsigned with posture confirmation, etc).
 */
export type SignatureVerdict =
  | { ok: true; signer?: string }
  | { ok: false; reason: 'no-signature' }
  | { ok: false; reason: 'invalid-signature'; detail: string }
  | { ok: false; reason: 'wrong-algorithm'; detail: string };

export function verifyBundleSignature(bundle: McpServerBundle): SignatureVerdict {
  const sig = bundle.signature;
  if (!sig) return { ok: false, reason: 'no-signature' };
  if (sig.algorithm !== 'ed25519') {
    return { ok: false, reason: 'wrong-algorithm', detail: sig.algorithm };
  }
  try {
    const verifier = createVerify('sha256'); // Node supports `null` algorithm with Ed25519 keys;
    // for portability we use SPKI-wrapped verify via crypto.verify below.
    void verifier;
    const ok = requireVerify(bundle);
    if (!ok) return { ok: false, reason: 'invalid-signature', detail: 'verify=false' };
    const result: SignatureVerdict = sig.signer ? { ok: true, signer: sig.signer } : { ok: true };
    return result;
  } catch (err) {
    return { ok: false, reason: 'invalid-signature', detail: (err as Error).message };
  }
}

function requireVerify(bundle: McpServerBundle): boolean {
  // Use crypto.verify which handles SPKI-wrapped Ed25519 keys directly.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('node:crypto');
  const sig = bundle.signature!;
  const message = Buffer.from(bundle.contentHash, 'hex');
  const pubKeyPem = `-----BEGIN PUBLIC KEY-----\n${sig.publicKey}\n-----END PUBLIC KEY-----`;
  const signatureBuf = Buffer.from(sig.signature, 'base64');
  return crypto.verify(null, message, pubKeyPem, signatureBuf) as boolean;
}
