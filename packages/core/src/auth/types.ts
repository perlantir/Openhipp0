/**
 * OAuth2 types.
 *
 * We implement authorization-code with PKCE (RFC 7636) + refresh tokens.
 * Client-credentials and device-code flows are NOT covered here — add them
 * when a provider demands them.
 */

import { z } from 'zod';

export interface OAuth2Provider {
  /** Machine-readable id: 'google', 'github', 'linear', ... */
  readonly id: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  /** RFC 7009 revocation endpoint. Optional — providers that lack one skip server-side revocation. */
  readonly revocationEndpoint?: string;
  /** Default scopes requested if the caller doesn't pass any. */
  readonly defaultScopes?: readonly string[];
  /** Extra query params on the authorize URL (prompt=consent, access_type=offline). */
  readonly authorizeExtraParams?: Record<string, string>;
  /** Providers that issue refresh tokens only on first consent (Google) should set this. */
  readonly requiresOfflineConsent?: boolean;
}

export interface OAuth2TokenSet {
  providerId: string;
  accessToken: string;
  refreshToken?: string;
  /** Seconds since epoch when accessToken expires. */
  expiresAt: number;
  scope?: string;
  tokenType: string;
  /** Non-standard provider payload (e.g. id_token) — preserved verbatim. */
  extra?: Record<string, unknown>;
}

export const OAuth2TokenSetSchema: z.ZodType<OAuth2TokenSet> = z.object({
  providerId: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  expiresAt: z.number(),
  scope: z.string().optional(),
  tokenType: z.string(),
  extra: z.record(z.unknown()).optional(),
});

/**
 * Pluggable token storage. Default implementation writes JSON to
 * ~/.hipp0/auth/<providerId>.json with 0o600 perms; tests inject an
 * in-memory implementation.
 */
export interface TokenStore {
  get(providerId: string, account: string): Promise<OAuth2TokenSet | null>;
  set(providerId: string, account: string, tokens: OAuth2TokenSet): Promise<void>;
  delete(providerId: string, account: string): Promise<boolean>;
  list(): Promise<Array<{ providerId: string; account: string }>>;
}

/**
 * HTTP seam for the OAuth2 client so tests don't hit the network. The
 * default implementation uses the global `fetch`.
 */
export type OAuth2Fetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;
