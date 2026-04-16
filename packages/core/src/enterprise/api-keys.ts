/**
 * Per-agent API key lifecycle.
 *
 * Each agent can mint its own credential; tokens are short-lived by default,
 * scoped to a single agent, and auditable (last-used, rotation count,
 * revocation). Tokens are stored as SHA-256 hashes — we return the plaintext
 * exactly once at creation / rotation.
 */

import crypto from 'node:crypto';

export interface AgentApiKey {
  id: string;
  agentId: string;
  organizationId: string;
  name: string;
  prefix: string; // shown in listings, e.g. "hipp0_ak_123..."
  hash: string; // SHA-256 of the full token
  createdAt: string;
  createdBy: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
  scopes: readonly string[];
  rotationCount: number;
}

export interface AgentApiKeyStore {
  create(input: Omit<AgentApiKey, 'id' | 'createdAt'>): Promise<AgentApiKey>;
  get(id: string): Promise<AgentApiKey | null>;
  findByHash(hash: string): Promise<AgentApiKey | null>;
  listByAgent(agentId: string): Promise<readonly AgentApiKey[]>;
  update(id: string, patch: Partial<AgentApiKey>): Promise<AgentApiKey>;
}

export interface MintedKey {
  key: AgentApiKey;
  /** Plaintext token — returned exactly once. Caller must surface it immediately. */
  plaintext: string;
}

/** `hipp0_ak_` prefix + 32 bytes of base62-ish randomness. */
const TOKEN_PREFIX = 'hipp0_ak_';

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateToken(): { token: string; prefix: string } {
  const random = crypto.randomBytes(32).toString('base64url');
  const token = `${TOKEN_PREFIX}${random}`;
  const prefix = token.slice(0, TOKEN_PREFIX.length + 8);
  return { token, prefix };
}

export async function mintApiKey(
  store: AgentApiKeyStore,
  input: {
    agentId: string;
    organizationId: string;
    name: string;
    createdBy: string;
    scopes?: readonly string[];
    expiresAt?: Date | null;
  },
): Promise<MintedKey> {
  const { token, prefix } = generateToken();
  const hash = hashToken(token);
  const key = await store.create({
    agentId: input.agentId,
    organizationId: input.organizationId,
    name: input.name,
    prefix,
    hash,
    createdBy: input.createdBy,
    lastUsedAt: null,
    revokedAt: null,
    expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
    scopes: input.scopes ?? ['agent.use'],
    rotationCount: 0,
  });
  return { key, plaintext: token };
}

export async function rotateApiKey(
  store: AgentApiKeyStore,
  id: string,
): Promise<MintedKey> {
  const existing = await store.get(id);
  if (!existing) throw new Error('API_KEY_NOT_FOUND');
  if (existing.revokedAt) throw new Error('API_KEY_REVOKED');
  const { token, prefix } = generateToken();
  const hash = hashToken(token);
  const updated = await store.update(id, {
    prefix,
    hash,
    rotationCount: existing.rotationCount + 1,
    lastUsedAt: null,
  });
  return { key: updated, plaintext: token };
}

export async function revokeApiKey(store: AgentApiKeyStore, id: string, now: Date = new Date()): Promise<void> {
  const existing = await store.get(id);
  if (!existing) return; // revoke is idempotent
  if (existing.revokedAt) return;
  await store.update(id, { revokedAt: now.toISOString() });
}

export interface VerifyResult {
  ok: boolean;
  key?: AgentApiKey;
  reason?: 'not-found' | 'revoked' | 'expired';
}

export async function verifyApiKey(
  store: AgentApiKeyStore,
  plaintext: string,
  now: Date = new Date(),
): Promise<VerifyResult> {
  if (!plaintext.startsWith(TOKEN_PREFIX)) return { ok: false, reason: 'not-found' };
  const key = await store.findByHash(hashToken(plaintext));
  if (!key) return { ok: false, reason: 'not-found' };
  if (key.revokedAt) return { ok: false, reason: 'revoked' };
  if (key.expiresAt && Date.parse(key.expiresAt) < now.getTime()) {
    return { ok: false, reason: 'expired' };
  }
  await store.update(key.id, { lastUsedAt: now.toISOString() });
  return { ok: true, key };
}

/**
 * Resolver shape consumed by the HTTP auth middleware — curries an
 * AgentApiKeyStore so the middleware doesn't need to know about Phase 14
 * internals.
 */
export interface ApiKeyResolver {
  verify(plaintext: string, now?: Date): Promise<VerifyResult>;
}

export function createApiKeyResolver(store: AgentApiKeyStore): ApiKeyResolver {
  return {
    verify: (plaintext, now) => verifyApiKey(store, plaintext, now),
  };
}
