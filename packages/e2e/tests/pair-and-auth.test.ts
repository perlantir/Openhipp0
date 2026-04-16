/**
 * Full-flow e2e: pair a "mobile" device → server issues bearer → call
 * /api/audit with that bearer → route enforces auth.
 *
 * This exercises the integration seam between the Phase-19 pairing flow
 * and the Retro-A1 auth middleware: a paired device's apiBearer, when
 * registered as the server's static token, lets /api/* routes return
 * 200s; other tokens fail with 401.
 *
 * We drive the stores directly rather than spinning a full HTTP server —
 * that's cheaper and exercises exactly the handler contract.
 */

import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  pairing as corePairing,
} from '@openhipp0/core';
import { db as memoryDb, createApiRoutes } from '@openhipp0/memory';
import { buildApiAuth, buildPairingRoutes } from '@openhipp0/cli';

const {
  SqlitePairingSessionStore,
  SqlitePairedDeviceStore,
  generateKeyPair,
  issuePairing,
  redeemPairing,
} = corePairing;

describe('pair → auth → /api/audit end-to-end', () => {
  it('a paired device can authenticate and hit a REST route', async () => {
    // ── server setup ─────────────────────────────────────────────────────
    const db = new Database(':memory:');
    const sessionStore = new SqlitePairingSessionStore(db);
    const deviceStore = new SqlitePairedDeviceStore(db);

    // ── step 1: dashboard issues a pairing QR ────────────────────────────
    const qr = await issuePairing(
      {
        serverId: 'srv-test',
        serverUrl: 'http://127.0.0.1:3100',
        connectionMethod: 'lan',
      },
      sessionStore,
    );
    expect(qr.pairingToken).toBeTruthy();

    // ── step 2: mobile generates keys + redeems token ────────────────────
    const mobileKeys = generateKeyPair();
    const { response, device } = await redeemPairing(
      {
        pairingToken: qr.pairingToken,
        mobilePublicKey: mobileKeys.publicKey,
        deviceName: 'test-iphone',
        platform: 'ios',
      },
      sessionStore,
      deviceStore,
    );
    expect(response.deviceId).toBeTruthy();
    expect(device.apiBearer).toBeTruthy();

    // ── step 3: server registers the device's apiBearer as a static token.
    // In a real deployment you'd wire this differently, but the contract is
    // "a successfully paired device has a valid Bearer credential."
    const auth = buildApiAuth({ staticToken: device.apiBearer });

    // ── step 4: paired device calls a route with its bearer ──────────────
    const hippoDb = memoryDb.createClient({ databaseUrl: ':memory:' });
    await memoryDb.runMigrations(hippoDb);
    const memoryRoutes = createApiRoutes({ db: hippoDb });
    // Wrap the audit route with the new auth middleware.
    const auditBase = memoryRoutes.find((r) => r.path === '/api/audit');
    if (!auditBase) throw new Error('audit route missing — verify Retro-C wiring');
    const auditHandler = auth(auditBase.handler as Parameters<typeof auth>[0]);

    // Valid bearer → 200
    const ok = await auditHandler({
      req: { headers: { authorization: `Bearer ${device.apiBearer}` } },
      params: {},
      query: {},
      body: undefined,
    });
    expect(ok.status ?? 200).toBe(200);
    expect((ok.body as { events: unknown[] }).events).toEqual([]);

    // Wrong bearer → 401
    const bad = await auditHandler({
      req: { headers: { authorization: 'Bearer attacker-guess' } },
      params: {},
      query: {},
      body: undefined,
    });
    expect(bad.status).toBe(401);

    // Missing bearer → 401
    const missing = await auditHandler({
      req: { headers: {} },
      params: {},
      query: {},
      body: undefined,
    });
    expect(missing.status).toBe(401);
  });

  it('an expired pairing token is rejected at /api/pairing/complete', async () => {
    const db = new Database(':memory:');
    const sessionStore = new SqlitePairingSessionStore(db);
    const deviceStore = new SqlitePairedDeviceStore(db);
    const auth = buildApiAuth({});

    // Hand-craft an expired session so we don't need to wait.
    const past = Date.now() - 1000;
    await sessionStore.put({
      pairingToken: 'expired-token',
      serverId: 's',
      serverUrl: 'http://localhost',
      connectionMethod: 'lan',
      serverPublicKey: 'pub',
      serverSecretKey: 'sec',
      expiresAt: past,
      consumed: false,
    });

    const [, complete] = buildPairingRoutes(auth, {
      sessionStore,
      deviceStore,
      serverUrl: 'http://localhost',
      serverId: 's',
    });

    const res = await complete!.handler({
      req: {},
      params: {},
      query: {},
      body: {
        pairingToken: 'expired-token',
        mobilePublicKey: generateKeyPair().publicKey,
      },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain('Expired');
  });

  it('a one-shot pairing token cannot be redeemed twice', async () => {
    const db = new Database(':memory:');
    const sessionStore = new SqlitePairingSessionStore(db);
    const deviceStore = new SqlitePairedDeviceStore(db);
    const auth = buildApiAuth({});

    const qr = await issuePairing(
      {
        serverId: 's',
        serverUrl: 'http://localhost',
        connectionMethod: 'lan',
      },
      sessionStore,
    );

    const mobileKeys = generateKeyPair();
    await redeemPairing(
      { pairingToken: qr.pairingToken, mobilePublicKey: mobileKeys.publicKey },
      sessionStore,
      deviceStore,
    );

    const [, complete] = buildPairingRoutes(auth, {
      sessionStore,
      deviceStore,
      serverUrl: 'http://localhost',
      serverId: 's',
    });
    const res = await complete!.handler({
      req: {},
      params: {},
      query: {},
      body: {
        pairingToken: qr.pairingToken,
        mobilePublicKey: generateKeyPair().publicKey,
      },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain('AlreadyUsed');
  });
});
