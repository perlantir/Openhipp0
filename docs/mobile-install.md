# Open Hipp0 Remote — mobile install (no App Store)

Open Hipp0 is a self-hosted project; the mobile app ships the same way — sideloadable, no App Store review pipeline required.

This doc covers the two distribution channels we support and the operator steps to publish a new version on each.

---

## Channels at a glance

| Platform | Channel | Who hosts the binary | User install step |
|---|---|---|---|
| iOS | TestFlight external track | Apple | Tap link → install TestFlight → join |
| iOS | Sideload IPA | You | Use AltStore / Sideloadly |
| Android | Direct APK | You | Download → "Install from unknown sources" |
| Android | F-Droid (roadmap) | F-Droid | `fdroid install openhipp0` |

Users land on `deployment/mobile-install/index.html` — it UA-detects their platform and shows the relevant CTA.

---

## 1. iOS — TestFlight external track

**Why this works without App Store review:** TestFlight's external track is Apple's public beta channel. Apple reviews the **first** build of a new major version, then subsequent builds ship with no review for 90 days. External testers can be up to 10,000 concurrent users.

**Prerequisites**

- Apple Developer account ($99/yr)
- App registered in App Store Connect (bundle id `com.openhipp0.mobile`)
- `eas-cli` logged in (`eas login`)
- `packages/mobile/eas.json` → `submit.testflight-external` filled with your Apple ID + Team ID + ASC App ID

**Build + submit**

```bash
# From the repo root:
scripts/build-mobile.sh ios
```

What this does:

1. `eas build --platform ios --profile testflight-external` — cloud build, signed with your distribution cert.
2. `eas submit --platform ios --profile testflight-external --latest` — uploads the IPA to App Store Connect.
3. The build appears in App Store Connect → TestFlight.
4. Promote to external testers → Apple reviews if it's the first of a major version, otherwise instant.

**Public link**

App Store Connect → TestFlight → External Testers → Public Link. Enable it. Copy the URL (format: `https://testflight.apple.com/join/XXXXXX`).

Paste that URL into:

- `deployment/mobile-install/index.html` (either swap the placeholder inline or override `window.__HIPP0_TESTFLIGHT_URL__` at deploy time).

**Fallback: IPA sideload**

For users who can't or won't use TestFlight (corp devices, privacy preferences, jailbroken phones):

- After each build, EAS publishes a `.ipa` URL. Copy it to your server as `openhipp0-latest.ipa`.
- Users install via AltStore or Sideloadly. Free Apple IDs require re-signing every 7 days; paid accounts get a full year.

---

## 2. Android — direct APK

**Why this is the primary channel:** Android has first-class sideloading support. No gatekeeper, no review, no account required on the user side.

**Prerequisites**

- Android Studio + Java 17 (for local builds) OR an EAS account (for cloud builds)
- A release signing keystore (EAS can generate + hold this for you)

**Build**

```bash
# Cloud build (recommended):
scripts/build-mobile.sh android

# Or local (requires Android SDK + NDK set up):
scripts/build-mobile.sh android --local
```

Cloud output: an `openhipp0-*.apk` URL from EAS. Download it, upload to your release host as `openhipp0-latest.apk`.

**Publish**

Host the APK anywhere HTTPS — your self-hosted deploy, GitHub Releases, an S3 bucket, whatever. Update:

- `deployment/mobile-install/index.html` — swap the APK link (or set `window.__HIPP0_APK_URL__`).
- The QR code on the landing page auto-generates from the APK URL (add the client-side QR lib in the next revision; placeholder text for now).

**Signing fingerprint**

Record your release keystore's SHA-256 fingerprint in `deployment/mobile-install/SIGNING.txt` so end users can verify the APK hasn't been tampered with:

```bash
keytool -list -v -keystore release.keystore -alias <alias> | grep SHA256
```

Ship the same fingerprint across every release — if you rotate the key, users have to uninstall + reinstall.

---

## 3. Landing page deployment

The static landing at `deployment/mobile-install/` is plain HTML — no build step. Deploy it anywhere:

- **GitHub Pages** — push the `deployment/mobile-install/` dir to a `gh-pages` branch.
- **Cloudflare Pages** — `wrangler pages deploy deployment/mobile-install`.
- **Your own server** — copy the dir into your static root, alongside the IPA + APK files.

The page reads three URLs at runtime:

```html
<script>
  window.__HIPP0_TESTFLIGHT_URL__ = "https://testflight.apple.com/join/XXXXXX";
  window.__HIPP0_IPA_URL__        = "https://your.host/openhipp0-latest.ipa";
  window.__HIPP0_APK_URL__        = "https://your.host/openhipp0-latest.apk";
</script>
```

Inject this snippet before the main script tag at deploy time (template substitution from CI, or a simple sed in your deploy script).

---

## 4. Dev-mode connection

For early testers on LAN / Tailscale, the app needs to know how to reach your server. The onboarding wizard covers four transports:

1. **Tailscale** (recommended) — install Tailscale on server + phone, both appear on the same tailnet, done.
2. **Cloudflare Tunnel** — `cloudflared tunnel --url http://localhost:3100` gives a public HTTPS URL.
3. **Relay** — run `@openhipp0/relay` on any $5 VPS, set both sides to it. E2E encrypted, relay never sees plaintext.
4. **LAN-only** — works if phone + server share Wi-Fi.

Pairing then happens via QR scan from the dashboard ("Pair Mobile Device" → shows QR). Full flow lives in `packages/mobile/README.md`.

---

## 5. Widgets on a sideloaded install

Widgets work the same on sideloaded apps as on App Store apps — the OS doesn't distinguish. The only gotcha: on iOS, the App Group entitlement (`group.com.openhipp0.mobile`) has to be present in the IPA's embedded provisioning profile. EAS handles this automatically when you ship via TestFlight; for ad-hoc IPAs you'll need the entitlement in your dev provisioning profile too.

---

## 6. Updates

EAS ships OTA updates for JS-only changes via `eas update --channel sideload`. Widget binary changes, new native modules, and config-plugin edits require a full rebuild + reinstall.

We intentionally keep the sideload channel separate from the `preview` / `production` EAS channels so OTA updates don't accidentally cross-pollinate between distribution channels.

---

## 7. Compliance notes

- **Apple terms:** TestFlight for a self-hosted client is explicitly allowed. Sideloaded IPAs are a gray area for commercial distribution — fine for free OSS, ambiguous at scale for paid apps.
- **Google terms:** Sideloading is explicitly supported. Users must tap past a Play Protect warning on first install; this is normal for non-Play apps.
- **Enterprise Apple distribution** (`$299/yr` program) is **not** an option for a publicly distributed OSS app; Apple revokes certs used that way.
