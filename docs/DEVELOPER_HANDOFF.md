# Developer Handoff — Open Hipp0

> **Status as of 2026-04-16:** Phases 1–18 feature-complete. 943 vitest tests
> + 6 Playwright e2e checks + 23 Python SDK tests. Clean lint, clean TypeScript
> build, clean docker-compose build. Read this document + `CLAUDE.md` at the
> repo root before touching anything.

This is a hand-off from the implementation team to future maintainers. It
covers the current state, architecture, conventions, known gaps, and the
shortest path from "I just cloned the repo" to "I shipped a feature."

---

## 1. The 30-second pitch

Open Hipp0 is a local-first, open-source autonomous AI agent platform. It
competes with OpenClaw on:

1. Decision graph + self-learning memory (not just chat history).
2. Self-healing reliability engine (watchdog, safe updates, circuit
   breakers).
3. Security-first execution (Docker sandbox, policy engine, per-path +
   per-domain allow-lists).
4. Multi-agent orchestration (specialized teams, not one monolith).
5. Execution governance (preflight validation, human-in-the-loop approvals).

Ship target: `npm install -g @openhipp0/cli && hipp0 init` → running in
under 3 minutes.

---

## 2. Where things live

```
open-hipp0/
├── packages/                      # pnpm workspace, every package @openhipp0/*
│   ├── core/                      # foundational — runtime + LLM + tools + auth
│   │   └── src/
│   │       ├── llm/               # Provider abstraction, retry, circuit breaker
│   │       ├── tools/             # Tool registry, Zod validators, sandbox
│   │       ├── agent/             # AgentRuntime loop
│   │       ├── skills/            # agentskills.io format, loader + registry
│   │       ├── security/          # Policy engine, governance, approvals
│   │       ├── orchestrator/      # Multi-agent router, team configs
│   │       ├── browser/           # Phase 9 Playwright-backed browser engine
│   │       ├── auth/              # Phase 10 OAuth2 + PKCE + TokenStore
│   │       ├── integrations/      # Phase 10 + 17 — 20 skill tool factories
│   │       ├── media/             # Phase 11 — Whisper/TTS/DALL-E/vision
│   │       ├── enterprise/        # Phase 14 — RLS / SSO / org / audit / API keys
│   │       └── training/          # Phase 15 — trajectory export + batch runner
│   ├── memory/                    # Decision graph, user model, recall, connectors
│   │   └── src/connectors/        # Phase 16 Notion/Linear/Slack/GH-PR/Confluence
│   ├── bridge/                    # Messaging: Discord/Telegram/Slack/Web/CLI
│   │   └── src/                   # + Phase 13 Signal/Matrix/Mattermost/Email/SMS/
│   │                              #   WhatsApp-Business/Home-Assistant
│   ├── scheduler/                 # Heartbeat cron + natural-language schedule
│   ├── watchdog/                  # Self-healing: health checks, safe updates
│   ├── dashboard/                 # React 19 + Tailwind v4 + Vite web UI
│   ├── cli/                       # `hipp0` CLI (commander.js)
│   ├── sdk/                       # External TypeScript SDK
│   ├── mcp/                       # Phase 8 — Model Context Protocol server
│   └── e2e/                       # Cross-package + Playwright e2e tests
├── python-sdk/                    # Phase 8 — 6 Python packages on PyPI
├── skills/                        # agentskills.io manifests (20 skills shipped)
├── deployment/                    # Dockerfile, compose, cloud-init, homebrew
├── docs/                          # All md docs (architecture, cli, api, …)
├── scripts/                       # install.sh + test-python.sh
└── CLAUDE.md                      # Decision log — read this first
```

**Package boundaries are enforced by convention.** The matrix in `CLAUDE.md`
shows who may import from whom. TL;DR:

- `core` imports from nothing (foundational).
- `memory` imports only from `core`.
- `bridge` imports only from `core`.
- `watchdog` runs independently — nothing else imports from it.
- `dashboard` imports only from `sdk`.
- `cli` imports from core + memory + scheduler + watchdog (not dashboard).

---

## 3. Running the thing locally

```bash
# 1. One-time setup
corepack enable
pnpm install                       # installs every workspace + node_modules/

# 2. Validate your checkout
pnpm -r build                      # 0 errors across 10 packages
pnpm -r test                       # 943 tests passing
pnpm -r lint                       # 0 warnings / 0 errors
bash scripts/test-python.sh        # 23 Python tests passing

# 3. Start the HTTP server (binds :3100)
node packages/cli/bin/hipp0.js serve
#   or, with the WebSocket chat endpoint attached:
HIPP0_WITH_WS=1 node packages/cli/bin/hipp0.js serve

# 4. Start the dashboard dev server (defaults to http://localhost:5173)
pnpm --filter @openhipp0/dashboard dev
#   Dashboard proxies /ws + /health to http://127.0.0.1:3100 by default —
#   override with HIPP0_SERVE_URL.

# 5. Smoke-test
curl http://localhost:3100/health  # { status: "ok", uptime: <s>, … }

# 6. (Optional) Run the Playwright sweep
cd packages/e2e
pnpm exec playwright test          # 6 phase-sweep checks, headless chromium
```

---

## 4. Conventions to respect

### Code

- **Strict TypeScript.** `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `strict: true`. No `any` except at documented API boundaries (always
  paired with a Zod validator).
- **ESM-only.** Every `import` uses a `.js` suffix on relative paths
  (canonical Node ESM). `moduleResolution: "Bundler"`.
- **Named exports.** Avoid default exports except for external-library
  CJS interop (see `packages/bridge/src/slack.ts` for the pattern).
- **Zod validates every boundary.** Every tool has `validator: z.object…`.
  Every config file is validated by a Zod schema at load time.
- **Error classes are `Hipp0`-prefixed + extend `Hipp0Error`.** `cause` is
  `override readonly cause: unknown` when a subclass narrows it.
- **Structured logging via Pino.** Never log secrets (API keys, session
  tokens, full user messages that might contain PII).

### Testing

- **Every export has a test.** 80 % coverage target per package.
- **External APIs are always mocked** via an injected `fetch` (or SDK
  client). Real-API tests live behind `test.skipIf(!process.env.XXX_KEY)`.
- **Tests live next to the code** under `packages/<name>/tests/**/*.test.ts`.
  Vitest picks up `*.test.ts`; Playwright picks up `*.spec.ts` — they
  don't collide.
- **Integration tests hit a real SQLite in-memory DB** (Phase 7c).
  Postgres integration tests run in CI against `pgvector/pgvector:pg17`.

### Security

- **Deny-by-default for fs / shell / network.** Hardcoded blocked paths
  cannot be unlocked by any policy: `~/.ssh`, `~/.aws`, `~/.gnupg`,
  `~/.hipp0/secrets`.
- **Docker sandbox** by default for `shell.execute`. Native mode is
  opt-in.
- **Credential vault** (`@openhipp0/core` browser module) stores
  per-site logins AES-256-GCM at rest, scrypt KDF.
- **Per-agent API keys** are SHA-256 hashed; plaintext is returned
  exactly once.
- **Postgres RLS policies** enforce tenant + project isolation at the
  row level. SQLite is single-tenant by design.

---

## 5. Phase-by-phase summary

> See `CLAUDE.md` for the full decision log. This is a signpost index.

| Phase | Shipped | Notes |
|------:|---|---|
|  1a  | Repo skeleton | Turbo v2, pnpm 10, tsconfig.base.json with `noUncheckedIndexedAccess`. |
|  1b  | Tooling + CI + pg | ESLint 9 flat config, vitest workspace, pgvector:pg17 in compose. |
|  1c  | Package skeletons | 8 packages, identical shape. Boundaries enforced by convention. |
|  1d  | Memory DB | Drizzle + SQLite; FTS5 via raw SQL + triggers. UUID PKs, ISO timestamps. |
|  1e  | LLM abstraction | Anthropic/OpenAI/Ollama providers, faux-streaming, ProviderFactory injection. |
|  1f  | Tool engine | Tool registry, permissions, Docker/native sandbox, path/domain guards. |
|  1g  | Agent runtime | Main loop, stop conditions, MemoryAdapter interface. |
|  2a–f | Decision graph | Embeddings, contradiction detection, H0C compression, user model, recall, adapter. |
|  3a–d | Bridges | Reconnect supervisor, outbound queue, CLI/Web/Discord/Telegram/Slack, Gateway. |
|  4a–e | Watchdog | Process/health/safe-updates/breakers/predictors. |
|  5.1–3 | Skills + security | agentskills.io format, policy engine, governance + approvals. |
|  6.1–2 | Scheduler + orchestrator | Minimal cron parser, skill-based routing. |
|  7a–d | CLI + dashboard | commander CLI, React 19 dashboard (Home + Chat interactive, rest shells). |
|  8.1–5 | Integration + launch | E2E harness, MCP server, Python SDK, 13 docs, Docker/compose/DO/Railway. |
|  9 | Browser automation | BrowserEngine + 6 tools + credential vault + stealth. Playwright peer dep. |
| 10 | OAuth2 + 4 integrations | `auth/`, brave + github + gmail + linear. |
| 11 | Media + runtime gap | MediaEngine (Whisper/TTS/DALL-E/vision), package.json#main → dist/, slack CJS fix. |
| 12 | Migration tools | `hipp0 migrate openclaw` + `hipp0 migrate hermes` — dry-run default, backup, idempotent. |
| 13 | 7 more bridges | Signal/Matrix/Mattermost/Email/SMS/WhatsApp-Business/Home-Assistant (transport-injected). |
| 14 | Enterprise | RLS, SAML+OIDC, Organizations, audit export, per-agent API keys. |
| 15 | Training pipeline | Trajectory JSONL, SFT/DPO/Atropos, compress, batch runner. |
| 16 | Connectors | Notion/Linear/Slack/GitHub-PR/Confluence — dedup on (url, hash). |
| 17 | 15 more integrations + e2e + docs | Outlook/Apple-Cal/GCal/Notion/Obsidian/Trello/Drive/Dropbox/Jira/HA/Hue/Spotify/Twilio/Mattermost/Todoist. |
| 18 | Install + onboarding | scripts/install.sh, cloud-init, homebrew, `hipp0 update` with auto-rollback. |

---

## 6. Runtime environment variables

Every knob that changes behavior lives in an env var. Full list:

```
HIPP0_HOME             Base config dir (default: ~/.hipp0)
HIPP0_PORT             HTTP port for hipp0 serve (default: 3100)
HIPP0_HOST             HTTP bind host (default: 0.0.0.0)
HIPP0_WITH_WS          When set (1/true/yes/on), hipp0 serve attaches a WebBridge on /ws
HIPP0_DEFAULT_MODEL    Seed default LLM model for init wizard
HIPP0_VERSION          Pin CLI version in install.sh
HIPP0_SERVE_URL        Dashboard dev-mode /ws + /health proxy target
SKIP_ONBOARD           install.sh — skip interactive wizard
INSTALL_DAEMON         install.sh — install systemd/launchd service
NONINTERACTIVE         install.sh — forces non-interactive mode

# Provider auth (used by integrations):
ANTHROPIC_API_KEY
OPENAI_API_KEY
HIPP0_BRAVE_API_KEY
HIPP0_LINEAR_KEY
HIPP0_TODOIST_TOKEN
NOTION_TOKEN
TRELLO_API_KEY + TRELLO_TOKEN
DROPBOX_ACCESS_TOKEN
JIRA_EMAIL + JIRA_API_TOKEN
HOMEASSISTANT_TOKEN
HUE_APPLICATION_KEY
TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM
MATTERMOST_TOKEN
TELEGRAM_BOT_TOKEN, DISCORD_BOT_TOKEN, SLACK_BOT_TOKEN, SLACK_APP_TOKEN

HIPP0_TOKENSTORE_KEY   Master key for encrypted OAuth TokenStore at rest
```

---

## 7. Known gaps + deferred work

These are the honest "not quite done" items. Reach here before shipping
new features that depend on them.

### 🟡 Medium priority

1. **Dashboard pages 3–10 are shells** (Agents, Memory, Skills, Scheduler,
   Health, Costs, Audit, Settings). Home + Chat are interactive; the rest
   print "connect via CLI" messages. Wiring them up needs the REST API
   surface (see 2 below).
2. **REST API surface is GET /health only.** The Python SDK targets a
   richer shape (`/api/decisions`, `/api/memory/…`) that hasn't been
   implemented. Scope is intentionally deferred — auth model +
   pagination + webhooks are big design decisions. See the decision-log
   entry under Phase 8.
3. **Echo responder on `/ws` is a placeholder.** Wiring a real
   AgentRuntime-backed Gateway (so the dashboard chat actually runs the
   agent) is the next natural step. `hipp0 serve --with-ws` makes the
   plumbing available; the caller has to pass `onMessage` that routes
   through `Gateway + AgentRuntime + LLMClient`.
4. **15 Phase-17 integrations ship in a single bundled file**
   (`packages/core/src/integrations/phase17.ts`). They work and they're
   tested, but splitting them into per-integration subdirs (matching
   brave/github/gmail/linear) would be a cleaner maintenance surface.
5. **OpenClaw-specific claims in docs are unverified.** The decision log
   flags this — founder / CVEs / rename history must be sanity-checked
   via WebSearch before appearing user-facing.

### 🟢 Low priority / observability nits

6. Vitest globals aren't set in every package — some tests import
   `describe/it/expect` explicitly; others rely on global.
7. `packages/dashboard` uses esbuild's JSX transform in test mode to
   work around vite version skew. If vitest + vite realign, switch back
   to `@vitejs/plugin-react`.
8. `@slack/bolt` is CJS — Phase 11 fixed the named-import via
   default + destructure. Other CJS packages added later should follow
   the same pattern.
9. Homebrew formula is a skeleton — the real one lives (or will live) in
   `openhipp0/homebrew-tap`.

### 🔴 None known blocking

No known bugs that block `hipp0 serve` + `hipp0 doctor` + `hipp0 migrate`
+ `hipp0 init --non-interactive` from working end-to-end.

---

## 8. Add-a-feature cheat sheet

### Add a new skill / integration (~120 LOC)

1. `packages/core/src/integrations/<name>/tools.ts` — tool factories
   using `fetchWithRetry`, `_helpers.ts` (`httpErr`, `missingKey`,
   `runSafely`). Follow `todoist/tools.ts` as a template.
2. Export from `packages/core/src/integrations/index.ts`.
3. Create `skills/<slug>/{manifest.json, SKILL.md}` — copy `skills/gmail/`.
4. Add 3+ tests in `packages/core/tests/integrations/<name>.test.ts`
   mocking `fetch`: missing-credential, happy-path, HTTP error.
5. `pnpm --filter @openhipp0/core test integrations/<name>` + `hipp0
   skill audit`.

### Add a new bridge (~150 LOC)

1. `packages/bridge/src/<name>.ts` implementing `MessageBridge`.
   Inject the SDK/transport so tests don't need the real SDK. Copy the
   shape from `signal.ts`.
2. Export from `packages/bridge/src/index.ts`.
3. Add 3+ tests in `packages/bridge/tests/<name>.test.ts` (or the
   consolidated `phase13-bridges.test.ts`).
4. Extend the `Platform` union in `packages/bridge/src/types.ts` with
   the new identifier.

### Add a new watchdog check (~80 LOC)

1. `packages/watchdog/src/health/checks/<name>.ts` implementing
   `Check` interface. Copy from an existing check.
2. Register via `healthRegistry.register(new <Name>Check(...))` at
   runtime.

---

## 9. Release / deployment

### Docker

```bash
docker compose -f deployment/docker-compose.prod.yml build
docker compose -f deployment/docker-compose.prod.yml up -d
curl http://localhost:3100/health        # should return ok
```

The image runs `hipp0 serve` as a non-root user with a volume-mounted
`~/.hipp0`. HEALTHCHECK probes `/health`.

### Install scripts

- `scripts/install.sh` — Linux/macOS/WSL/Termux, idempotent,
  cloud-init friendly.
- `deployment/cloud-init.yaml` — one-click VPS bootstrap (DigitalOcean,
  Hetzner, Linode, Vultr, AWS, GCP).
- `deployment/homebrew-formula.rb` — macOS formula skeleton.

### npm publish flow

Each `@openhipp0/*` package is independently versioned. CI publishes
on tagged commits. Currently `0.0.0` across the board because nothing
has been published yet — when you do the first release, bump all
packages to the same semver (choose `0.1.0` or `1.0.0`) to keep the
story simple.

---

## 10. Common pitfalls

- **Port 3100 might be busy** on your dev machine. Override with
  `HIPP0_PORT=3150`.
- **TypeScript complains about `process.env['FOO']` vs
  `process.env.FOO`:** we use bracket access everywhere because
  `noUncheckedIndexedAccess` requires it and we don't pollute the
  `NodeJS.ProcessEnv` type.
- **"hipp0 serve cannot load src/index.ts":** rebuild first. `package.json
  #main` points at `dist/index.js`; native Node can't load `.ts`. `pnpm
  -r build` fixes it. Vitest + tsx + ts-node handle the `development`
  export condition and read `src/` directly, so tests don't need the
  build step.
- **Dashboard chat `Status: closed`:** the server wasn't started with
  `HIPP0_WITH_WS=1`. Restart with it.
- **Playwright can't find chromium:** `npx playwright install chromium`
  (the e2e package ships `@playwright/test` as a devDep).
- **Memory tests failing with "database is locked":** a stray in-memory
  DB from a crashed previous run is still bound. Run `pnpm --filter
  @openhipp0/memory test` in isolation or add
  `testIsolation: 'strict'` in vitest.config.

---

## 11. Who to ask + further reading

- `CLAUDE.md` — ~100 decision-log entries, phase-by-phase. Read this
  whenever you're tempted to make a non-trivial architecture call.
- `docs/architecture.md` — system diagram + dataflow.
- `docs/cli.md` — every CLI command + option.
- `docs/api-reference.md` — the contract the Python SDK targets (not
  yet implemented, but documented).
- `docs/security.md` — threat model + mitigations.
- `docs/self-hosting.md` — production deployment playbook.
- `docs/enterprise.md` — RLS / SSO / org model / audit / API keys.
- `docs/training-data.md` — how to fine-tune a model on trajectories.
- `docs/voice-media.md` — Phase 11 media subsystem.
- `docs/browser-automation.md` — Phase 9 browser engine.
- `docs/integrations.md` — catalog of all 20 shipped skill integrations.
- `docs/migration-from-openclaw.md` + `docs/migration-from-hermes.md` —
  user-facing migration guides.
- `docs/skills-guide.md` — how to author a skill.
- `docs/troubleshooting.md` — symptoms → fixes.
- `docs/framework-guides/` — per-framework Python SDK guides
  (CrewAI / LangGraph / LangChain / AutoGen / OpenAI Agents).

If a doc conflicts with code, **trust the code**. Documentation drift is
the biggest landmine in a codebase this size. When you notice it, fix
the doc in the same PR as the code change.

---

## 12. Final sanity gate

Before marking any change "done", make sure all of the following pass:

```bash
pnpm -r build                      # 0 errors
pnpm -r typecheck                  # 0 errors
pnpm -r lint                       # 0 warnings / 0 errors
pnpm -r test                       # 0 failures, 943+ tests
bash scripts/test-python.sh        # 23+ Python tests
cd packages/e2e && pnpm exec playwright test   # 6+ sweep checks
docker compose -f deployment/docker-compose.prod.yml build   # image builds clean
```

**And then paste the actual output into your PR description.** No "I
think it passes" — the CLAUDE.md rules require real output.

---

Good luck. Measure twice, cut once. 🦛
