# Stealth approach — research + recommendation (G1-e)

**Context:** Operators need the browser to look less like a bot on sites
that run fingerprint-based detection. We evaluated four approaches
against our constraints:

1. **Playwright-extra + `puppeteer-extra-plugin-stealth`** — baseline.
2. **Camoufox** — Playwright-compatible Firefox fork with
   anti-fingerprinting + WebRTC/Canvas/WebGL noise baked in.
3. **Patchright** — Playwright patched at the protocol layer to remove
   automation beacons (e.g. `navigator.webdriver`).
4. **undetected-playwright patterns** — runtime injection of the same
   class of patches, without a forked binary.

## Evaluation grid

| Criterion | playwright-extra-stealth | Camoufox | patchright | undetected-playwright |
|---|---|---|---|---|
| Engine | Chromium | **Firefox fork** | Chromium | Chromium |
| Install footprint | npm package | separate binary (~200 MB) | `pip install patchright` + replaces Playwright | npm + runtime patches |
| Covers `navigator.webdriver` | ✓ | ✓ | ✓ | ✓ |
| Canvas / WebGL / Audio noise | partial (configurable) | **✓ strong** | ✗ by default | partial |
| Font enumeration defense | partial | **✓** | ✗ | partial |
| WebRTC IP leak defense | ✓ | **✓** | ✗ | ✓ |
| Real browsing-profile fingerprint entropy | medium | **high** | medium | medium |
| Works with our BrowserDriver abstraction | ✓ (drop-in) | **requires engine switch** | requires npm replacement | ✓ (drop-in) |
| Upstream maintenance | active | active | active (newer) | unmaintained since 2024 |
| Python-only? | No | No | **Yes** | No |

## Decision

**Ship playwright-extra + `puppeteer-extra-plugin-stealth` as the G1-e
baseline.** Two reasons:

1. It covers the fingerprint surface that our pinned detection fixture
   set (bot.sannysoft, creepjs, pixelscan, BotD, intoli, antoinevastel)
   actually measures. Operators who need strictly more can layer our
   `FingerprintV2` overrides on top (Canvas/WebGL/Audio noise).
2. It's the only option that stays Chromium-on-Node without replacing
   the Playwright install or shipping a separate binary.

**Camoufox is filed as BFW-006.** Worth revisiting if our fixture-set
results on Camoufox beat baseline-plus-overrides by a meaningful margin
after we can measure both side by side.

**Patchright is rejected** — it's Python-only and replaces the
Playwright install, which breaks every existing `@openhipp0/core/browser`
consumer.

**undetected-playwright patterns are out of scope** — unmaintained
since 2024, and the patches they apply are already in the
`puppeteer-extra-plugin-stealth` stack.

## ja3 / TLS fingerprint matching (G1.7b)

Stock Chromium uses the Chrome TLS client signature (a specific `ja3`
hash). A non-patched `playwright-extra-stealth` run produces that same
signature by default — **so baseline is not inherently ja3-divergent**.
The problem surfaces when operators route through anti-bot sidecars
like `curl-impersonate`, Go-based HTTP clients, or corporate proxies
that rewrite the TLS handshake.

**G1.7b ships as an opt-in sidecar**: a caller can set
`HIPP0_BROWSER_TLS_PROXY=<proxy-url>` pointing at a
`curl-impersonate`-backed proxy that speaks real Chrome TLS. The browser
connects through the proxy for target traffic (control plane is
unaffected). No Chromium patching; no per-OS native code. Documented as
a deployment-time choice rather than a code dependency.

## Fixture set (pinned for CI regression)

All pinned by URL + html snapshot under
`packages/browser/tests/stealth/fixtures/`:

- `bot.sannysoft.com/`
- `creepjs`
- `pixelscan.net`
- `BotD`
- `intoli` headless-chrome tests
- `antoinevastel.com/bots/`
- `internal/*` — anonymized patterns derived from real-world blocker tech

CI runs the fixture HTML against our injected fingerprint overrides +
behavior engine and asserts:

- **Fingerprint entropy** within ±2 bits of a real Chrome install
- **Detection fixture score** ≥ 0.85 (pass/known-good fraction)

See `packages/browser/src/stealth/fixture-runner.ts` for the runner
and `tests/stealth/fixtures.test.ts` for the assertions.

## Follow-up

Tracked in `docs/browser/followups.md`:

- **BFW-006** Camoufox evaluation against pinned fixture set (if results
  justify an engine switch or second engine option).
- **BFW-007** Real `playwright-extra` adapter wiring. G1-e ships the
  strategy + descriptor + addInitScript generator; the actual
  `playwright-extra.addPlugin(...)` wiring happens when the CLI adds
  a `--stealth` flag for production operators.
