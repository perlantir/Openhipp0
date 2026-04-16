import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { buildPairingRoutes } from '../../src/commands/pairing-routes.js';
import { buildApiAuth } from '../../src/commands/api-auth.js';
import { pairing } from '@openhipp0/core';
const { SqlitePairingSessionStore, SqlitePairedDeviceStore, generateKeyPair } = pairing;

const openAuth = buildApiAuth({});
const secretAuth = buildApiAuth({ staticToken: 'secret' });

function ctx(extra: Record<string, unknown> = {}) {
  return {
    req: { headers: {}, ...(extra.req as object | undefined) },
    params: (extra.params as Record<string, string>) ?? {},
    query: (extra.query as Record<string, string>) ?? {},
    body: extra.body,
  };
}

function deps() {
  const db = new Database(':memory:');
  return {
    sessionStore: new SqlitePairingSessionStore(db),
    deviceStore: new SqlitePairedDeviceStore(db),
    serverUrl: 'http://localhost:3100',
    serverId: 'srv-test',
    db,
  };
}

describe('POST /api/pairing/issue', () => {
  it('returns a QR payload and persists the session', async () => {
    const d = deps();
    const [issue] = buildPairingRoutes(openAuth, d);
    const res = await issue!.handler(ctx({ body: { connectionMethod: 'lan' } }));
    const body = res.body as { pairingToken: string; serverPublicKey: string; expiresAt: number };
    expect(body.pairingToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(body.serverPublicKey.length).toBeGreaterThan(0);
    expect(body.expiresAt).toBeGreaterThan(Date.now());

    const persisted = await d.sessionStore.get(body.pairingToken);
    expect(persisted?.consumed).toBe(false);
  });

  it('requires auth when configured', async () => {
    const d = deps();
    const [issue] = buildPairingRoutes(secretAuth, d);
    const res = await issue!.handler(ctx());
    expect(res.status).toBe(401);
  });
});

describe('POST /api/pairing/complete', () => {
  it('is unauthenticated (the token is the credential)', async () => {
    const d = deps();
    const [issue, complete] = buildPairingRoutes(secretAuth, d);
    const issued = await issue!.handler({
      req: { headers: { authorization: 'Bearer secret' } },
      params: {},
      query: {},
      body: { connectionMethod: 'lan' },
    });
    const { pairingToken } = issued.body as { pairingToken: string };
    const mobileKeys = generateKeyPair();

    // No authorization header — should still succeed.
    const res = await complete!.handler(
      ctx({
        body: {
          pairingToken,
          mobilePublicKey: mobileKeys.publicKey,
          deviceName: 'test-phone',
          platform: 'ios',
        },
      }),
    );
    const body = res.body as { deviceId: string; serverPublicKey: string };
    expect(body.deviceId).toBeTruthy();
    expect(body.serverPublicKey).toBeTruthy();

    // Device now persists.
    const got = await d.deviceStore.getById(body.deviceId);
    expect(got?.deviceName).toBe('test-phone');
  });

  it('400s on unknown / expired / already-used tokens', async () => {
    const d = deps();
    const [, complete] = buildPairingRoutes(openAuth, d);
    const res = await complete!.handler(
      ctx({
        body: {
          pairingToken: 'does-not-exist',
          mobilePublicKey: generateKeyPair().publicKey,
        },
      }),
    );
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain('Unknown');
  });
});

describe('GET /api/pairing/devices', () => {
  it('lists paired devices without leaking server secret keys', async () => {
    const d = deps();
    await d.deviceStore.put({
      deviceId: 'dev-1',
      serverId: 'srv-test',
      mobilePublicKey: 'mobpub',
      serverPublicKey: 'srvpub',
      serverSecretKey: 'SHOULD-NOT-APPEAR',
      deviceName: 'Alex phone',
      platform: 'ios',
      pairedAt: '2026-04-16T12:00:00Z',
      apiBearer: 'secret-bearer',
    });

    const [, , list] = buildPairingRoutes(openAuth, d);
    const res = await list!.handler(ctx());
    const body = res.body as { devices: Array<Record<string, unknown>> };
    expect(body.devices).toHaveLength(1);
    expect(body.devices[0]).not.toHaveProperty('serverSecretKey');
    expect(body.devices[0]).not.toHaveProperty('apiBearer');
    expect(body.devices[0]?.deviceName).toBe('Alex phone');
  });
});

describe('DELETE /api/pairing/devices/:deviceId', () => {
  it('removes the paired device and returns 204', async () => {
    const d = deps();
    await d.deviceStore.put({
      deviceId: 'rm-me',
      serverId: 'srv-test',
      mobilePublicKey: 'm',
      serverPublicKey: 'sp',
      serverSecretKey: 'ss',
      pairedAt: '2026-04-16T12:00:00Z',
      apiBearer: 'ab',
    });
    const [, , , remove] = buildPairingRoutes(openAuth, d);
    const res = await remove!.handler({ req: {}, params: { deviceId: 'rm-me' }, query: {}, body: undefined });
    expect(res.status).toBe(204);
    expect(await d.deviceStore.getById('rm-me')).toBeUndefined();
  });

  it('400 when deviceId is missing', async () => {
    const d = deps();
    const [, , , remove] = buildPairingRoutes(openAuth, d);
    const res = await remove!.handler({ req: {}, params: {}, query: {}, body: undefined });
    expect(res.status).toBe(400);
  });
});
