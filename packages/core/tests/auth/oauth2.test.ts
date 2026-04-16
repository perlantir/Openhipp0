import { describe, it, expect } from 'vitest';
import {
  GITHUB,
  OAuth2Client,
  inMemoryTokenStore,
  type OAuth2Fetch,
} from '../../src/auth/index.js';

function mockFetch(handler: (url: string, init: RequestInit) => Response): OAuth2Fetch {
  return async (url, init) => handler(url, init);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('OAuth2Client', () => {
  it('startAuthorization builds a compliant authorize URL + returns state/verifier', () => {
    const client = new OAuth2Client({
      provider: GITHUB,
      clientId: 'cid',
      redirectUri: 'http://localhost/cb',
      store: inMemoryTokenStore(),
      fetch: mockFetch(() => new Response('unused')),
    });
    const { url, state, verifier } = client.startAuthorization({ account: 'me' });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('cid');
    expect(parsed.searchParams.get('state')).toBe(state);
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('code_challenge')).toBeTruthy();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });

  it('completeAuthorization rejects a state mismatch', async () => {
    const client = new OAuth2Client({
      provider: GITHUB,
      clientId: 'cid',
      redirectUri: 'http://localhost/cb',
      store: inMemoryTokenStore(),
      fetch: mockFetch(() => new Response('unused')),
    });
    await expect(
      client.completeAuthorization({
        account: 'me',
        code: 'c',
        state: 'a',
        expectedState: 'b',
        verifier: 'v',
      }),
    ).rejects.toThrow(/state mismatch/);
  });

  it('completeAuthorization stores normalized tokens', async () => {
    const store = inMemoryTokenStore();
    let receivedBody = '';
    const client = new OAuth2Client({
      provider: GITHUB,
      clientId: 'cid',
      clientSecret: 'sec',
      redirectUri: 'http://localhost/cb',
      store,
      fetch: mockFetch((url, init) => {
        expect(url).toBe(GITHUB.tokenEndpoint);
        receivedBody = String(init.body);
        return jsonResponse({
          access_token: 'A',
          refresh_token: 'R',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'repo',
        });
      }),
    });
    const tokens = await client.completeAuthorization({
      account: 'me',
      code: 'abc',
      state: 'same',
      expectedState: 'same',
      verifier: 'ver',
    });
    expect(tokens.accessToken).toBe('A');
    expect(tokens.refreshToken).toBe('R');
    expect(tokens.scope).toBe('repo');
    expect(receivedBody).toContain('grant_type=authorization_code');
    expect(receivedBody).toContain('code_verifier=ver');
    expect(receivedBody).toContain('client_secret=sec');
    expect((await store.get('github', 'me'))?.accessToken).toBe('A');
  });

  it('getAccessToken refreshes when the stored token is expired', async () => {
    const store = inMemoryTokenStore();
    await store.set('github', 'me', {
      providerId: 'github',
      accessToken: 'old',
      refreshToken: 'R',
      expiresAt: Math.floor(Date.now() / 1000) - 10, // expired
      tokenType: 'Bearer',
    });
    let called = 0;
    const client = new OAuth2Client({
      provider: GITHUB,
      clientId: 'cid',
      redirectUri: 'http://localhost/cb',
      store,
      fetch: mockFetch((_url, init) => {
        called++;
        expect(String(init.body)).toContain('grant_type=refresh_token');
        return jsonResponse({ access_token: 'NEW', expires_in: 3600, token_type: 'Bearer' });
      }),
    });
    const tok = await client.getAccessToken('me');
    expect(tok).toBe('NEW');
    expect(called).toBe(1);
    // Second call: fresh, no network.
    const tok2 = await client.getAccessToken('me');
    expect(tok2).toBe('NEW');
    expect(called).toBe(1);
  });

  it('getAccessToken throws a clear error when no tokens are stored', async () => {
    const client = new OAuth2Client({
      provider: GITHUB,
      clientId: 'cid',
      redirectUri: 'http://localhost/cb',
      store: inMemoryTokenStore(),
      fetch: mockFetch(() => new Response('unused')),
    });
    await expect(client.getAccessToken('me')).rejects.toThrow(/No stored tokens/);
  });

  it('raises on a non-2xx token exchange', async () => {
    const client = new OAuth2Client({
      provider: GITHUB,
      clientId: 'cid',
      redirectUri: 'http://localhost/cb',
      store: inMemoryTokenStore(),
      fetch: mockFetch(
        () => new Response(JSON.stringify({ error: 'bad_client' }), { status: 400 }),
      ),
    });
    await expect(
      client.completeAuthorization({
        account: 'me',
        code: 'c',
        state: 's',
        expectedState: 's',
        verifier: 'v',
      }),
    ).rejects.toThrow(/token exchange failed/);
  });
});
