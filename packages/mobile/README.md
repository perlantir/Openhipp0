# @openhipp0/mobile

**Open Hipp0 Remote** — native iOS + Android app for driving your self-hosted Open Hipp0 server from your phone.

Built with Expo SDK 52 + React Native 0.76 + TypeScript (strict). Visual language follows the `claude-ai-mobile-design` skill (warm cream canvas, single coral accent, editorial restraint).

## Stack

| Layer | Choice |
|---|---|
| Runtime | Expo SDK 52 + RN 0.76 (New Architecture on) |
| Routing | Expo Router v4 (file-based, typed routes) |
| State | Zustand (local) + TanStack Query (server) |
| Styling | Native StyleSheet + NativeWind (Tailwind RN) |
| Icons | `lucide-react-native` |
| Storage | `expo-secure-store` (keys + bearer) + `expo-sqlite` (offline cache) |
| Crypto | `tweetnacl` (same primitive as `@openhipp0/core/pairing`) |
| Biometrics | `expo-local-authentication` |
| Push | `expo-notifications` |
| Tests | Vitest + jsdom + lightweight RN shim |

## Running

```bash
pnpm --filter @openhipp0/mobile test           # unit tests (theme / sync / pairing logic)
pnpm --filter @openhipp0/mobile typecheck      # tsc --noEmit
pnpm --filter @openhipp0/mobile lint
pnpm --filter @openhipp0/mobile start          # expo dev server
pnpm --filter @openhipp0/mobile ios            # iOS simulator (requires Xcode)
pnpm --filter @openhipp0/mobile android        # Android emulator
```

## Layout

```
packages/mobile/
├── app/                           # Expo Router roots
│   ├── _layout.tsx                # Root Stack + Providers
│   └── (tabs)/                    # 5-tab bottom nav
│       ├── _layout.tsx
│       ├── index.tsx              # Chat
│       ├── agents.tsx
│       ├── memory.tsx
│       ├── automations.tsx
│       └── settings.tsx
├── src/
│   ├── theme/                     # Design tokens (colors/typography/motion)
│   ├── api/                       # Fetch client + TanStack Query hooks
│   ├── store/                     # Zustand session store
│   ├── auth/                      # secure-store + biometric gate
│   ├── pairing/                   # QR scan / manual / method selector / guides
│   ├── chat/                      # ChatThread, MessageBubble, Composer, ApprovalCard
│   ├── sync/                      # Offline queue + conflict resolver + SyncManager
│   ├── db/                        # SQLite schema
│   ├── push/                      # Expo Notifications register + handler
│   ├── screens/                   # Reusable screen primitives (ScreenHeader, EmptyState)
│   └── widgets/                   # (deferred — see widgets/README.md)
├── tests/                         # Vitest suites + RN shim
└── app.json / eas.json            # Expo + EAS build config
```

## Pairing flow

1. Dashboard issues a 10-minute one-shot pairing token + NaCl keypair (via `@openhipp0/core/pairing`).
2. Payload encoded into QR: `{version, serverId, serverUrl, connectionMethod, pairingToken, serverPublicKey, expiresAt}`.
3. Mobile scans → generates its own keypair → `POST /api/pairing/complete`.
4. Server redeems the token, seals a confirmation envelope with the mobile's public key, returns it.
5. Mobile opens the envelope, persists everything in Keychain / Keystore via `expo-secure-store`.

Four transport options, ranked by ease:

- **Tailscale** (recommended — free, private, 5-min setup)
- **Cloudflare Tunnel** (requires a domain)
- **Relay** (community-run or self-hosted — see `@openhipp0/relay`)
- **LAN-only** (same-Wi-Fi simplest case)

## EAS build

```bash
pnpm --filter @openhipp0/mobile eas:build:ios
pnpm --filter @openhipp0/mobile eas:build:android
```

Requires:

- Apple Developer account ($99/yr) for iOS signed builds / TestFlight
- Expo / EAS account (free tier is fine)
- `eas login` once, then the `expo.extra.eas.projectId` in `app.json` should be replaced with your real project id

## Known deferred work

- **Home-screen widgets** (iOS WidgetKit + Android AppWidget). See `src/widgets/README.md`.
- **Voice input wiring.** The composer exposes an `onVoicePressed` hook and a mic icon; the expo-av recording round-trip into Whisper transcription lands in a follow-up.
- **Push notifications end-to-end.** Registration + handler are implemented; the server-side push-sender hook that seals events into the mobile's public key lives with the rest of the server wiring and isn't part of Phase 19.

## Design language

See `~/.claude/skills/claude-ai-mobile-design/` for the full token + component spec. In short:

- Warm neutrals + one coral accent (`#D97757`)
- Native system fonts (SF Pro / Roboto)
- 44dp min touch targets, 8-pt spacing grid
- Smooth motion (`cubic-bezier(0.16, 1, 0.3, 1)`) at 200 / 400 / 500 ms
- No gradients, no glows, no skeleton screens, no emoji-as-status
