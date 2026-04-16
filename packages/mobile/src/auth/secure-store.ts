// packages/mobile/src/auth/secure-store.ts
// Typed wrapper over expo-secure-store for persisting the device keypair,
// API bearer, and the paired server's public key. Values live in the iOS
// Keychain / Android Keystore and are scoped to this app's bundle id.

import * as SecureStore from "expo-secure-store";

const K = {
  MOBILE_PUBLIC_KEY: "hipp0.mobile.publicKey",
  MOBILE_SECRET_KEY: "hipp0.mobile.secretKey",
  SERVER_PUBLIC_KEY: "hipp0.server.publicKey",
  SERVER_URL: "hipp0.server.url",
  SERVER_ID: "hipp0.server.id",
  CONNECTION_METHOD: "hipp0.connection.method",
  API_BEARER: "hipp0.api.bearer",
  DEVICE_ID: "hipp0.device.id",
} as const;

export type ConnectionMethod = "tailscale" | "cloudflare" | "relay" | "lan";

export interface StoredPairing {
  mobilePublicKey: string;
  mobileSecretKey: string;
  serverPublicKey: string;
  serverUrl: string;
  serverId: string;
  connectionMethod: ConnectionMethod;
  apiBearer: string;
  deviceId: string;
}

/** Persist a completed pairing. Overwrites any prior pairing. */
export async function saveStoredPairing(p: StoredPairing): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(K.MOBILE_PUBLIC_KEY, p.mobilePublicKey),
    SecureStore.setItemAsync(K.MOBILE_SECRET_KEY, p.mobileSecretKey, {
      requireAuthentication: false,
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    }),
    SecureStore.setItemAsync(K.SERVER_PUBLIC_KEY, p.serverPublicKey),
    SecureStore.setItemAsync(K.SERVER_URL, p.serverUrl),
    SecureStore.setItemAsync(K.SERVER_ID, p.serverId),
    SecureStore.setItemAsync(K.CONNECTION_METHOD, p.connectionMethod),
    SecureStore.setItemAsync(K.API_BEARER, p.apiBearer, {
      requireAuthentication: false,
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    }),
    SecureStore.setItemAsync(K.DEVICE_ID, p.deviceId),
  ]);
}

/** Load the stored pairing, or null if never paired / partially stored. */
export async function loadStoredPairing(): Promise<StoredPairing | null> {
  const entries = await Promise.all(
    Object.values(K).map((k) => SecureStore.getItemAsync(k)),
  );
  const [
    mobilePublicKey,
    mobileSecretKey,
    serverPublicKey,
    serverUrl,
    serverId,
    connectionMethod,
    apiBearer,
    deviceId,
  ] = entries;

  if (
    !mobilePublicKey ||
    !mobileSecretKey ||
    !serverPublicKey ||
    !serverUrl ||
    !serverId ||
    !connectionMethod ||
    !apiBearer ||
    !deviceId
  ) {
    return null;
  }
  return {
    mobilePublicKey,
    mobileSecretKey,
    serverPublicKey,
    serverUrl,
    serverId,
    connectionMethod: connectionMethod as ConnectionMethod,
    apiBearer,
    deviceId,
  };
}

/** Nuke every pairing key. Used by "Reset pairing" in Settings. */
export async function clearStoredPairing(): Promise<void> {
  await Promise.all(
    Object.values(K).map((k) => SecureStore.deleteItemAsync(k)),
  );
}

/** Quick probe: has this device ever completed pairing? */
export async function hasStoredPairing(): Promise<boolean> {
  const deviceId = await SecureStore.getItemAsync(K.DEVICE_ID);
  return deviceId !== null;
}
