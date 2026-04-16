// packages/mobile/app/(tabs)/settings.tsx
// Settings tab — connection info, theme info, reset pairing affordance.

import { Alert, Pressable, Text, View, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../../src/theme/useTheme.js";
import { useSession } from "../../src/store/session.js";
import { useHealth } from "../../src/api/hooks.js";
import { ScreenHeader } from "../../src/screens/ScreenHeader.js";
import { clearStoredPairing } from "../../src/auth/secure-store.js";

function Row({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: t.spacing.lg,
        paddingVertical: t.spacing.md,
        minHeight: 52,
        borderBottomColor: t.colors.border,
        borderBottomWidth: 1,
        gap: t.spacing.md,
      }}
    >
      <Text style={[t.typography.body, { color: t.colors.text1 }]}>{label}</Text>
      <Text style={[t.typography.bodySm, { color: t.colors.text3, flexShrink: 1, textAlign: "right" }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export default function SettingsTab() {
  const t = useTheme();
  const session = useSession();
  const health = useHealth();
  const clearSession = useSession((s) => s.clear);

  const confirmReset = () => {
    Alert.alert(
      "Reset pairing?",
      "This deletes the paired server, keypair, and API bearer from this device. You'll need to re-pair from the dashboard.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            await clearStoredPairing();
            clearSession();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <ScreenHeader title="Settings" />
      <ScrollView>
        <Text
          style={[
            t.typography.label,
            {
              color: t.colors.text2,
              textTransform: "uppercase",
              paddingHorizontal: t.spacing.lg,
              paddingTop: t.spacing.lg,
              paddingBottom: t.spacing.sm,
            },
          ]}
        >
          Connection
        </Text>
        <Row label="Server" value={session.serverUrl ?? "— not paired —"} />
        <Row label="Method" value={session.connectionMethod ?? "—"} />
        <Row label="Device ID" value={session.deviceId ? session.deviceId.slice(0, 8) + "…" : "—"} />
        <Row
          label="Status"
          value={
            health.isLoading
              ? "checking…"
              : health.error
                ? "offline"
                : health.data?.status ?? "unknown"
          }
        />

        <Text
          style={[
            t.typography.label,
            {
              color: t.colors.text2,
              textTransform: "uppercase",
              paddingHorizontal: t.spacing.lg,
              paddingTop: t.spacing.xl,
              paddingBottom: t.spacing.sm,
            },
          ]}
        >
          About
        </Text>
        <Row label="App version" value="0.1.0" />
        <Row label="Theme" value={t.mode} />

        <View style={{ padding: t.spacing.lg, marginTop: t.spacing.xl }}>
          <Pressable
            onPress={confirmReset}
            style={({ pressed }) => ({
              minHeight: 44,
              paddingVertical: t.spacing.md,
              paddingHorizontal: t.spacing.xl,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: t.radii.control,
              backgroundColor: pressed ? "#9C3A33" : t.colors.error,
            })}
          >
            <Text style={[t.typography.label, { color: "#FFFFFF" }]}>Reset pairing</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
