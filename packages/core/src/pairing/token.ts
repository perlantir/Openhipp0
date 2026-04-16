/**
 * Pairing token + session lifecycle (Phase 19).
 *
 * Server-side flow:
 *   1. Dashboard calls `issuePairing()` → returns a QR payload + holds a
 *      matching `PairingSession` in a `PairingSessionStore`.
 *   2. Mobile scans, POSTs its public key with the token.
 *   3. Server `redeemPairing()` — validates token, flips the session to
 *      consumed, seals a confirmation envelope for the mobile, returns it.
 *
 * Tokens are single-shot. Default TTL 10 min; hard cap 60 min. Expired /
 * unknown / re-used tokens all raise distinct error types so UI can respond
 * specifically.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import nacl from 'tweetnacl';
import { generateKeyPair, sealEnvelopeJson } from './key-exchange.js';
import {
  Hipp0PairingTokenAlreadyUsedError,
  Hipp0PairingTokenExpiredError,
  Hipp0PairingTokenUnknownError,
  PairingCompleteRequestSchema,
  type IssuePairingOptions,
  type PairedDevice,
  type PairingCompleteRequest,
  type PairingCompleteResponse,
  type PairingConfirmationPayload,
  type PairingQrPayload,
  type PairingSession,
} from './types.js';

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_TTL_MS = 60 * 60 * 1000;

/** Storage abstraction for pending pairing sessions. In-memory is the default. */
export interface PairingSessionStore {
  put(session: PairingSession): Promise<void>;
  get(token: string): Promise<PairingSession | undefined>;
  markConsumed(token: string): Promise<void>;
  /** Remove every session whose expiresAt < nowMs. */
  purgeExpired(nowMs: number): Promise<void>;
}

/** Storage abstraction for completed device pairings. */
export interface PairedDeviceStore {
  put(device: PairedDevice): Promise<void>;
  getById(deviceId: string): Promise<PairedDevice | undefined>;
  list(): Promise<readonly PairedDevice[]>;
  remove(deviceId: string): Promise<void>;
}

/** Default in-memory session store. Swap for a SQLite-backed impl in production. */
export class MemoryPairingSessionStore implements PairingSessionStore {
  private readonly sessions = new Map<string, PairingSession>();
  async put(session: PairingSession): Promise<void> {
    this.sessions.set(session.pairingToken, session);
  }
  async get(token: string): Promise<PairingSession | undefined> {
    return this.sessions.get(token);
  }
  async markConsumed(token: string): Promise<void> {
    const existing = this.sessions.get(token);
    if (existing) this.sessions.set(token, { ...existing, consumed: true });
  }
  async purgeExpired(nowMs: number): Promise<void> {
    for (const [k, v] of this.sessions) {
      if (v.expiresAt < nowMs) this.sessions.delete(k);
    }
  }
}

/** Default in-memory paired-device store. */
export class MemoryPairedDeviceStore implements PairedDeviceStore {
  private readonly devices = new Map<string, PairedDevice>();
  async put(device: PairedDevice): Promise<void> {
    this.devices.set(device.deviceId, device);
  }
  async getById(deviceId: string): Promise<PairedDevice | undefined> {
    return this.devices.get(deviceId);
  }
  async list(): Promise<readonly PairedDevice[]> {
    return Array.from(this.devices.values());
  }
  async remove(deviceId: string): Promise<void> {
    this.devices.delete(deviceId);
  }
}

/** Generate a URL-safe base64 pairing token from 32 random bytes. */
export function generatePairingToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Dashboard-side: start a pairing session, return the QR payload. */
export async function issuePairing(
  options: IssuePairingOptions,
  sessionStore: PairingSessionStore,
  clock: () => number = Date.now,
): Promise<PairingQrPayload> {
  const ttl = Math.min(options.ttlMs ?? DEFAULT_TTL_MS, MAX_TTL_MS);
  const now = clock();
  const expiresAt = now + ttl;
  const token = generatePairingToken();
  const kp = generateKeyPair();

  const session: PairingSession = {
    pairingToken: token,
    serverId: options.serverId,
    serverUrl: options.serverUrl,
    connectionMethod: options.connectionMethod,
    serverPublicKey: kp.publicKey,
    serverSecretKey: kp.secretKey,
    expiresAt,
    consumed: false,
  };
  await sessionStore.put(session);

  const payload: PairingQrPayload = {
    version: 1,
    serverId: options.serverId,
    serverUrl: options.serverUrl,
    connectionMethod: options.connectionMethod,
    pairingToken: token,
    serverPublicKey: kp.publicKey,
    expiresAt,
  };
  return payload;
}

/** Mobile → server: redeem the token with the mobile's public key. */
export async function redeemPairing(
  body: unknown,
  sessionStore: PairingSessionStore,
  deviceStore: PairedDeviceStore,
  options: {
    generateApiBearer?: () => string;
    generateDeviceId?: () => string;
    clock?: () => number;
  } = {},
): Promise<{ response: PairingCompleteResponse; device: PairedDevice }> {
  const request: PairingCompleteRequest = PairingCompleteRequestSchema.parse(body);
  const now = (options.clock ?? Date.now)();
  const session = await sessionStore.get(request.pairingToken);
  if (!session) throw new Hipp0PairingTokenUnknownError();
  if (session.consumed) throw new Hipp0PairingTokenAlreadyUsedError();
  if (session.expiresAt < now) throw new Hipp0PairingTokenExpiredError();

  const deviceId = options.generateDeviceId ? options.generateDeviceId() : randomUUID();
  const apiBearer = options.generateApiBearer
    ? options.generateApiBearer()
    : randomBytes(32).toString('base64url');

  const confirmation: PairingConfirmationPayload = {
    deviceId,
    issuedAt: new Date(now).toISOString(),
    apiBearer,
  };
  const envelope = sealEnvelopeJson(confirmation, request.mobilePublicKey, session.serverSecretKey);

  const device: PairedDevice = {
    deviceId,
    serverId: session.serverId,
    mobilePublicKey: request.mobilePublicKey,
    serverPublicKey: session.serverPublicKey,
    serverSecretKey: session.serverSecretKey,
    ...(request.deviceName !== undefined && { deviceName: request.deviceName }),
    ...(request.platform !== undefined && { platform: request.platform }),
    pairedAt: new Date(now).toISOString(),
    apiBearer,
  };
  await deviceStore.put(device);
  await sessionStore.markConsumed(request.pairingToken);

  const response: PairingCompleteResponse = {
    deviceId,
    serverPublicKey: session.serverPublicKey,
    envelope,
  };
  return { response, device };
}

/** Export for tests that want to mock NaCl independently. */
export const __internal = { nacl } as const;

/** NaCl-box public-key length in bytes. Exposed for validators / tests. */
export const PUBLIC_KEY_BYTES = nacl.box.publicKeyLength;
