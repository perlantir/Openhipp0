/**
 * Relay client authentication.
 *
 * A client (server or mobile) presents a pre-shared relay token + its
 * stable client id. The relay verifies the token belongs to the claimed
 * id and admits / rejects. Beyond that, the relay never inspects message
 * content — every envelope is NaCl-box sealed by the peers themselves.
 *
 * This keeps the threat model simple: **a compromised relay can DoS but
 * cannot decrypt.** That property is the whole reason the relay exists
 * as a separate process.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

export interface ClientCredential {
  clientId: string;
  /** Hashed token — never keep the plaintext on disk. */
  tokenSha256: string;
  /** Free-form tag for logs — "server" / "mobile-iphone" etc. */
  label?: string;
}

export interface CredentialStore {
  get(clientId: string): Promise<ClientCredential | undefined>;
  put(credential: ClientCredential): Promise<void>;
  remove(clientId: string): Promise<void>;
}

export class MemoryCredentialStore implements CredentialStore {
  private readonly creds = new Map<string, ClientCredential>();
  async get(clientId: string): Promise<ClientCredential | undefined> {
    return this.creds.get(clientId);
  }
  async put(credential: ClientCredential): Promise<void> {
    this.creds.set(credential.clientId, credential);
  }
  async remove(clientId: string): Promise<void> {
    this.creds.delete(clientId);
  }
}

export function hashToken(plaintextToken: string): string {
  return createHash('sha256').update(plaintextToken).digest('hex');
}

/** Constant-time token check. */
export async function verifyClient(
  clientId: string,
  presentedToken: string,
  store: CredentialStore,
): Promise<boolean> {
  const credential = await store.get(clientId);
  if (!credential) return false;
  const expected = Buffer.from(credential.tokenSha256, 'hex');
  const actual = Buffer.from(hashToken(presentedToken), 'hex');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
