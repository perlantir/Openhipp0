// packages/mobile/src/store/session.ts
// Zustand store for runtime session state — serves as the in-memory cache
// of the StoredPairing loaded from secure storage. Never persisted here;
// secure-store is the durable source of truth.

import { create } from "zustand";
import type { ConnectionMethod } from "../auth/secure-store.js";

export interface SessionState {
  // Resolved pairing (null until loaded)
  deviceId: string | null;
  serverId: string | null;
  serverUrl: string | null;
  serverPublicKey: string | null;
  mobilePublicKey: string | null;
  mobileSecretKey: string | null;
  apiBearer: string | null;
  connectionMethod: ConnectionMethod | null;
  // UI state
  loaded: boolean;
  biometricUnlocked: boolean;
  // Mutations
  setPairing: (pairing: Omit<SessionState, "loaded" | "biometricUnlocked" | "setPairing" | "clear" | "markLoaded" | "setUnlocked">) => void;
  markLoaded: () => void;
  setUnlocked: (unlocked: boolean) => void;
  clear: () => void;
}

export const useSession = create<SessionState>((set) => ({
  deviceId: null,
  serverId: null,
  serverUrl: null,
  serverPublicKey: null,
  mobilePublicKey: null,
  mobileSecretKey: null,
  apiBearer: null,
  connectionMethod: null,
  loaded: false,
  biometricUnlocked: false,
  setPairing: (pairing) =>
    set(() => ({
      deviceId: pairing.deviceId,
      serverId: pairing.serverId,
      serverUrl: pairing.serverUrl,
      serverPublicKey: pairing.serverPublicKey,
      mobilePublicKey: pairing.mobilePublicKey,
      mobileSecretKey: pairing.mobileSecretKey,
      apiBearer: pairing.apiBearer,
      connectionMethod: pairing.connectionMethod,
      loaded: true,
    })),
  markLoaded: () => set(() => ({ loaded: true })),
  setUnlocked: (unlocked) => set(() => ({ biometricUnlocked: unlocked })),
  clear: () =>
    set(() => ({
      deviceId: null,
      serverId: null,
      serverUrl: null,
      serverPublicKey: null,
      mobilePublicKey: null,
      mobileSecretKey: null,
      apiBearer: null,
      connectionMethod: null,
      loaded: true,
      biometricUnlocked: false,
    })),
}));

/** Convenience: is the device paired (has complete credentials)? */
export function isPaired(s: SessionState): boolean {
  return (
    s.deviceId !== null &&
    s.serverUrl !== null &&
    s.serverPublicKey !== null &&
    s.mobilePublicKey !== null &&
    s.mobileSecretKey !== null &&
    s.apiBearer !== null
  );
}
