// packages/mobile/src/pairing/method-selector.tsx
// First-run onboarding wizard. User picks how their phone will reach the
// self-hosted server. Visual language follows the claude-ai-mobile-design
// skill — warm cream canvas, one accent per screen, type-driven hierarchy.

import { ScrollView, Text, View, Pressable, StyleSheet } from "react-native";
import { useTheme } from "../theme/useTheme.js";
import type { ConnectionMethod } from "../auth/secure-store.js";

interface MethodOption {
  id: ConnectionMethod;
  glyph: string; // Lucide icon name; rendered via <Icon> in real runtime
  title: string;
  pitch: string;
  best: string;
}

const OPTIONS: readonly MethodOption[] = [
  {
    id: "tailscale",
    glyph: "shield",
    title: "VPN — Tailscale",
    pitch: "Free, private, 5-minute setup. We'll walk you through it.",
    best: "Recommended for most people.",
  },
  {
    id: "cloudflare",
    glyph: "cloud",
    title: "Cloudflare Tunnel",
    pitch: "Free, requires a domain you already own.",
    best: "Good if you already run your own domain.",
  },
  {
    id: "relay",
    glyph: "radio",
    title: "Relay Service (advanced)",
    pitch: "E2E encrypted — relay can't read data. Run your own on a $5 VPS.",
    best: "Good when VPN isn't an option.",
  },
  {
    id: "lan",
    glyph: "home",
    title: "LAN only",
    pitch: "Only works on same Wi-Fi as server. Zero setup, zero exposure.",
    best: "Good for home-only use.",
  },
] as const;

export interface MethodSelectorProps {
  onSelect: (method: ConnectionMethod) => void;
}

export function MethodSelector({ onSelect }: MethodSelectorProps) {
  const t = useTheme();
  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { backgroundColor: t.colors.background, paddingHorizontal: t.spacing.xl, paddingVertical: t.spacing.xxxl }]}
    >
      <Text style={[t.typography.display, { color: t.colors.text1, marginBottom: t.spacing.md }]}>
        How should your phone reach your agent?
      </Text>
      <Text style={[t.typography.body, { color: t.colors.text2, marginBottom: t.spacing.xxl }]}>
        Pick the method that fits your setup. All four keep your messages end-to-end encrypted.
      </Text>

      {OPTIONS.map((opt) => (
        <Pressable
          key={opt.id}
          onPress={() => onSelect(opt.id)}
          accessibilityRole="button"
          accessibilityLabel={opt.title}
          style={({ pressed }) => [
            styles.card,
            {
              backgroundColor: pressed ? t.colors.surface2 : t.colors.surface1,
              borderColor: t.colors.border,
              borderRadius: t.radii.component,
              padding: t.spacing.lg,
              marginBottom: t.spacing.md,
            },
          ]}
        >
          <Text style={[t.typography.h3, { color: t.colors.text1, marginBottom: t.spacing.xs }]}>
            {opt.title}
          </Text>
          <Text style={[t.typography.bodySm, { color: t.colors.text2, marginBottom: t.spacing.sm }]}>
            {opt.pitch}
          </Text>
          <Text style={[t.typography.caption, { color: t.colors.text3 }]}>{opt.best}</Text>
        </Pressable>
      ))}

      <View style={{ marginTop: t.spacing.xl }}>
        <Text style={[t.typography.caption, { color: t.colors.text3, textAlign: "center" }]}>
          Open Hipp0 runs no servers. You control where your data lives.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1 },
  card: { borderWidth: 1 },
});
