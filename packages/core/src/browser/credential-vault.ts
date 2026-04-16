/**
 * CredentialVault — AES-256-GCM encrypted storage for site credentials.
 *
 * Persistence is pluggable: the default node:fs implementation writes a
 * single JSON file under ~/.hipp0/auth/vault.json; tests inject an
 * in-memory backend.
 *
 * The master password is supplied once at construction; the key is derived
 * via scrypt (N=16384, r=8, p=1). Password is never stored — lose it and
 * the vault is unrecoverable.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export interface SiteCredentials {
  site: string;
  username?: string;
  password?: string;
  totpSecret?: string;
  cookies?: Record<string, unknown>[];
  oauthTokens?: Record<string, unknown>;
  updatedAt: string;
}

export interface VaultBackend {
  read(): Promise<EncryptedVault | null>;
  write(v: EncryptedVault): Promise<void>;
}

export interface EncryptedVault {
  version: 1;
  salt: string; // base64 — bound to the master password
  nonce: string; // base64
  authTag: string; // base64
  ciphertext: string; // base64(JSON.stringify(entries))
}

const KEY_LEN = 32;
const SALT_LEN = 16;
const NONCE_LEN = 12;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

export class CredentialVault {
  constructor(
    private readonly masterPassword: string,
    private readonly backend: VaultBackend,
  ) {
    if (!masterPassword) {
      throw new Error('CredentialVault: master password is required');
    }
  }

  async list(): Promise<string[]> {
    const entries = await this.loadAll();
    return Object.keys(entries);
  }

  async get(site: string): Promise<SiteCredentials | null> {
    const entries = await this.loadAll();
    return entries[site] ?? null;
  }

  async store(cred: SiteCredentials): Promise<void> {
    const entries = await this.loadAll();
    entries[cred.site] = { ...cred, updatedAt: new Date().toISOString() };
    await this.saveAll(entries);
  }

  async delete(site: string): Promise<boolean> {
    const entries = await this.loadAll();
    if (!(site in entries)) return false;
    delete entries[site];
    await this.saveAll(entries);
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────

  private async loadAll(): Promise<Record<string, SiteCredentials>> {
    const v = await this.backend.read();
    if (!v) return {};
    const salt = Buffer.from(v.salt, 'base64');
    const nonce = Buffer.from(v.nonce, 'base64');
    const authTag = Buffer.from(v.authTag, 'base64');
    const ciphertext = Buffer.from(v.ciphertext, 'base64');
    const key = scryptSync(this.masterPassword, salt, KEY_LEN, SCRYPT_PARAMS);

    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(authTag);
    try {
      const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return JSON.parse(plain.toString('utf8')) as Record<string, SiteCredentials>;
    } catch {
      throw new Error('CredentialVault: failed to decrypt — wrong master password or tampered vault');
    }
  }

  private async saveAll(entries: Record<string, SiteCredentials>): Promise<void> {
    const salt = randomBytes(SALT_LEN);
    const nonce = randomBytes(NONCE_LEN);
    const key = scryptSync(this.masterPassword, salt, KEY_LEN, SCRYPT_PARAMS);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const plaintext = Buffer.from(JSON.stringify(entries), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    await this.backend.write({
      version: 1,
      salt: salt.toString('base64'),
      nonce: nonce.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    });
  }
}

/**
 * In-memory backend — use in tests. For production, the CLI's
 * file-system helper writes ~/.hipp0/auth/vault.json with 0o600 perms.
 */
export function inMemoryBackend(): VaultBackend {
  let current: EncryptedVault | null = null;
  return {
    async read() {
      return current;
    },
    async write(v) {
      current = v;
    },
  };
}

/** Safe-equals string comparison — avoids timing attacks on password checks. */
export function secureEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
