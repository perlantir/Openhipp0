/**
 * Mobile-pairing types (Phase 19).
 *
 * The pairing handshake is a short-lived, one-shot ceremony that establishes
 * an end-to-end-encrypted channel between a self-hosted Open Hipp0 server and
 * a user's mobile device. Every envelope on the wire — even when the transport
 * is a community relay — is NaCl-box sealed with the device's keypair, so the
 * relay never sees plaintext.
 */

import { z } from 'zod';

/** Base64-encoded 32-byte NaCl box public key. */
export const PublicKeyB64 = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/, { message: 'expected base64-encoded 32-byte public key' });
/** Base64-encoded ciphertext. Length is opaque here (varies by payload). */
export const CiphertextB64 = z.string().regex(/^[A-Za-z0-9+/]+=*$/, {
  message: 'expected base64-encoded ciphertext',
});
/** Base64-encoded 24-byte NaCl box nonce. */
export const NonceB64 = z
  .string()
  .regex(/^[A-Za-z0-9+/]{32}=$/, { message: 'expected base64-encoded 24-byte nonce' });

/** Connection strategies a mobile device can use to reach its server. */
export const ConnectionMethod = z.enum(['tailscale', 'cloudflare', 'relay', 'lan']);
export type ConnectionMethod = z.infer<typeof ConnectionMethod>;

/** The sealed NaCl-box envelope wire format. */
export const EnvelopeSchema = z.object({
  nonce: NonceB64,
  ciphertext: CiphertextB64,
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

/** Payload encoded into the pairing QR. Non-sensitive — public keys are public. */
export const PairingQrPayloadSchema = z.object({
  version: z.literal(1),
  serverId: z.string().min(1),
  serverUrl: z.string().url(),
  connectionMethod: ConnectionMethod,
  pairingToken: z.string().min(16),
  serverPublicKey: PublicKeyB64,
  /** UTC ms when the token expires. */
  expiresAt: z.number().int().positive(),
});
export type PairingQrPayload = z.infer<typeof PairingQrPayloadSchema>;

/** Body POSTed to /api/pairing/complete by the mobile device. */
export const PairingCompleteRequestSchema = z.object({
  pairingToken: z.string(),
  mobilePublicKey: PublicKeyB64,
  deviceName: z.string().max(64).optional(),
  platform: z.enum(['ios', 'android']).optional(),
});
export type PairingCompleteRequest = z.infer<typeof PairingCompleteRequestSchema>;

/** Successful completion response. Mobile persists the sealed envelope contents. */
export interface PairingCompleteResponse {
  /** Stable id the mobile device will send back on every future request. */
  deviceId: string;
  /** Echoes the server's public key so the mobile can double-check what it scanned. */
  serverPublicKey: string;
  /** NaCl-box envelope whose plaintext is `PairingConfirmationPayload`. */
  envelope: Envelope;
}

/** Payload inside the pairing-complete envelope (encrypted, mobile opens it). */
export const PairingConfirmationPayloadSchema = z.object({
  deviceId: z.string(),
  /** ISO 8601 timestamp. */
  issuedAt: z.string(),
  apiBearer: z.string(),
});
export type PairingConfirmationPayload = z.infer<typeof PairingConfirmationPayloadSchema>;

/** Everything needed to initiate pairing from the dashboard side. */
export interface IssuePairingOptions {
  serverId: string;
  serverUrl: string;
  connectionMethod: ConnectionMethod;
  /** TTL in ms. Default 10 minutes. Hard cap 60 minutes. */
  ttlMs?: number;
}

/** Pairing session stored server-side until the mobile completes it. */
export interface PairingSession {
  pairingToken: string;
  serverId: string;
  serverUrl: string;
  connectionMethod: ConnectionMethod;
  serverPublicKey: string;
  serverSecretKey: string;
  /** UTC ms. */
  expiresAt: number;
  /** Once true the token may not be redeemed again. */
  consumed: boolean;
}

/** Persisted record of a completed pairing — one per device. */
export interface PairedDevice {
  deviceId: string;
  serverId: string;
  mobilePublicKey: string;
  serverPublicKey: string;
  serverSecretKey: string;
  deviceName?: string;
  platform?: 'ios' | 'android';
  pairedAt: string;
  apiBearer: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class Hipp0PairingError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'Hipp0PairingError';
    this.code = code;
  }
}

export class Hipp0PairingTokenExpiredError extends Hipp0PairingError {
  constructor() {
    super('PAIRING_TOKEN_EXPIRED', 'Pairing token has expired. Generate a new QR from the dashboard.');
    this.name = 'Hipp0PairingTokenExpiredError';
  }
}

export class Hipp0PairingTokenAlreadyUsedError extends Hipp0PairingError {
  constructor() {
    super('PAIRING_TOKEN_USED', 'Pairing token has already been consumed. Generate a new one.');
    this.name = 'Hipp0PairingTokenAlreadyUsedError';
  }
}

export class Hipp0PairingTokenUnknownError extends Hipp0PairingError {
  constructor() {
    super('PAIRING_TOKEN_UNKNOWN', 'Pairing token is not recognised by this server.');
    this.name = 'Hipp0PairingTokenUnknownError';
  }
}

export class Hipp0EnvelopeOpenError extends Hipp0PairingError {
  constructor(message: string) {
    super('ENVELOPE_OPEN_FAILED', message);
    this.name = 'Hipp0EnvelopeOpenError';
  }
}
