/**
 * NaCl-box primitives for the mobile-pairing handshake.
 *
 * We use `nacl.box` (X25519 + XSalsa20-Poly1305) — the same primitive the
 * mobile client uses via `tweetnacl`. Every envelope carries its own nonce
 * (24 random bytes), so replay is caught at the policy layer, not here.
 */

import nacl from 'tweetnacl';
import { Hipp0EnvelopeOpenError, type Envelope } from './types.js';

const B64 = 'base64' as const;

function toB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString(B64);
}

function fromB64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, B64));
}

/** NaCl-box keypair, base64-encoded for transport + storage. */
export interface KeyPair {
  publicKey: string;
  secretKey: string;
}

export function generateKeyPair(): KeyPair {
  const kp = nacl.box.keyPair();
  return { publicKey: toB64(kp.publicKey), secretKey: toB64(kp.secretKey) };
}

/**
 * Seal a plaintext payload for the counterparty.
 * `theirPublicKey` = the peer's public key (base64).
 * `ourSecretKey`  = our own secret key (base64).
 */
export function sealEnvelope(
  plaintext: Uint8Array | string,
  theirPublicKey: string,
  ourSecretKey: string,
): Envelope {
  const bytes = typeof plaintext === 'string' ? new TextEncoder().encode(plaintext) : plaintext;
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box(bytes, nonce, fromB64(theirPublicKey), fromB64(ourSecretKey));
  return { nonce: toB64(nonce), ciphertext: toB64(ciphertext) };
}

/**
 * Open a sealed envelope.
 * `theirPublicKey` = the peer's public key (base64).
 * `ourSecretKey`   = our own secret key (base64).
 * Throws `Hipp0EnvelopeOpenError` on forgery / wrong key.
 */
export function openEnvelope(
  envelope: Envelope,
  theirPublicKey: string,
  ourSecretKey: string,
): Uint8Array {
  const plaintext = nacl.box.open(
    fromB64(envelope.ciphertext),
    fromB64(envelope.nonce),
    fromB64(theirPublicKey),
    fromB64(ourSecretKey),
  );
  if (plaintext === null) {
    throw new Hipp0EnvelopeOpenError('envelope authentication failed — wrong key or tampered ciphertext');
  }
  return plaintext;
}

/** Convenience: open an envelope and parse the plaintext as UTF-8 JSON. */
export function openEnvelopeJson<T>(
  envelope: Envelope,
  theirPublicKey: string,
  ourSecretKey: string,
): T {
  const bytes = openEnvelope(envelope, theirPublicKey, ourSecretKey);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as T;
}

/** Convenience: JSON-encode + seal. */
export function sealEnvelopeJson(
  payload: unknown,
  theirPublicKey: string,
  ourSecretKey: string,
): Envelope {
  return sealEnvelope(JSON.stringify(payload), theirPublicKey, ourSecretKey);
}
