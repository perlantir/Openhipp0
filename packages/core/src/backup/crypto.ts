/**
 * Backup crypto — AES-256-GCM with per-dataset salts + nonces.
 *
 * Reuses the shape from `core/browser/credential-vault.ts` (proven +
 * audited pattern) but scoped to backup blobs: each table gets its own
 * salt + nonce so replay attacks across blobs are impossible.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { Hipp0BackupError, type EncryptedBlob } from './types.js';

const KEY_LEN = 32;
const SALT_LEN = 16;
const NONCE_LEN = 12;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

export function encryptJson(value: unknown, password: string): EncryptedBlob {
  const salt = randomBytes(SALT_LEN);
  const nonce = randomBytes(NONCE_LEN);
  const key = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    version: 1,
    salt: salt.toString('base64'),
    nonce: nonce.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptJson<T = unknown>(blob: EncryptedBlob, password: string): T {
  if (blob.version !== 1) {
    throw new Hipp0BackupError(
      `Unsupported blob version ${blob.version}`,
      'HIPP0_BACKUP_BLOB_VERSION',
    );
  }
  const salt = Buffer.from(blob.salt, 'base64');
  const nonce = Buffer.from(blob.nonce, 'base64');
  const authTag = Buffer.from(blob.authTag, 'base64');
  const ciphertext = Buffer.from(blob.ciphertext, 'base64');
  const key = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(authTag);
  try {
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plain.toString('utf8')) as T;
  } catch {
    throw new Hipp0BackupError(
      'Failed to decrypt — wrong password or tampered blob',
      'HIPP0_BACKUP_DECRYPT_FAILED',
    );
  }
}
