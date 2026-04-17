/**
 * Key derivation + AES-256-GCM round trip.
 * Uses Node's `node:crypto` only — no new runtime deps.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCb,
} from 'node:crypto';

import { Hipp0BrowserProfileCorruptError } from '../errors.js';
import type { AesGcmCipher, ScryptKdfParams } from './types.js';

export const DEFAULT_SCRYPT_N = 1 << 17; // 131072
export const DEFAULT_SCRYPT_R = 8;
export const DEFAULT_SCRYPT_P = 1;
const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM standard
const SALT_LEN = 32;

export function newSalt(): Buffer {
  return randomBytes(SALT_LEN);
}

export function newIv(): Buffer {
  return randomBytes(IV_LEN);
}

export function defaultKdfParams(saltB64?: string): ScryptKdfParams {
  return {
    algo: 'scrypt',
    N: DEFAULT_SCRYPT_N,
    r: DEFAULT_SCRYPT_R,
    p: DEFAULT_SCRYPT_P,
    saltB64: saltB64 ?? newSalt().toString('base64'),
  };
}

/** Derive a 32-byte AES key from a passphrase + scrypt params. */
export async function deriveKey(passphrase: string, params: ScryptKdfParams): Promise<Buffer> {
  if (params.algo !== 'scrypt') {
    throw new Error(`unsupported KDF algo: ${(params as { algo: string }).algo}`);
  }
  const salt = Buffer.from(params.saltB64, 'base64');
  return await new Promise<Buffer>((resolve, reject) => {
    scryptCb(
      passphrase,
      salt,
      KEY_LEN,
      { N: params.N, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/** Encrypt `plaintext` → envelope. Caller supplies the derived key. */
export function encryptBlob(key: Buffer, plaintext: Buffer): AesGcmCipher {
  const iv = newIv();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    algo: 'aes-256-gcm',
    ivB64: iv.toString('base64'),
    authTagB64: authTag.toString('base64'),
    ciphertextB64: ct.toString('base64'),
  };
}

/** Decrypt envelope → plaintext. Throws `Hipp0BrowserProfileCorruptError` on auth failure. */
export function decryptBlob(key: Buffer, envelope: AesGcmCipher): Buffer {
  if (envelope.algo !== 'aes-256-gcm') {
    throw new Error(`unsupported cipher algo: ${(envelope as { algo: string }).algo}`);
  }
  const iv = Buffer.from(envelope.ivB64, 'base64');
  const authTag = Buffer.from(envelope.authTagB64, 'base64');
  const ct = Buffer.from(envelope.ciphertextB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch (err) {
    throw new Hipp0BrowserProfileCorruptError('GCM auth tag mismatch', { cause: err });
  }
}
