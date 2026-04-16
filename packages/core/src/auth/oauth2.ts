/**
 * OAuth2Client — authorization-code + PKCE flow with automatic refresh.
 *
 * Usage:
 *
 *   const client = new OAuth2Client({ provider, clientId, redirectUri, store });
 *   const { url, state, verifier } = client.startAuthorization({ scopes });
 *   // ... user visits `url`, consents, browser redirects to `redirectUri` with ?code=...&state=...
 *   const tokens = await client.completeAuthorization({ code, state, verifier });
 *   const accessToken = await client.getAccessToken(account);  // auto-refreshes
 */

import { randomBytes } from 'node:crypto';
import type {
  OAuth2Fetch,
  OAuth2Provider,
  OAuth2TokenSet,
  TokenStore,
} from './types.js';
import { createPkceVerifier, deriveChallenge } from './pkce.js';

export interface OAuth2ClientConfig {
  provider: OAuth2Provider;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  store: TokenStore;
  /** Override global fetch (tests). */
  fetch?: OAuth2Fetch;
  /** Skew (seconds) below which a token is considered expired. Default 30s. */
  expirySkewSec?: number;
  /**
   * Optional rotation policy. Called on every getAccessToken() even when the
   * access token is still fresh; if it returns true we proactively refresh
   * the token. Useful for: rotating near half-life, rotating after N calls,
   * rotating on a wall-clock schedule, forcing rotation after a security
   * incident. Not called when no refresh token is available.
   */
  shouldRotate?: (tokens: OAuth2TokenSet) => boolean | Promise<boolean>;
}

export interface StartAuthorizationArgs {
  /** Scopes to request. Falls back to `provider.defaultScopes`. */
  scopes?: readonly string[];
  /** Caller-chosen account name to pair the tokens with in the store. */
  account: string;
  /** Extra params to append to the authorize URL. */
  extraParams?: Record<string, string>;
}

export interface StartAuthorizationResult {
  url: string;
  state: string;
  verifier: string;
}

export interface CompleteAuthorizationArgs {
  account: string;
  code: string;
  state: string;
  expectedState: string;
  verifier: string;
}

export class OAuth2Client {
  private readonly fetch: OAuth2Fetch;
  private readonly expirySkewSec: number;

  constructor(private readonly config: OAuth2ClientConfig) {
    this.fetch = config.fetch ?? (globalThis.fetch as OAuth2Fetch);
    this.expirySkewSec = config.expirySkewSec ?? 30;
    if (!this.fetch) {
      throw new Error('OAuth2Client: a `fetch` implementation is required (global fetch unavailable)');
    }
  }

  startAuthorization(args: StartAuthorizationArgs): StartAuthorizationResult {
    const { provider, clientId, redirectUri } = this.config;
    const verifier = createPkceVerifier();
    const challenge = deriveChallenge(verifier);
    const state = base64urlRandom(24);
    const scopes = (args.scopes ?? provider.defaultScopes ?? []).join(' ');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    if (scopes) params.set('scope', scopes);
    if (provider.requiresOfflineConsent) {
      params.set('access_type', 'offline');
      params.set('prompt', 'consent');
    }
    for (const [k, v] of Object.entries({
      ...(provider.authorizeExtraParams ?? {}),
      ...(args.extraParams ?? {}),
    })) {
      params.set(k, v);
    }

    const url = `${provider.authorizationEndpoint}?${params.toString()}`;
    return { url, state, verifier };
  }

  async completeAuthorization(args: CompleteAuthorizationArgs): Promise<OAuth2TokenSet> {
    if (args.state !== args.expectedState) {
      throw new Error('OAuth2Client: state mismatch — possible CSRF');
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      code_verifier: args.verifier,
    });
    if (this.config.clientSecret) body.set('client_secret', this.config.clientSecret);

    const tokens = await this.exchange(body);
    await this.config.store.set(this.config.provider.id, args.account, tokens);
    return tokens;
  }

  /**
   * Return a currently-valid access token for the account, refreshing if the
   * stored one is expired (or about to be). Also runs the optional
   * `shouldRotate` policy and rotates proactively when it returns true.
   */
  async getAccessToken(account: string): Promise<string> {
    const stored = await this.config.store.get(this.config.provider.id, account);
    if (!stored) {
      throw new Error(`No stored tokens for ${this.config.provider.id}/${account} — call completeAuthorization first.`);
    }

    const expired = !this.isFresh(stored);
    const rotatePolicy =
      !expired && stored.refreshToken && this.config.shouldRotate
        ? await this.config.shouldRotate(stored)
        : false;

    if (!expired && !rotatePolicy) return stored.accessToken;
    if (!stored.refreshToken) {
      throw new Error(`Token expired and no refresh token available for ${this.config.provider.id}/${account}`);
    }

    const refreshed = await this.refresh(stored.refreshToken);
    // Some providers don't re-issue the refresh token — fall back to the old one.
    const merged: OAuth2TokenSet = {
      ...refreshed,
      refreshToken: refreshed.refreshToken ?? stored.refreshToken,
    };
    await this.config.store.set(this.config.provider.id, account, merged);
    return merged.accessToken;
  }

  /**
   * Force-rotate the stored tokens for an account. Returns the new token set.
   * Throws if no refresh token is available.
   */
  async rotate(account: string): Promise<OAuth2TokenSet> {
    const stored = await this.config.store.get(this.config.provider.id, account);
    if (!stored) throw new Error(`No stored tokens for ${this.config.provider.id}/${account}`);
    if (!stored.refreshToken) {
      throw new Error(`No refresh token — cannot rotate ${this.config.provider.id}/${account}`);
    }
    const refreshed = await this.refresh(stored.refreshToken);
    const merged: OAuth2TokenSet = {
      ...refreshed,
      refreshToken: refreshed.refreshToken ?? stored.refreshToken,
    };
    await this.config.store.set(this.config.provider.id, account, merged);
    return merged;
  }

  /**
   * Revoke the stored tokens for an account. If the provider exposes a
   * revocation endpoint (RFC 7009), both the access and refresh tokens are
   * revoked server-side. Always deletes from the local store, even if the
   * server-side revocation fails — we prefer a permissive local delete over
   * tokens that linger after an explicit revoke intent.
   */
  async revoke(account: string): Promise<{ localDeleted: boolean; serverRevoked: boolean }> {
    const stored = await this.config.store.get(this.config.provider.id, account);
    if (!stored) return { localDeleted: false, serverRevoked: false };

    let serverRevoked = false;
    const endpoint = this.config.provider.revocationEndpoint;
    if (endpoint) {
      try {
        if (stored.accessToken) {
          await this.postRevocation(endpoint, stored.accessToken, 'access_token');
        }
        if (stored.refreshToken) {
          await this.postRevocation(endpoint, stored.refreshToken, 'refresh_token');
        }
        serverRevoked = true;
      } catch {
        // Best-effort. Fall through to the local delete so the user's intent
        // ("invalidate these credentials") is honored even if the remote
        // failed. The returned flag lets the caller log / retry.
        serverRevoked = false;
      }
    }
    const localDeleted = await this.config.store.delete(this.config.provider.id, account);
    return { localDeleted, serverRevoked };
  }

  isFresh(tokens: OAuth2TokenSet): boolean {
    const now = Math.floor(Date.now() / 1000);
    return tokens.expiresAt > now + this.expirySkewSec;
  }

  // ─────────────────────────────────────────────────────────────────────────

  private async postRevocation(endpoint: string, token: string, hint: string): Promise<void> {
    const body = new URLSearchParams({
      token,
      token_type_hint: hint,
      client_id: this.config.clientId,
    });
    if (this.config.clientSecret) body.set('client_secret', this.config.clientSecret);
    const resp = await this.fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
    });
    if (!resp.ok && resp.status !== 200) {
      const text = await resp.text().catch(() => '');
      throw new Error(`OAuth2 revocation failed (${resp.status}): ${text.slice(0, 200)}`);
    }
  }

  private async refresh(refreshToken: string): Promise<OAuth2TokenSet> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
    });
    if (this.config.clientSecret) body.set('client_secret', this.config.clientSecret);
    return this.exchange(body);
  }

  private async exchange(body: URLSearchParams): Promise<OAuth2TokenSet> {
    const resp = await this.fetch(this.config.provider.tokenEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OAuth2 token exchange failed (${resp.status}): ${text.slice(0, 200)}`);
    }
    const json = (await resp.json()) as Record<string, unknown>;
    return normalizeTokens(this.config.provider.id, json);
  }
}

function normalizeTokens(providerId: string, raw: Record<string, unknown>): OAuth2TokenSet {
  const accessToken = String(raw['access_token'] ?? '');
  if (!accessToken) throw new Error('OAuth2: response missing access_token');
  const expiresIn = Number(raw['expires_in'] ?? 0);
  const expiresAt = Math.floor(Date.now() / 1000) + (expiresIn || 3600);
  const known = new Set([
    'access_token',
    'refresh_token',
    'expires_in',
    'scope',
    'token_type',
  ]);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (!known.has(k)) extra[k] = v;

  const out: OAuth2TokenSet = {
    providerId,
    accessToken,
    expiresAt,
    tokenType: String(raw['token_type'] ?? 'Bearer'),
  };
  if (raw['refresh_token'] !== undefined) out.refreshToken = String(raw['refresh_token']);
  if (raw['scope'] !== undefined) out.scope = String(raw['scope']);
  if (Object.keys(extra).length > 0) out.extra = extra;
  return out;
}

function base64urlRandom(bytes: number): string {
  return randomBytes(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
