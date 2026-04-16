/**
 * SSO primitives — SAML 2.0 + OIDC, JIT user provisioning.
 *
 * We wrap the minimal pieces that every enterprise IdP requires: generating
 * the AuthN / authorize URL, validating the response (SAML XML or OIDC
 * id_token), and mapping the claims into our own user record. Full SAML
 * signature validation lives behind the `verifySaml` callback — production
 * passes a samlify/node-saml adapter, tests supply an always-pass fn.
 */

import crypto from 'node:crypto';

export type SsoProtocol = 'saml' | 'oidc';

export interface SsoUserClaims {
  subject: string;
  email?: string;
  name?: string;
  groups?: readonly string[];
  /** Extra attributes from the IdP (assertion attributes / id_token claims). */
  attributes?: Record<string, string | number | boolean>;
}

export interface SsoProvider {
  readonly id: string;
  readonly protocol: SsoProtocol;
  readonly displayName: string;
}

export interface SamlProvider extends SsoProvider {
  protocol: 'saml';
  entryPoint: string; // IdP SSO URL
  issuer: string; // our SP entity id
  idpCert: string; // IdP cert (PEM, single cert for now)
  attributeMap?: {
    subject?: string;
    email?: string;
    name?: string;
    groups?: string;
  };
}

export interface OidcProvider extends SsoProvider {
  protocol: 'oidc';
  issuer: string;
  clientId: string;
  authorizeUrl: string; // cached from discovery
  tokenUrl: string;
  jwksUri: string;
  scope?: string; // default 'openid email profile'
}

export type AnySsoProvider = SamlProvider | OidcProvider;

// ─── SAML flow ────────────────────────────────────────────────────────────

export function buildSamlRedirect(provider: SamlProvider, relayState: string): {
  url: string;
  requestId: string;
} {
  const requestId = `_${crypto.randomBytes(16).toString('hex')}`;
  // We don't ship a full AuthN request builder here — that's what the
  // samlify adapter does in production. The caller uses this function to
  // construct the redirect URL with the generated request id + RelayState.
  const url = new URL(provider.entryPoint);
  url.searchParams.set('SAMLRequest', requestId);
  url.searchParams.set('RelayState', relayState);
  return { url: url.toString(), requestId };
}

export interface VerifiedSamlResponse {
  claims: SsoUserClaims;
  sessionIndex?: string;
  nameId: string;
}

export type SamlVerifier = (
  provider: SamlProvider,
  samlResponseB64: string,
) => Promise<VerifiedSamlResponse>;

export async function consumeSamlResponse(
  provider: SamlProvider,
  samlResponseB64: string,
  verify: SamlVerifier,
): Promise<SsoUserClaims> {
  const result = await verify(provider, samlResponseB64);
  return applyAttributeMap(result.claims, provider.attributeMap);
}

function applyAttributeMap(
  claims: SsoUserClaims,
  map: SamlProvider['attributeMap'] | undefined,
): SsoUserClaims {
  if (!map || !claims.attributes) return claims;
  const out: SsoUserClaims = { subject: claims.subject };
  if (map.subject && claims.attributes[map.subject]) {
    out.subject = String(claims.attributes[map.subject]);
  }
  if (map.email && claims.attributes[map.email]) {
    out.email = String(claims.attributes[map.email]);
  } else if (claims.email) {
    out.email = claims.email;
  }
  if (map.name && claims.attributes[map.name]) {
    out.name = String(claims.attributes[map.name]);
  } else if (claims.name) {
    out.name = claims.name;
  }
  if (map.groups && claims.attributes[map.groups]) {
    const raw = claims.attributes[map.groups];
    if (typeof raw === 'string') out.groups = raw.split(/[,;]\s*/).filter(Boolean);
  } else if (claims.groups) {
    out.groups = claims.groups;
  }
  return out;
}

// ─── OIDC flow ────────────────────────────────────────────────────────────

export function buildOidcAuthorizeUrl(
  provider: OidcProvider,
  redirectUri: string,
  state: string,
  nonce: string,
): string {
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', provider.scope ?? 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  return url.toString();
}

export interface OidcTokenClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  groups?: string[];
  iss: string;
  aud: string | string[];
  exp: number;
  nonce?: string;
  [key: string]: unknown;
}

export interface OidcIdTokenVerifier {
  (idToken: string, provider: OidcProvider, nonce: string): Promise<OidcTokenClaims>;
}

export async function consumeOidcIdToken(
  idToken: string,
  provider: OidcProvider,
  nonce: string,
  verify: OidcIdTokenVerifier,
): Promise<SsoUserClaims> {
  const claims = await verify(idToken, provider, nonce);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(provider.clientId)) {
    throw new Error(`OIDC audience mismatch: expected ${provider.clientId}`);
  }
  if (claims.iss !== provider.issuer) {
    throw new Error(`OIDC issuer mismatch: expected ${provider.issuer}, got ${claims.iss}`);
  }
  if (claims.exp * 1000 < Date.now()) {
    throw new Error('OIDC id_token expired');
  }
  if (claims.nonce !== undefined && claims.nonce !== nonce) {
    throw new Error('OIDC nonce mismatch');
  }
  return {
    subject: claims.sub,
    ...(claims.email !== undefined && { email: claims.email }),
    ...(claims.name !== undefined
      ? { name: claims.name }
      : claims.preferred_username !== undefined
        ? { name: claims.preferred_username }
        : {}),
    ...(claims.groups !== undefined && { groups: claims.groups }),
  };
}

// ─── JIT provisioning ─────────────────────────────────────────────────────

export interface JitUserStore {
  findByExternalId(provider: string, externalId: string): Promise<{ id: string } | null>;
  createUser(input: {
    externalProvider: string;
    externalId: string;
    email?: string;
    name?: string;
  }): Promise<{ id: string }>;
  updateLastLogin(userId: string, at: Date): Promise<void>;
  syncGroupMemberships?(userId: string, groups: readonly string[]): Promise<void>;
}

export async function jitProvision(
  provider: AnySsoProvider,
  claims: SsoUserClaims,
  store: JitUserStore,
  now: Date = new Date(),
): Promise<{ userId: string; created: boolean }> {
  const existing = await store.findByExternalId(provider.id, claims.subject);
  if (existing) {
    await store.updateLastLogin(existing.id, now);
    if (claims.groups && store.syncGroupMemberships) {
      await store.syncGroupMemberships(existing.id, claims.groups);
    }
    return { userId: existing.id, created: false };
  }
  const created = await store.createUser({
    externalProvider: provider.id,
    externalId: claims.subject,
    ...(claims.email !== undefined && { email: claims.email }),
    ...(claims.name !== undefined && { name: claims.name }),
  });
  await store.updateLastLogin(created.id, now);
  if (claims.groups && store.syncGroupMemberships) {
    await store.syncGroupMemberships(created.id, claims.groups);
  }
  return { userId: created.id, created: true };
}
