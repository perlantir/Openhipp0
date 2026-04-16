/**
 * SQLite-backed stores for pairing sessions + paired devices.
 *
 * These swap out the in-memory defaults so pending pairings and device
 * registrations survive a server restart. Tables are created idempotently
 * on first use — no Drizzle migration is generated because the pairing
 * data never participates in multi-tenant queries.
 *
 * The store accepts anything that looks like a `better-sqlite3` Database:
 * `.prepare(sql).run|get|all` + `.exec(sql)`. We don't import the package
 * directly so `@openhipp0/core` doesn't take a hard dependency on it.
 */

import type {
  PairedDevice,
  PairingSession,
} from './types.js';
import type {
  PairedDeviceStore,
  PairingSessionStore,
} from './token.js';

// Minimal structural type — avoids pulling better-sqlite3 into core.
export interface BetterSqliteLike {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  exec(sql: string): unknown;
}

const SESSION_DDL = `
CREATE TABLE IF NOT EXISTS pairing_sessions (
  pairing_token       TEXT PRIMARY KEY,
  server_id           TEXT NOT NULL,
  server_url          TEXT NOT NULL,
  connection_method   TEXT NOT NULL,
  server_public_key   TEXT NOT NULL,
  server_secret_key   TEXT NOT NULL,
  expires_at          INTEGER NOT NULL,
  consumed            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pairing_sessions_expires ON pairing_sessions(expires_at);
`;

const DEVICE_DDL = `
CREATE TABLE IF NOT EXISTS paired_devices (
  device_id           TEXT PRIMARY KEY,
  server_id           TEXT NOT NULL,
  mobile_public_key   TEXT NOT NULL,
  server_public_key   TEXT NOT NULL,
  server_secret_key   TEXT NOT NULL,
  device_name         TEXT,
  platform            TEXT,
  paired_at           TEXT NOT NULL,
  api_bearer          TEXT NOT NULL
);
`;

interface SessionRow {
  pairing_token: string;
  server_id: string;
  server_url: string;
  connection_method: string;
  server_public_key: string;
  server_secret_key: string;
  expires_at: number;
  consumed: number;
}

interface DeviceRow {
  device_id: string;
  server_id: string;
  mobile_public_key: string;
  server_public_key: string;
  server_secret_key: string;
  device_name: string | null;
  platform: string | null;
  paired_at: string;
  api_bearer: string;
}

function sessionFromRow(r: SessionRow): PairingSession {
  return {
    pairingToken: r.pairing_token,
    serverId: r.server_id,
    serverUrl: r.server_url,
    connectionMethod: r.connection_method as PairingSession['connectionMethod'],
    serverPublicKey: r.server_public_key,
    serverSecretKey: r.server_secret_key,
    expiresAt: r.expires_at,
    consumed: r.consumed === 1,
  };
}

function deviceFromRow(r: DeviceRow): PairedDevice {
  const base: PairedDevice = {
    deviceId: r.device_id,
    serverId: r.server_id,
    mobilePublicKey: r.mobile_public_key,
    serverPublicKey: r.server_public_key,
    serverSecretKey: r.server_secret_key,
    pairedAt: r.paired_at,
    apiBearer: r.api_bearer,
  };
  if (r.device_name !== null) base.deviceName = r.device_name;
  if (r.platform !== null) base.platform = r.platform as PairedDevice['platform'];
  return base;
}

export class SqlitePairingSessionStore implements PairingSessionStore {
  private readonly db: BetterSqliteLike;

  constructor(db: BetterSqliteLike) {
    this.db = db;
    this.db.exec(SESSION_DDL);
  }

  async put(session: PairingSession): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO pairing_sessions
           (pairing_token, server_id, server_url, connection_method,
            server_public_key, server_secret_key, expires_at, consumed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.pairingToken,
        session.serverId,
        session.serverUrl,
        session.connectionMethod,
        session.serverPublicKey,
        session.serverSecretKey,
        session.expiresAt,
        session.consumed ? 1 : 0,
      );
  }

  async get(token: string): Promise<PairingSession | undefined> {
    const row = this.db
      .prepare(`SELECT * FROM pairing_sessions WHERE pairing_token = ?`)
      .get(token) as SessionRow | undefined;
    return row ? sessionFromRow(row) : undefined;
  }

  async markConsumed(token: string): Promise<void> {
    this.db
      .prepare(`UPDATE pairing_sessions SET consumed = 1 WHERE pairing_token = ?`)
      .run(token);
  }

  async purgeExpired(nowMs: number): Promise<void> {
    this.db.prepare(`DELETE FROM pairing_sessions WHERE expires_at < ?`).run(nowMs);
  }
}

export class SqlitePairedDeviceStore implements PairedDeviceStore {
  private readonly db: BetterSqliteLike;

  constructor(db: BetterSqliteLike) {
    this.db = db;
    this.db.exec(DEVICE_DDL);
  }

  async put(device: PairedDevice): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO paired_devices
           (device_id, server_id, mobile_public_key, server_public_key,
            server_secret_key, device_name, platform, paired_at, api_bearer)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        device.deviceId,
        device.serverId,
        device.mobilePublicKey,
        device.serverPublicKey,
        device.serverSecretKey,
        device.deviceName ?? null,
        device.platform ?? null,
        device.pairedAt,
        device.apiBearer,
      );
  }

  async getById(deviceId: string): Promise<PairedDevice | undefined> {
    const row = this.db
      .prepare(`SELECT * FROM paired_devices WHERE device_id = ?`)
      .get(deviceId) as DeviceRow | undefined;
    return row ? deviceFromRow(row) : undefined;
  }

  async list(): Promise<readonly PairedDevice[]> {
    const rows = this.db.prepare(`SELECT * FROM paired_devices ORDER BY paired_at DESC`).all() as DeviceRow[];
    return rows.map(deviceFromRow);
  }

  async remove(deviceId: string): Promise<void> {
    this.db.prepare(`DELETE FROM paired_devices WHERE device_id = ?`).run(deviceId);
  }
}
