// packages/mobile/src/pairing/connection-guide.tsx
// Per-method setup walkthrough. One component, method-keyed content —
// avoids 4 near-duplicate files and keeps copy centrally editable.

import { ScrollView, Text, View, Pressable, StyleSheet, Linking } from "react-native";
import { useTheme } from "../theme/useTheme.js";
import type { ConnectionMethod } from "../auth/secure-store.js";

interface Step {
  n: number;
  body: string;
}

interface GuideCopy {
  title: string;
  subtitle: string;
  steps: readonly Step[];
  learnMore?: { label: string; url: string };
}

const COPY: Record<ConnectionMethod, GuideCopy> = {
  tailscale: {
    title: "Set up Tailscale",
    subtitle:
      "Tailscale creates an encrypted mesh between your devices. Free for personal use, no port forwarding, works through CGNAT.",
    steps: [
      { n: 1, body: "Install Tailscale on your server: 'curl -fsSL https://tailscale.com/install.sh | sh' then 'sudo tailscale up'." },
      { n: 2, body: "Sign in with the account you'll use for this phone too." },
      { n: 3, body: "Install the Tailscale app on this phone from the App Store / Play Store and sign in with the same account." },
      { n: 4, body: "On the server, note your Tailscale IP: 'tailscale ip -4'. Your pairing URL will be https://<that-ip>:3100." },
      { n: 5, body: "Come back here and tap 'Continue' to scan your dashboard's pairing QR." },
    ],
    learnMore: { label: "Tailscale docs", url: "https://tailscale.com/kb/1017/install" },
  },
  cloudflare: {
    title: "Set up Cloudflare Tunnel",
    subtitle:
      "cloudflared exposes your server through a public Cloudflare URL without opening any inbound ports. Requires a domain on Cloudflare.",
    steps: [
      { n: 1, body: "Install cloudflared on your server per Cloudflare's instructions." },
      { n: 2, body: "Run 'cloudflared tunnel login' and authorise your domain." },
      { n: 3, body: "Create a tunnel: 'cloudflared tunnel create open-hipp0'. Copy the generated UUID." },
      { n: 4, body: "Route your chosen subdomain to the tunnel: 'cloudflared tunnel route dns open-hipp0 hipp0.yourdomain.com'." },
      { n: 5, body: "Run 'cloudflared tunnel run open-hipp0 --url http://localhost:3100'. Your pairing URL is https://hipp0.yourdomain.com." },
    ],
    learnMore: { label: "Cloudflare Tunnel docs", url: "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/" },
  },
  relay: {
    title: "Relay service",
    subtitle:
      "A relay is a tiny WebSocket router: your server connects outbound, your phone connects inbound, and the relay shuffles end-to-end-encrypted envelopes between them — it can't read the content.",
    steps: [
      { n: 1, body: "Run your own relay with 'docker run -p 443:443 ghcr.io/openhipp0/relay' — takes 30 seconds on a $5 VPS." },
      { n: 2, body: "Or pick one from the community-run registry. Open Hipp0 does not host a public relay, and we don't endorse specific operators." },
      { n: 3, body: "On the server, set HIPP0_RELAY_URL=wss://your-relay and restart hipp0." },
      { n: 4, body: "Come back here and tap 'Continue' to scan your dashboard's pairing QR." },
    ],
    learnMore: { label: "Community relay registry", url: "https://github.com/openhipp0/community-relays" },
  },
  lan: {
    title: "LAN only",
    subtitle:
      "The simplest option: your phone only talks to the server when both are on the same Wi-Fi. Nothing leaves your local network.",
    steps: [
      { n: 1, body: "Find your server's LAN IP: 'ip -4 a' or check your router's device list." },
      { n: 2, body: "Your pairing URL is http://<that-ip>:3100." },
      { n: 3, body: "Make sure this phone is on the same Wi-Fi network as the server." },
      { n: 4, body: "Come back here and tap 'Continue' to scan your dashboard's pairing QR." },
    ],
  },
};

export interface ConnectionGuideProps {
  method: ConnectionMethod;
  onContinue: () => void;
  onBack: () => void;
}

export function ConnectionGuide({ method, onContinue, onBack }: ConnectionGuideProps) {
  const t = useTheme();
  const copy = COPY[method];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.background }}
      contentContainerStyle={{ paddingHorizontal: t.spacing.xl, paddingVertical: t.spacing.xxl }}
    >
      <Text style={[t.typography.h1, { color: t.colors.text1, marginBottom: t.spacing.sm }]}>
        {copy.title}
      </Text>
      <Text style={[t.typography.body, { color: t.colors.text2, marginBottom: t.spacing.xl }]}>
        {copy.subtitle}
      </Text>

      {copy.steps.map((step) => (
        <View key={step.n} style={{ flexDirection: "row", marginBottom: t.spacing.lg, gap: t.spacing.md }}>
          <View
            style={[
              styles.stepNumber,
              {
                backgroundColor: t.colors.accentSubtle,
                borderRadius: t.radii.pill,
              },
            ]}
          >
            <Text style={[t.typography.label, { color: t.colors.accent }]}>{step.n}</Text>
          </View>
          <Text style={[t.typography.body, { color: t.colors.text1, flex: 1, lineHeight: 24 }]}>
            {step.body}
          </Text>
        </View>
      ))}

      {copy.learnMore ? (
        <Pressable onPress={() => void Linking.openURL(copy.learnMore!.url)} style={{ marginTop: t.spacing.md }}>
          <Text style={[t.typography.label, { color: t.colors.accent }]}>
            {copy.learnMore.label} →
          </Text>
        </Pressable>
      ) : null}

      <View style={{ flexDirection: "row", gap: t.spacing.md, marginTop: t.spacing.xxl }}>
        <Pressable
          onPress={onBack}
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
          <Text style={[t.typography.label, { color: t.colors.text1 }]}>Back</Text>
        </Pressable>
        <Pressable
          onPress={onContinue}
          style={({ pressed }) => [
            styles.btn,
            {
              flex: 1,
              backgroundColor: pressed ? t.colors.accentPressed : t.colors.accent,
              borderRadius: t.radii.control,
            },
          ]}
        >
          <Text style={[t.typography.label, { color: t.colors.accentOn }]}>Continue</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  stepNumber: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  btn: {
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
