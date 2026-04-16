// packages/mobile/src/pairing/qr-scanner.tsx
// Camera-based QR scanner. The payload is the PairingQrPayload shape from
// @openhipp0/core pairing module — we parse + validate it here before
// handing it to the pairing completer.

import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useTheme } from "../theme/useTheme.js";

interface ScannedQr {
  version: 1;
  serverId: string;
  serverUrl: string;
  connectionMethod: "tailscale" | "cloudflare" | "relay" | "lan";
  pairingToken: string;
  serverPublicKey: string;
  expiresAt: number;
}

export interface QrScannerProps {
  onScan: (payload: ScannedQr) => void;
  onManualEntry: () => void;
  onCancel: () => void;
}

function parseQrPayload(raw: string): ScannedQr | null {
  try {
    const data = JSON.parse(raw) as Partial<ScannedQr>;
    if (
      data.version !== 1 ||
      typeof data.serverId !== "string" ||
      typeof data.serverUrl !== "string" ||
      typeof data.pairingToken !== "string" ||
      typeof data.serverPublicKey !== "string" ||
      typeof data.expiresAt !== "number" ||
      (data.connectionMethod !== "tailscale" &&
        data.connectionMethod !== "cloudflare" &&
        data.connectionMethod !== "relay" &&
        data.connectionMethod !== "lan")
    ) {
      return null;
    }
    return data as ScannedQr;
  } catch {
    return null;
  }
}

export function QrScanner({ onScan, onManualEntry, onCancel }: QrScannerProps) {
  const t = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  if (!permission) {
    return (
      <View style={[styles.center, { backgroundColor: t.colors.background }]}>
        <ActivityIndicator color={t.colors.accent} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.center, { backgroundColor: t.colors.background, padding: t.spacing.xxxl }]}>
        <Text style={[t.typography.h2, { color: t.colors.text1, marginBottom: t.spacing.md, textAlign: "center" }]}>
          Camera access needed
        </Text>
        <Text style={[t.typography.body, { color: t.colors.text2, textAlign: "center", marginBottom: t.spacing.xl }]}>
          The QR scanner needs camera access to read the pairing code from your dashboard.
        </Text>
        <Pressable
          onPress={() => void requestPermission()}
          style={({ pressed }) => [
            styles.primaryBtn,
            {
              backgroundColor: pressed ? t.colors.accentPressed : t.colors.accent,
              borderRadius: t.radii.control,
            },
          ]}
        >
          <Text style={[t.typography.label, { color: t.colors.accentOn }]}>Grant access</Text>
        </Pressable>
        <Pressable onPress={onManualEntry} style={{ marginTop: t.spacing.lg }}>
          <Text style={[t.typography.label, { color: t.colors.text2 }]}>Enter manually instead</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: t.colors.background }]}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={(e) => {
          if (handled.current) return;
          const parsed = parseQrPayload(e.data);
          if (!parsed) {
            setError("This QR code isn't a valid Open Hipp0 pairing code.");
            return;
          }
          if (parsed.expiresAt < Date.now()) {
            setError("Pairing code has expired. Generate a new one from the dashboard.");
            return;
          }
          handled.current = true;
          onScan(parsed);
        }}
      />
      <View style={[styles.overlayTop, { paddingTop: t.spacing.xxl, paddingHorizontal: t.spacing.xl }]}>
        <Pressable onPress={onCancel} hitSlop={16}>
          <Text style={[t.typography.label, { color: "#FFFFFF" }]}>Cancel</Text>
        </Pressable>
      </View>
      <View style={styles.viewfinder} pointerEvents="none">
        <View style={styles.frame} />
      </View>
      <View style={[styles.overlayBottom, { padding: t.spacing.xl }]}>
        {error ? (
          <Text style={[t.typography.bodySm, { color: "#FFFFFF", textAlign: "center", marginBottom: t.spacing.md }]}>
            {error}
          </Text>
        ) : (
          <Text style={[t.typography.body, { color: "#FFFFFF", textAlign: "center", marginBottom: t.spacing.md }]}>
            Point at the QR code on your dashboard
          </Text>
        )}
        <Pressable onPress={onManualEntry} style={{ alignSelf: "center", paddingVertical: t.spacing.sm, paddingHorizontal: t.spacing.lg }}>
          <Text style={[t.typography.label, { color: "#FFFFFF" }]}>Enter manually instead</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  overlayTop: { position: "absolute", top: 0, left: 0, right: 0 },
  overlayBottom: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.35)" },
  viewfinder: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  frame: { width: 240, height: 240, borderWidth: 2, borderColor: "#FFFFFF", borderRadius: 20 },
  primaryBtn: { minHeight: 44, paddingVertical: 12, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
});
