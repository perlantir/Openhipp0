# Open Hipp0 — Handoff Prompt for Phases 11–18

Paste the block below into a new Claude Code session to continue the build
from where Phases 8/9/10 left off. Everything above the `═══` fence is
context; everything below is the actual work queue.

---

## Current state snapshot (as of the last session)

**Repo:** `/root/open-hipp0` — TypeScript + pnpm monorepo, `type: module`, Node 22.
**Branch / HEAD:** `main`. Read `git log -10 --oneline` in the first session turn.
**Test count:** 781 passing across 10 workspace packages + 6 Python packages.
Run `pnpm -r test` to verify before you touch anything.

### Completed phases

- **1–7** — core runtime, memory, bridges, scheduler, watchdog, CLI, dashboard.
- **8** — E2E harness (`@openhipp0/e2e`), MCP server (`@openhipp0/mcp`),
  Python SDK (6 packages under `python-sdk/`), 13 docs, Docker + Compose +
  DO + Railway + GitHub Actions.
- **9** — Browser automation core under `packages/core/src/browser/`
  (engine + page analyzer + action executor + credential vault + stealth +
  6 `browser_*` tools + scripted planner).
- **10** — OAuth2 foundation (`packages/core/src/auth/`) + 4 representative
  integrations (brave / github / gmail / linear) under
  `packages/core/src/integrations/` and `skills/`.

### Known runtime gap (blocker for production `hipp0 serve`)

Every workspace `package.json#main` still points at `src/index.ts`, which
native Node can't load (tsx and vitest can). Plus
`packages/bridge/src/slack.ts` does a CJS named-import from `@slack/bolt`
that only esbuild handles.

Fix in Phase 11 or 17:
1. Shift each `package.json` to `"main": "./dist/index.js"` +
   `"exports": {".": {"development": "./src/index.ts", "default": "./dist/index.js", "types": "./dist/index.d.ts"}}`.
2. Change `packages/bridge/src/slack.ts` to `import bolt from '@slack/bolt'; const { App } = bolt;`.
3. Verify `node packages/cli/bin/hipp0.js serve` binds :3100 and
   `curl localhost:3100/health` returns `{status:"ok"}`.

### Conventions that carry forward

- **Package boundaries** are enforced by convention (see CLAUDE.md table).
  Don't cross them.
- **Every export has a test.** 80% coverage target per package.
- **Hipp0-prefixed error classes** extending `Hipp0Error`.
- **Zod validators at every API boundary.**
- **`.js` suffix on relative imports** (canonical Node ESM).
- **No `any`** except at API boundaries (documented + Zod-validated).
- **Deny-by-default** for FS / shell / network. Hardcoded blocked paths:
  `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.hipp0/secrets`.
- **Tests mock external APIs.** Real-API tests live behind `test.skipIf(!process.env.XXX)`.
- **Never log secrets.**

### Decision log

`CLAUDE.md` at the repo root holds ~80 architectural decisions spanning
Phases 1a → 10. Read it before making new decisions; append new ones at
the end of the Decision Log section using the documented format.

═══════════════════════════════════════════════════════════════════════════

## Work queue (paste this part into a fresh Claude Code session)

```
# OPEN HIPP0 — CONTINUATION PROMPT (Phases 11–18)
# Start at /root/open-hipp0. cd there and `cat CLAUDE.md` before touching anything.
# Respect every convention above. Same build rules as Phase 1:
#   - Sequential sub-tasks inside a phase; commit per logical unit.
#   - Phase gates are pass/fail — 0 lint/typecheck/build/test errors allowed.
#   - Wait for approval between phases.
#   - 3-strike blocker rule: after 3 failed attempts, STOP and ask.
#   - Never skip a failing test to make the gate pass.

## Phase 11 — Voice + Media
Build under packages/core/src/media/ (or a new @openhipp0/media package):
  - Whisper transcription (OpenAI API provider + whisper.cpp fallback).
    Accept an audio file path or Buffer; return { text, language, duration }.
  - TTS (OpenAI /v1/audio/speech as primary + optional local stub). Return
    { audio: Buffer, mimeType }.
  - Image generation (DALL-E 3 through /v1/images/generations) — return
    { url | b64, prompt }.
  - Image understanding — call the Claude / GPT-4o vision endpoints over
    an inline image; return a structured description.
  - Bridge integration: Telegram + Discord + WhatsApp voice-message
    handlers pass the audio to Whisper and inject the transcript as
    IncomingMessage.text; file attachments pass through vision.
  - Tests with mocked providers. Real-API tests skipped behind env vars.

Also fix the hipp0-serve runtime gap here (see 'Known runtime gap' above).
Gate: pnpm test (0 failures), pnpm build, docker compose build, and the
new `hipp0 serve` binary actually binds :3100.

## Phase 12 — Migration Tools (OpenClaw + Hermes → Open Hipp0)
Build packages/cli/src/commands/migrate-openclaw.ts + migrate-hermes.ts.
  - Auto-detect ~/.openclaw/, ~/.clawdbot/, ~/.moltbot/, ~/.hermes/.
  - Presets: --preset full | user-data. --dry-run default when non-interactive.
  - Non-destructive: never modify source files. Always backup first under
    ~/.hipp0/migration-<timestamp>/.
  - File mapping: see docs/migration-from-openclaw.md — SOUL.md, MEMORY.md,
    USER.md, IDENTITY.md, skills/, memory/, openclaw.json, env keys, cron.
  - Re-embed imported memory after migration.
  - During `hipp0 init`, auto-detect + offer import.
  - Tests: create a mock OpenClaw directory tree, migrate, verify.

Gate: migration dry-run preview exactly matches the real migration's
writes; real migration is idempotent on a second run.

## Phase 13 — Additional Bridges
Under packages/bridge/src/:
  - Signal (signal-cli, SignalBridge)
  - Matrix (matrix-js-sdk)
  - Mattermost (REST + WebSocket)
  - Email (IMAP poll + SMTP send)
  - SMS (Twilio webhook + REST)
  - WhatsApp Business API (Meta Cloud API; existing whatsapp-web.js stays
    as the unofficial option)
  - Home Assistant (WebSocket API, bidirectional events)
Each bridge must implement the existing MessageBridge interface, support
auto-reconnect, and have ≥3 unit tests with an injected SDK handle.

## Phase 14 — Enterprise
  - Multi-tenant row-level security (Postgres RLS policies on tenant_id +
    project_id; per-request session reset). Document the migration path
    from SQLite single-tenant.
  - SSO: SAML 2.0 + OIDC. JIT provisioning. Add samlify + openid-client.
  - Org/team model: organizations + memberships + roles
    (owner/admin/member/viewer). Dashboard pages.
  - Audit export: CSV/JSON/SIEM endpoints.
  - Per-agent API keys with rotation + revocation + last-used tracking.

## Phase 15 — Training Data Pipeline
Under packages/core/src/training/ or a new @openhipp0/training package:
  - Trajectory export — JSONL with { messages, tool_calls, tool_results,
    decisions_active_at_time, skills_loaded, user_model_state, outcome }.
  - Batch runner: spawn N agents through a task list with checkpointing.
  - Compression — drop redundant context, keep decision-relevant turns.
  - Atropos RL compatibility (Nous Research format).
  - SFT + DPO data-prep scripts. Integrates with transformers / axolotl.

## Phase 16 — Hipp0-Style Connectors
Pull decisions from external knowledge bases into the decision graph.
Under packages/memory/src/connectors/:
  - Notion: OAuth2, paginate pages/databases, pipe through the distillery
    (memory.learning.extractFacts + memory.decisions.createDecision).
  - Linear: issues + comments + resolution notes. Filter by team/state.
  - Slack: channel backfill + real-time webhook. Decision extraction from
    threaded discussions.
  - GitHub PRs: PR diffs + descriptions + review comments. Webhook-driven.
  - Confluence / generic wiki: meeting notes, ADRs.
All connectors dedupe on (source-url, content-hash) so repeat sync doesn't
explode the graph.

## Phase 17 — Final integration + polish
  - Cross-phase e2e scenarios in packages/e2e/tests/:
      migration → usage, browser + memory, voice → browser → approval,
      multi-agent + integrations, scheduled browser task, connector →
      memory → agent, self-healing during browser task.
  - Performance: profile hot paths; lazy-load browser/voice engines.
  - Security audit: credential vault, stealth fingerprint, OAuth handling,
    migration secret leakage.
  - Update ALL docs (docs/browser-automation.md, docs/integrations.md,
    docs/migration-from-*.md, docs/voice-media.md, docs/enterprise.md,
    docs/training-data.md).
  - Production Docker images with Playwright browsers + Whisper deps
    (beefier image — document resource requirements).

## Phase 18 — One-click install + onboarding
  - scripts/install.sh — single bash, detects platform, installs deps
    (Node 22 via nvm if missing, pnpm via corepack, git, optional Docker),
    runs `npm install -g @openhipp0/cli`, auto-detects ~/.openclaw/ +
    ~/.hermes/ and offers import, launches the onboarding wizard.
  - SKIP_ONBOARD=1 + INSTALL_DAEMON=1 for unattended installs.
  - Docker one-liner documented in README.
  - Cloud-init template for VPS bootstrap.
  - Platform installers: Homebrew formula (skeleton), apt repo docs, Termux.
  - Interactive onboarding wizard (5 steps): LLM provider → bridges →
    security level → personality → existing-agent import. Post-install
    `hipp0 doctor` auto-run.
  - `hipp0 update` — backup, migrate, smoke-test, rollback-if-bad.
  - Gate: `docker run --rm -it ubuntu:24.04 bash -c '... | SKIP_ONBOARD=1 bash && hipp0 --version'` must exit 0.

## Final integration list (remaining from Phase 10)
Before marking Phase 17 complete, add skills for each of these using the
brave / github / gmail / linear pattern (same file shape, ~120 lines each):

  Outlook          Apple Calendar (CalDAV)
  Google Calendar  Notion
  Obsidian         Todoist
  Trello           Google Drive
  Dropbox          Jira
  Home Assistant   Philips Hue
  Spotify          SMS (Twilio)
  Mattermost

Each: OAuth2 or API key, 2–5 tools, manifest + SKILL.md, ≥3 unit tests
with mocked HTTP, README. Same shape as packages/core/src/integrations/github/tools.ts.

## How to run the gate at any checkpoint
pnpm -r build                              # 0 errors
pnpm -r typecheck                          # 0 errors
pnpm -r lint                               # 0 errors / 0 warnings
pnpm -r test                               # 0 failures, ≥80% coverage
pnpm test:e2e                              # e2e scenarios pass
./scripts/test-python.sh                   # 23+ Python tests pass
docker compose -f deployment/docker-compose.prod.yml build   # image builds
# After Phase 11's runtime fix:
docker compose -f deployment/docker-compose.prod.yml up -d
curl http://localhost:3100/health          # {"status":"ok", ...}

## What 'done' looks like
Phase 18 gate passes on a fresh Ubuntu 24.04 container:
  docker run --rm -it ubuntu:24.04 bash -c '
    apt-get update && apt-get install -y curl &&
    curl -fsSL <install-url> | SKIP_ONBOARD=1 bash &&
    hipp0 --version && hipp0 doctor
  '

# Start with Phase 11. Go.
```
