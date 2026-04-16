// packages/mobile/src/auth/biometric-gate.tsx
// Gates children behind a biometric challenge. Auto-locks after
// `idleMs` of inactivity — subtract 5 min as the default.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { useTheme } from "../theme/useTheme.js";
import { authenticate, probeBiometricAvailability } from "./biometric.js";
import { useSession } from "../store/session.js";

export interface BiometricGateProps {
  /** Idle ms before relocking. Default 5 minutes. */
  idleMs?: number;
  /** If true, the gate is skipped entirely. Useful for tests. */
  disabled?: boolean;
  children: ReactNode;
}

export function BiometricGate({
  idleMs = 5 * 60_000,
  disabled = false,
  children,
}: BiometricGateProps) {
  const t = useTheme();
  const unlocked = useSession((s) => s.biometricUnlocked);
  const setUnlocked = useSession((s) => s.setUnlocked);
  const [error, setError] = useState<string | null>(null);
  const [biometricsAvailable, setBiometricsAvailable] = useState<boolean | null>(null);
  const lastActiveRef = useRef<number>(Date.now());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const avail = await probeBiometricAvailability();
      if (!cancelled) setBiometricsAvailable(avail.available);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const challenge = useCallback(async () => {
    setError(null);
    const ok = await authenticate({ promptMessage: "Unlock Open Hipp0" });
    if (ok) {
      setUnlocked(true);
      lastActiveRef.current = Date.now();
    } else {
      setError("Authentication failed. Try again.");
    }
  }, [setUnlocked]);

  // Auto-lock on background
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") {
        if (Date.now() - lastActiveRef.current > idleMs) setUnlocked(false);
      } else if (state === "active") {
        lastActiveRef.current = Date.now();
      }
    });
    return () => sub.remove();
  }, [idleMs, setUnlocked]);

  if (disabled || biometricsAvailable === false) return <>{children}</>;
  if (biometricsAvailable === null) return null; // short loading flash

  if (unlocked) return <>{children}</>;

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: t.colors.background,
        padding: t.spacing.xxxl,
      }}
    >
      <Text style={[t.typography.display, { color: t.colors.text1, marginBottom: t.spacing.md }]}>
        Locked
      </Text>
      <Text
        style={[
          t.typography.body,
          { color: t.colors.text2, textAlign: "center", marginBottom: t.spacing.xxl, maxWidth: 320 },
        ]}
      >
        Unlock with Face ID, Touch ID, or your device passcode to continue.
      </Text>
      {error ? (
        <Text
          style={[
            t.typography.bodySm,
            { color: t.colors.error, marginBottom: t.spacing.md, textAlign: "center" },
          ]}
        >
          {error}
        </Text>
      ) : null}
      <Pressable
        onPress={() => void challenge()}
        style={({ pressed }) => ({
          minHeight: 44,
          paddingVertical: t.spacing.md,
          paddingHorizontal: t.spacing.xl,
          borderRadius: t.radii.control,
          backgroundColor: pressed ? t.colors.accentPressed : t.colors.accent,
        })}
      >
        <Text style={[t.typography.label, { color: t.colors.accentOn }]}>Unlock</Text>
      </Pressable>
    </View>
  );
}
