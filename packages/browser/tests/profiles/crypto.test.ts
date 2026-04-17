import { describe, expect, it } from 'vitest';

import {
  decryptBlob,
  defaultKdfParams,
  deriveKey,
  encryptBlob,
  newIv,
  newSalt,
} from '../../src/profiles/crypto.js';
import { Hipp0BrowserProfileCorruptError } from '../../src/errors.js';

describe('crypto', () => {
  it('derives a 32-byte key from a passphrase + scrypt params', async () => {
    const params = defaultKdfParams();
    const key = await deriveKey('correct horse battery staple', params);
    expect(key).toBeInstanceOf(Buffer);
    expect(key.byteLength).toBe(32);
  });

  it('derives the same key from the same passphrase + salt', async () => {
    const params = defaultKdfParams();
    const [k1, k2] = await Promise.all([
      deriveKey('pw', params),
      deriveKey('pw', params),
    ]);
    expect(Buffer.compare(k1, k2)).toBe(0);
  });

  it('derives different keys when the salt changes', async () => {
    const p1 = defaultKdfParams();
    const p2 = defaultKdfParams();
    const [k1, k2] = await Promise.all([deriveKey('pw', p1), deriveKey('pw', p2)]);
    expect(Buffer.compare(k1, k2)).not.toBe(0);
  });

  it('round-trips a buffer through AES-256-GCM', async () => {
    const key = await deriveKey('pw', defaultKdfParams());
    const plaintext = Buffer.from('hello profiles', 'utf8');
    const envelope = encryptBlob(key, plaintext);
    expect(envelope.algo).toBe('aes-256-gcm');
    const decrypted = decryptBlob(key, envelope);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('throws Hipp0BrowserProfileCorruptError on a tampered ciphertext', async () => {
    const key = await deriveKey('pw', defaultKdfParams());
    const envelope = encryptBlob(key, Buffer.from('payload'));
    const ct = Buffer.from(envelope.ciphertextB64, 'base64');
    ct[0] = (ct[0] ?? 0) ^ 0xff;
    const tampered = { ...envelope, ciphertextB64: ct.toString('base64') };
    expect(() => decryptBlob(key, tampered)).toThrow(Hipp0BrowserProfileCorruptError);
  });

  it('produces distinct salts and IVs', () => {
    const s1 = newSalt();
    const s2 = newSalt();
    const i1 = newIv();
    const i2 = newIv();
    expect(s1.byteLength).toBe(32);
    expect(i1.byteLength).toBe(12);
    expect(Buffer.compare(s1, s2)).not.toBe(0);
    expect(Buffer.compare(i1, i2)).not.toBe(0);
  });
});
