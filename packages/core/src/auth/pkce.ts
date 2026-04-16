/**
 * RFC 7636 — PKCE helpers.
 *
 *   createPkceVerifier()  -> random verifier string (43–128 URL-safe chars)
 *   deriveChallenge(v)    -> base64url(SHA-256(v))  for method='S256'
 *
 * Node's crypto.randomBytes + crypto.createHash are sufficient — no
 * external deps.
 */

import { createHash, randomBytes } from 'node:crypto';

const MIN_LEN = 43;
const MAX_LEN = 128;

export function createPkceVerifier(lengthBytes = 64): string {
  if (lengthBytes < 32 || lengthBytes > 96) {
    throw new Error('PKCE verifier length must be 32–96 raw bytes');
  }
  const verifier = base64url(randomBytes(lengthBytes));
  if (verifier.length < MIN_LEN || verifier.length > MAX_LEN) {
    throw new Error(`PKCE verifier length out of range: ${verifier.length}`);
  }
  return verifier;
}

export function deriveChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
