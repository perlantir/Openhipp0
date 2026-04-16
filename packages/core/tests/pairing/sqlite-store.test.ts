import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  SqlitePairingSessionStore,
  SqlitePairedDeviceStore,
  type PairedDevice,
  type PairingSession,
} from '../../src/pairing/index.js';

function sampleSession(overrides: Partial<PairingSession> = {}): PairingSession {
  return {
    pairingToken: 'tok-1',
    serverId: 'srv-1',
    serverUrl: 'http://localhost:3100',
    connectionMethod: 'lan',
    serverPublicKey: 'pubkey-b64',
    serverSecretKey: 'seckey-b64',
    expiresAt: Date.now() + 60_000,
    consumed: false,
    ...overrides,
  };
}

function sampleDevice(overrides: Partial<PairedDevice> = {}): PairedDevice {
  return {
    deviceId: 'dev-1',
    serverId: 'srv-1',
    mobilePublicKey: 'mobile-pub',
    serverPublicKey: 'srv-pub',
    serverSecretKey: 'srv-sec',
    pairedAt: '2026-04-16T12:00:00Z',
    apiBearer: 'bearer-xxx',
    ...overrides,
  };
}

describe('SqlitePairingSessionStore', () => {
  let db: Database.Database;
  let store: SqlitePairingSessionStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new SqlitePairingSessionStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('round-trips a session', async () => {
    const s = sampleSession();
    await store.put(s);
    const got = await store.get(s.pairingToken);
    expect(got).toEqual(s);
  });

  it('returns undefined for unknown token', async () => {
    expect(await store.get('does-not-exist')).toBeUndefined();
  });

  it('markConsumed flips the flag', async () => {
    const s = sampleSession();
    await store.put(s);
    await store.markConsumed(s.pairingToken);
    const got = await store.get(s.pairingToken);
    expect(got?.consumed).toBe(true);
  });

  it('purgeExpired deletes entries with expiresAt < now', async () => {
    await store.put(sampleSession({ pairingToken: 'old', expiresAt: 1000 }));
    await store.put(sampleSession({ pairingToken: 'new', expiresAt: Date.now() + 60_000 }));
    await store.purgeExpired(5000);
    expect(await store.get('old')).toBeUndefined();
    expect(await store.get('new')).toBeDefined();
  });

  it('survives a fresh store instance on the same DB file', async () => {
    // better-sqlite3 `:memory:` is per-connection; use a file on tmpfs instead.
    db.close();
    const tmp = `/tmp/pair-test-${Date.now()}-${Math.random()}.db`;
    const d1 = new Database(tmp);
    const s1 = new SqlitePairingSessionStore(d1);
    await s1.put(sampleSession({ pairingToken: 'persistent' }));
    d1.close();
    const d2 = new Database(tmp);
    const s2 = new SqlitePairingSessionStore(d2);
    const got = await s2.get('persistent');
    expect(got?.pairingToken).toBe('persistent');
    d2.close();
  });
});

describe('SqlitePairedDeviceStore', () => {
  let db: Database.Database;
  let store: SqlitePairedDeviceStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new SqlitePairedDeviceStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('round-trips a device', async () => {
    const d = sampleDevice();
    await store.put(d);
    expect(await store.getById(d.deviceId)).toEqual(d);
  });

  it('put with deviceName + platform persists both', async () => {
    const d = sampleDevice({ deviceName: "Alex's iPhone", platform: 'ios' });
    await store.put(d);
    const got = await store.getById(d.deviceId);
    expect(got?.deviceName).toBe("Alex's iPhone");
    expect(got?.platform).toBe('ios');
  });

  it('list returns rows newest-first', async () => {
    await store.put(sampleDevice({ deviceId: 'd1', pairedAt: '2026-04-15T00:00:00Z' }));
    await store.put(sampleDevice({ deviceId: 'd2', pairedAt: '2026-04-16T00:00:00Z' }));
    const list = await store.list();
    expect(list.map((d) => d.deviceId)).toEqual(['d2', 'd1']);
  });

  it('remove drops the device', async () => {
    await store.put(sampleDevice());
    await store.remove('dev-1');
    expect(await store.getById('dev-1')).toBeUndefined();
  });
});
