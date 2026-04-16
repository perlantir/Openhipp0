// packages/mobile/src/pairing/manual-setup.tsx
// Fallback pairing flow for users who can't scan a QR (desktop-less setup,
// accessibility, etc.). They paste a server URL + pairing token + server
// public key as three distinct fields.

import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTheme } from "../theme/useTheme.js";
import type { ConnectionMethod } from "../auth/secure-store.js";

export interface ManualPairingSubmit {
  serverUrl: string;
  serverId: string;
  pairingToken: string;
  serverPublicKey: string;
  connectionMethod: ConnectionMethod;
}

export interface ManualSetupProps {
  method: ConnectionMethod;
  onSubmit: (payload: ManualPairingSubmit) => Promise<void> | void;
  onCancel: () => void;
}

function validate(payload: ManualPairingSubmit): string | null {
  if (!/^https?:\/\//.test(payload.serverUrl)) return "Server URL must start with http:// or https://";
  if (payload.pairingToken.length < 16) return "Pairing token looks too short.";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(payload.serverPublicKey))
    return "Server public key should be 44 base64 characters ending in =";
  if (!payload.serverId.trim()) return "Server ID is required.";
  return null;
}

export function ManualSetup({ method, onSubmit, onCancel }: ManualSetupProps) {
  const t = useTheme();
  const [serverUrl, setServerUrl] = useState("");
  const [serverId, setServerId] = useState("");
  const [pairingToken, setPairingToken] = useState("");
  const [serverPublicKey, setServerPublicKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    const payload: ManualPairingSubmit = {
      serverUrl: serverUrl.trim(),
      serverId: serverId.trim(),
      pairingToken: pairingToken.trim(),
      serverPublicKey: serverPublicKey.trim(),
      connectionMethod: method,
    };
    const problem = validate(payload);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pairing failed.");
    } finally {
      setBusy(false);
    }
  };

  const fieldStyle = {
    backgroundColor: t.colors.surface1,
    borderColor: t.colors.borderVisible,
    borderRadius: t.radii.component,
    color: t.colors.text1,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    marginBottom: t.spacing.md,
    minHeight: 48,
  } as const;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: t.colors.background }}
    >
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: t.spacing.xl, paddingVertical: t.spacing.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[t.typography.h1, { color: t.colors.text1, marginBottom: t.spacing.md }]}>
          Enter pairing details
        </Text>
        <Text style={[t.typography.body, { color: t.colors.text2, marginBottom: t.spacing.xl }]}>
          Copy these from the Pair Mobile Device screen in your dashboard.
        </Text>

        <Text style={[t.typography.label, { color: t.colors.text2, marginBottom: t.spacing.xs }]}>Server URL</Text>
        <TextInput
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder="https://your-server.ts.net:3100"
          placeholderTextColor={t.colors.text3}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={[styles.input, fieldStyle]}
        />

        <Text style={[t.typography.label, { color: t.colors.text2, marginBottom: t.spacing.xs }]}>Server ID</Text>
        <TextInput
          value={serverId}
          onChangeText={setServerId}
          placeholder="hipp0-001"
          placeholderTextColor={t.colors.text3}
          autoCapitalize="none"
          style={[styles.input, fieldStyle]}
        />

        <Text style={[t.typography.label, { color: t.colors.text2, marginBottom: t.spacing.xs }]}>Pairing token</Text>
        <TextInput
          value={pairingToken}
          onChangeText={setPairingToken}
          placeholder="43-character one-time token"
          placeholderTextColor={t.colors.text3}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, fieldStyle]}
        />

        <Text style={[t.typography.label, { color: t.colors.text2, marginBottom: t.spacing.xs }]}>Server public key</Text>
        <TextInput
          value={serverPublicKey}
          onChangeText={setServerPublicKey}
          placeholder="44-character base64 key"
          placeholderTextColor={t.colors.text3}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, fieldStyle]}
        />

        {error ? (
          <Text style={[t.typography.bodySm, { color: t.colors.error, marginBottom: t.spacing.md }]}>{error}</Text>
        ) : null}

        <View style={{ flexDirection: "row", gap: t.spacing.md }}>
          <Pressable
            onPress={onCancel}
            style={({ pressed }) => [
              styles.btn,
              {
                flex: 1,
                backgroundColor: pressed ? t.colors.surface2 : t.colors.surface1,
                borderColor: t.colors.borderVisible,
                borderWidth: 1,
                borderRadius: t.radii.control,
              },
            ]}
          >
            <Text style={[t.typography.label, { color: t.colors.text1 }]}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSubmit}
            disabled={busy}
            style={({ pressed }) => [
              styles.btn,
              {
                flex: 1,
                backgroundColor: busy
                  ? t.colors.surface3
                  : pressed
                    ? t.colors.accentPressed
                    : t.colors.accent,
                borderRadius: t.radii.control,
              },
            ]}
          >
            <Text style={[t.typography.label, { color: busy ? t.colors.text4 : t.colors.accentOn }]}>
              {busy ? "Pairing…" : "Pair device"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1 },
  btn: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingVertical: 12, paddingHorizontal: 20 },
});
