/**
 * Rotation + revocation + shouldRotate policy tests.
 */

import { describe, expect, it, vi } from 'vitest';
import { OAuth2Client, inMemoryTokenStore } from '../../src/auth/index.js';
import type { OAuth2Fetch, OAuth2Provider, OAuth2TokenSet } from '../../src/auth/types.js';

const PROVIDER: OAuth2Provider = {
  id: 'test',
  authorizationEndpoint: 'https://example.com/auth',
  tokenEndpoint: 'https://example.com/token',
  revocationEndpoint: 'https://example.com/revoke',
};

function fakeFetch(
  responses: Array<{ status?: number; body?: Record<string, unknown> | string }>,
): OAuth2Fetch & { calls: Array<{ url: string; body: URLSearchParams }> } {
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const ctor = async (url: string, init: RequestInit) => {
    calls.push({
      url,
      body: new URLSearchParams(init.body as string),
    });
    const next = responses.shift() ?? { status: 500, body: 'no fake left' };
    const payload = typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? {});
    return new Response(payload, {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  (ctor as OAuth2Fetch & { calls: typeof calls }).calls = calls;
  return ctor as OAuth2Fetch & { calls: typeof calls };
}

async function seedTokens(opts: {
  store: ReturnType<typeof inMemoryTokenStore>;
  tokens: Partial<OAuth2TokenSet>;
}): Promise<void> {
  await opts.store.set('test', 'alice', {
    providerId: 'test',
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    tokenType: 'Bearer',
    ...opts.tokens,
  });
}

describe('OAuth2Client.rotate', () => {
  it('force-rotates and stores the new token set', async () => {
    const store = inMemoryTokenStore();
    await seedTokens({ store });
    const fetch = fakeFetch([
      {
        body: {
          access_token: 'access-2',
          refresh_token: 'refresh-2',
          expires_in: 3600,
          token_type: 'Bearer',
        },
      },
    ]);
    const client = new OAuth2Client({
      provider: PROVIDER,
      clientId: 'cid',
      redirectUri: 'http://localhost/cb',
      store,
      fetch,
    });

    const rotated = await client.rotate('alice');
    expect(rotated.accessToken).toBe('access-2');
    expect(rotated.refreshToken).toBe('refresh-2');
    const saved = await store.get('test', 'alice');
    expect(saved?.accessToken).toBe('access-2');
  });

  it('falls back to old refresh token when the provider does not re-issue', async () => {
    const store = inMemoryTokenStore();
    await seedTokens({ store });
    const fetch = fakeFetch([
      {
        body: { access_token: 'access-2', expires_in: 3600, token_type: 'Bearer' },
      },
    ]);
    const client = new OAuth2Client({
      provider: PROVIDER,
      clientId: 'cid',
      redirectUri: 'http://localhost/cb',
      store,
      fetch,
    });
    const rotated = await client.rotate('alice');
    expect(rotated.refreshToken).toBe('refresh-1');
  });

  it('throws when there is no refresh token', async () => {
    const store = inMemoryTokenStore();
    await store.set('test', 'alice', {
      providerId: 'test',
      accessToken: 'a',
      expiresAt: 0,
      tokenType: 'Bearer',
    });
    const client = new OAuth2Client({
      provider: PROVIDER,
      clientId: 'c',
      redirectUri: '/',
      store,
      fetch: fakeFetch([]),
    });
    await expect(client.rotate('alice')).rejects.toThrow(/No refresh token/);
  });
});

describe('OAuth2Client.revoke', () => {
  it('revokes access + refresh tokens at the provider and deletes locally', async () => {
    const store = inMemoryTokenStore();
    await seedTokens({ store });
    const fetch = fakeFetch([
      { status: 200, body: '' }, // access_token revoke
      { status: 200, body: '' }, // refresh_token revoke
    ]);
    const client = new OAuth2Client({
      provider: PROVIDER,
      clientId: 'cid',
      redirectUri: 'http://localhost/cb',
      store,
      fetch,
    });

    const result = await client.revoke('alice');
    expect(result).toEqual({ localDeleted: true, serverRevoked: true });
    expect(await store.get('test', 'alice')).toBeNull();
    expect(fetch.calls.map((c) => c.body.get('token'))).toEqual(['access-1', 'refresh-1']);
    expect(fetch.calls.map((c) => c.body.get('token_type_hint'))).toEqual([
      'access_token',
      'refresh_token',
    ]);
  });

  it('deletes locally even when provider revocation fails', async () => {
    const store = inMemoryTokenStore();
    await seedTokens({ store });
    const fetch = fakeFetch([{ status: 500, body: 'provider down' }]);
    const client = new OAuth2Client({
      provider: PROVIDER,
      clientId: 'cid',
      redirectUri: 'http://localhost/cb',
      store,
      fetch,
    });

    const result = await client.revoke('alice');
    expect(result.localDeleted).toBe(true);
    expect(result.serverRevoked).toBe(false);
    expect(await store.get('test', 'alice')).toBeNull();
  });

  it('no-ops silently for unknown account', async () => {
    const store = inMemoryTokenStore();
    const client = new OAuth2Client({
      provider: PROVIDER,
      clientId: 'c',
      redirectUri: '/',
      store,
      fetch: fakeFetch([]),
    });
    const result = await client.revoke('ghost');
    expect(result).toEqual({ localDeleted: false, serverRevoked: false });
  });

  it('skips server revocation when provider has no revocation endpoint', async () => {
    const store = inMemoryTokenStore();
    await seedTokens({ store });
    const fetch = fakeFetch([]);
    const client = new OAuth2Client({
      provider: { ...PROVIDER, revocationEndpoint: undefined },
      clientId: 'c',
      redirectUri: '/',
      store,
      fetch,
    });
    const result = await client.revoke('alice');
    expect(result.localDeleted).toBe(true);
    expect(result.serverRevoked).toBe(false);
    expect(fetch.calls).toHaveLength(0);
  });
});

describe('shouldRotate policy', () => {
  it('rotates proactively when policy returns true even on fresh tokens', async () => {
    const store = inMemoryTokenStore();
    await seedTokens({ store });
    const policy = vi.fn().mockReturnValue(true);
    const fetch = fakeFetch([
      {
        body: {
          access_token: 'rotated-access',
          refresh_token: 'rotated-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        },
      },
    ]);
    const client = new OAuth2Client({
      provider: PROVIDER,
      clientId: 'c',
      redirectUri: '/',
      store,
      fetch,
      shouldRotate: policy,
    });

    const token = await client.getAccessToken('alice');
    expect(token).toBe('rotated-access');
    expect(policy).toHaveBeenCalledOnce();
  });

  it('skips rotation when policy returns false', async () => {
    const store = inMemoryTokenStore();
    await seedTokens({ store });
    const policy = vi.fn().mockReturnValue(false);
    const fetch = fakeFetch([]);
    const client = new OAuth2Client({
      provider: PROVIDER,
      clientId: 'c',
      redirectUri: '/',
      store,
      fetch,
      shouldRotate: policy,
    });
    const token = await client.getAccessToken('alice');
    expect(token).toBe('access-1');
    expect(policy).toHaveBeenCalledOnce();
    expect(fetch.calls).toHaveLength(0);
  });

  it('policy is not consulted when the token is already expired (refresh path wins)', async () => {
    const store = inMemoryTokenStore();
    await seedTokens({ store, tokens: { expiresAt: 0 } });
    const policy = vi.fn();
    const fetch = fakeFetch([
      { body: { access_token: 'fresh', expires_in: 3600, token_type: 'Bearer' } },
    ]);
    const client = new OAuth2Client({
      provider: PROVIDER,
      clientId: 'c',
      redirectUri: '/',
      store,
      fetch,
      shouldRotate: policy,
    });
    await client.getAccessToken('alice');
    expect(policy).not.toHaveBeenCalled();
  });
});
