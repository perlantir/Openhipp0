import { describe, it, expect } from 'vitest';
import {
  buildOidcAuthorizeUrl,
  consumeOidcIdToken,
  consumeSamlResponse,
  jitProvision,
  type JitUserStore,
  type OidcProvider,
  type OidcTokenClaims,
  type SamlProvider,
} from '../../src/enterprise/sso.js';

const oidc: OidcProvider = {
  id: 'google',
  protocol: 'oidc',
  displayName: 'Google',
  issuer: 'https://accounts.google.com',
  clientId: 'client-xyz',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
};

describe('OIDC', () => {
  it('buildOidcAuthorizeUrl sets all required params', () => {
    const url = buildOidcAuthorizeUrl(oidc, 'https://app/cb', 'state1', 'nonce1');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_id')).toBe('client-xyz');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app/cb');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe('openid email profile');
    expect(parsed.searchParams.get('state')).toBe('state1');
    expect(parsed.searchParams.get('nonce')).toBe('nonce1');
  });

  it('consumeOidcIdToken validates iss/aud/exp/nonce', async () => {
    const claims: OidcTokenClaims = {
      sub: 'user-1',
      email: 'x@y.z',
      iss: 'https://accounts.google.com',
      aud: 'client-xyz',
      exp: Math.floor(Date.now() / 1000) + 600,
      nonce: 'nonce1',
    };
    const r = await consumeOidcIdToken('ignored', oidc, 'nonce1', async () => claims);
    expect(r.subject).toBe('user-1');
    expect(r.email).toBe('x@y.z');
  });

  it('rejects audience mismatch', async () => {
    const claims: OidcTokenClaims = {
      sub: 'u',
      iss: oidc.issuer,
      aud: 'other-client',
      exp: Math.floor(Date.now() / 1000) + 600,
    };
    await expect(consumeOidcIdToken('t', oidc, 'n', async () => claims)).rejects.toThrow(/audience/);
  });

  it('rejects expired token', async () => {
    const claims: OidcTokenClaims = {
      sub: 'u',
      iss: oidc.issuer,
      aud: oidc.clientId,
      exp: Math.floor(Date.now() / 1000) - 10,
    };
    await expect(consumeOidcIdToken('t', oidc, 'n', async () => claims)).rejects.toThrow(/expired/);
  });
});

describe('SAML', () => {
  const saml: SamlProvider = {
    id: 'okta',
    protocol: 'saml',
    displayName: 'Okta',
    entryPoint: 'https://idp.okta/sso',
    issuer: 'hipp0-app',
    idpCert: '-----BEGIN CERTIFICATE-----\nMII...',
    attributeMap: { email: 'email', name: 'fullName', groups: 'memberOf' },
  };

  it('consumeSamlResponse maps attributes via attributeMap', async () => {
    const verified = {
      nameId: 'user@acme.com',
      claims: {
        subject: 'user@acme.com',
        attributes: {
          email: 'user@acme.com',
          fullName: 'User Name',
          memberOf: 'engineers,admins',
        },
      },
    };
    const r = await consumeSamlResponse(saml, 'base64response', async () => verified);
    expect(r.email).toBe('user@acme.com');
    expect(r.name).toBe('User Name');
    expect(r.groups).toEqual(['engineers', 'admins']);
  });
});

describe('jitProvision', () => {
  function fakeStore(initial: Array<{ id: string; externalProvider: string; externalId: string }> = []): JitUserStore & {
    users: Array<{ id: string; externalProvider: string; externalId: string }>;
    lastLogins: Map<string, Date>;
    groupSync: Array<{ userId: string; groups: readonly string[] }>;
  } {
    const users = [...initial];
    const lastLogins = new Map<string, Date>();
    const groupSync: Array<{ userId: string; groups: readonly string[] }> = [];
    return {
      users,
      lastLogins,
      groupSync,
      async findByExternalId(provider, id) {
        const u = users.find((x) => x.externalProvider === provider && x.externalId === id);
        return u ? { id: u.id } : null;
      },
      async createUser(input) {
        const u = { id: `u${users.length + 1}`, externalProvider: input.externalProvider, externalId: input.externalId };
        users.push(u);
        return { id: u.id };
      },
      async updateLastLogin(id, at) {
        lastLogins.set(id, at);
      },
      async syncGroupMemberships(userId, groups) {
        groupSync.push({ userId, groups });
      },
    };
  }

  it('creates a new user when not found', async () => {
    const store = fakeStore();
    const r = await jitProvision(oidc, { subject: 'new-sub', email: 'n@a.b' }, store);
    expect(r.created).toBe(true);
    expect(store.users).toHaveLength(1);
    expect(store.lastLogins.size).toBe(1);
  });

  it('updates last login for an existing user and syncs groups', async () => {
    const store = fakeStore([{ id: 'u1', externalProvider: oidc.id, externalId: 'existing' }]);
    const r = await jitProvision(
      oidc,
      { subject: 'existing', groups: ['engineers'] },
      store,
    );
    expect(r.created).toBe(false);
    expect(r.userId).toBe('u1');
    expect(store.groupSync[0]).toEqual({ userId: 'u1', groups: ['engineers'] });
  });
});
