import { describe, it, expect } from 'vitest';
import {
  hashToken,
  generateToken,
  mintApiKey,
  rotateApiKey,
  revokeApiKey,
  verifyApiKey,
  type AgentApiKey,
  type AgentApiKeyStore,
} from '../../src/enterprise/api-keys.js';

function fakeStore(): AgentApiKeyStore {
  const rows = new Map<string, AgentApiKey>();
  let nextId = 1;
  return {
    async create(input) {
      const id = `ak-${nextId++}`;
      const key: AgentApiKey = { ...input, id, createdAt: new Date(0).toISOString() };
      rows.set(id, key);
      return key;
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async findByHash(hash) {
      for (const row of rows.values()) if (row.hash === hash) return row;
      return null;
    },
    async listByAgent(agentId) {
      return [...rows.values()].filter((r) => r.agentId === agentId);
    },
    async update(id, patch) {
      const existing = rows.get(id);
      if (!existing) throw new Error(`missing ${id}`);
      const next = { ...existing, ...patch };
      rows.set(id, next);
      return next;
    },
  };
}

describe('API keys', () => {
  it('generateToken produces hipp0_ak_-prefixed tokens', () => {
    const { token, prefix } = generateToken();
    expect(token.startsWith('hipp0_ak_')).toBe(true);
    expect(prefix.length).toBeGreaterThan('hipp0_ak_'.length);
  });

  it('mint returns plaintext exactly once and stores only the hash', async () => {
    const store = fakeStore();
    const r = await mintApiKey(store, {
      agentId: 'a1',
      organizationId: 'org',
      name: 'primary',
      createdBy: 'u1',
    });
    expect(r.plaintext.startsWith('hipp0_ak_')).toBe(true);
    expect(r.key.hash).toBe(hashToken(r.plaintext));
    const listed = await store.listByAgent('a1');
    expect(listed).toHaveLength(1);
  });

  it('rotate generates a new plaintext and increments rotation count', async () => {
    const store = fakeStore();
    const minted = await mintApiKey(store, {
      agentId: 'a1',
      organizationId: 'org',
      name: 'primary',
      createdBy: 'u1',
    });
    const rotated = await rotateApiKey(store, minted.key.id);
    expect(rotated.plaintext).not.toBe(minted.plaintext);
    expect(rotated.key.rotationCount).toBe(1);
    expect(rotated.key.hash).toBe(hashToken(rotated.plaintext));
  });

  it('verify updates last-used and returns ok', async () => {
    const store = fakeStore();
    const { plaintext, key } = await mintApiKey(store, {
      agentId: 'a',
      organizationId: 'o',
      name: 'n',
      createdBy: 'u',
    });
    const now = new Date('2026-04-16T10:00:00Z');
    const r = await verifyApiKey(store, plaintext, now);
    expect(r.ok).toBe(true);
    const after = await store.get(key.id);
    expect(after?.lastUsedAt).toBe(now.toISOString());
  });

  it('verify rejects revoked keys', async () => {
    const store = fakeStore();
    const { plaintext, key } = await mintApiKey(store, {
      agentId: 'a',
      organizationId: 'o',
      name: 'n',
      createdBy: 'u',
    });
    await revokeApiKey(store, key.id);
    const r = await verifyApiKey(store, plaintext);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('revoked');
  });

  it('verify rejects expired keys', async () => {
    const store = fakeStore();
    const { plaintext } = await mintApiKey(store, {
      agentId: 'a',
      organizationId: 'o',
      name: 'n',
      createdBy: 'u',
      expiresAt: new Date(Date.now() - 10_000),
    });
    const r = await verifyApiKey(store, plaintext);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('expired');
  });

  it('verify rejects unknown/typo tokens', async () => {
    const store = fakeStore();
    const r = await verifyApiKey(store, 'hipp0_ak_totally-bogus');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not-found');
  });
});
