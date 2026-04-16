# deployment/mobile-install/

Static landing page for `https://install.openhipp0.com` (or wherever you host it). UA-detects iOS vs Android and surfaces the right CTA.

Full operator guide: [`docs/mobile-install.md`](../../docs/mobile-install.md).

**Files**

- `index.html` — the landing page. Plain HTML + inline CSS, no build step.
- `SIGNING.txt` — placeholder for the Android release-keystore fingerprint.
- Expected siblings at deploy time (copied in by your release pipeline):
  - `openhipp0-latest.apk` — signed Android APK
  - `openhipp0-latest.ipa` — signed iOS IPA (for AltStore / Sideloadly fallback)

**Deploy**

```bash
# Any static host — Cloudflare Pages example:
wrangler pages deploy deployment/mobile-install --project-name openhipp0-install

# Or GitHub Pages — push this dir to a gh-pages branch.
```

At deploy time, inject the three URLs the page expects:

```html
<script>
  window.__HIPP0_TESTFLIGHT_URL__ = "https://testflight.apple.com/join/XXXXXX";
  window.__HIPP0_IPA_URL__        = "https://install.openhipp0.com/openhipp0-latest.ipa";
  window.__HIPP0_APK_URL__        = "https://install.openhipp0.com/openhipp0-latest.apk";
</script>
```
