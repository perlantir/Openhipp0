# Browser Automation (Phase 9)

Open Hipp0's browser engine lives at `packages/core/src/browser/`. The goal
is "anything a human can do in a browser": navigate, read the accessibility
tree, click, type, extract data, download files, solve auth flows, and
recover from page-layout changes.

## Three-layer architecture

```
Layer 3  NATURAL LANGUAGE PLANNER (LLM)
         "Book a table at Nobu for 2 at 8pm" → step plan + progress tracking
Layer 2  ACTION ENGINE
         accessibility tree + vision fallback + form auto-fill + auth + captcha
Layer 1  BROWSER RUNTIME (Playwright, lazy-loaded)
         Chromium / Firefox / WebKit, persistent contexts, network interception
```

## Quick start

```ts
import { BrowserEngine, ScriptedPlanner } from '@openhipp0/core';

const engine = new BrowserEngine({
  // BrowserDriver is injectable — tests pass a fake; production uses Playwright.
  driver: await makePlaywrightDriver(),
});
await engine.start();

const plan = new ScriptedPlanner().heuristicPlan(
  'Go to https://news.ycombinator.com and list the top 5 posts',
);
const result = await engine.executePlan(plan);
await engine.stop();
```

## Registered tools

The browser engine registers six `browser_*` tools via `ToolRegistry`:

- `browser_navigate(url)`
- `browser_click(ref)` — `ref` is a `@eN` id from the accessibility tree
- `browser_type(ref, text)`
- `browser_screenshot()` → PNG bytes
- `browser_extract(pattern)` → CSS-selector extraction
- `browser_state()` → current PageState (URL, title, interactive elements)

All six require the `browser.use` permission (added to the permission union
in Phase 9). Policies gate tool use by default.

## Credential vault

Per-site credentials are stored with AES-256-GCM encryption under
`~/.hipp0/browser-vault/`. Vault master-key is derived via scrypt from a
user-supplied passphrase or (on macOS/Linux with libsecret) from the
system keychain.

```ts
import { CredentialVault } from '@openhipp0/core';

const vault = await CredentialVault.open({ passphrase: process.env.HIPP0_VAULT_KEY! });
await vault.store('amazon.com', { username, password, totp_secret });
const creds = await vault.get('amazon.com'); // null if not stored
```

## Stealth + anti-detection

`packages/core/src/browser/stealth.ts` ships fingerprint jitter, Bezier
mouse movements, and variable typing speeds. Not a silver bullet — run
against a few real bot-detection test sites before relying on it.

## Playwright as a peer dep

`playwright` is a **peer** dependency on `@openhipp0/core` so it isn't
installed automatically. Hosts that want real browser automation add it
themselves:

```bash
pnpm add playwright
npx playwright install chromium
```

Without Playwright installed, the BrowserEngine throws a clear error with
the fix on first `start()` call.
