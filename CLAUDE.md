# CLAUDE.md — Open Hipp0 Architecture & Decision Log

This file is the source of truth for architecture decisions, conventions, and
context that every contributor (human or agent) needs. Phase 3+ subagents read
this before touching code. Keep it current.

---

## Mission

Open Hipp0 is a local-first, open-source autonomous AI agent platform built
around a persistent decision memory (Hipp0) and a self-learning loop (Hermes).
It competes with OpenClaw by offering:

1. Decision graph + self-learning memory (not just chat history)
2. Self-healing reliability engine (auto-recovery, safe updates)
3. Security-first execution (Docker sandbox, granular permissions, policy engine)
4. Multi-agent orchestration (specialized teams, not one monolith)
5. Execution governance (preflight validation, human-in-the-loop approvals)

Package scope: `@openhipp0`. CLI: `hipp0`. Config: `~/.hipp0/`. DB: `~/.hipp0/hipp0.db` (SQLite local), `DATABASE_URL` → Postgres 17 + pgvector (prod).

---

## Operating Rules (for any agent editing this repo)

1. **Phased execution.** Respect the current phase's scope. Don't reach forward.
2. **Simplicity first.** Minimum code that solves the problem. Nothing speculative.
3. **Surgical changes.** Touch only what you must. Don't refactor unrelated code.
4. **Forced verification.** Gate commands must actually run and pass. Paste real output.
5. **No invented facts.** If you don't know, say so — don't fabricate.
6. **Security-first.** Never log secrets. Validate every input. Deny-by-default.
7. **Test alongside code.** Every export has at least one test. 80% coverage target.

---

## Monorepo Layout

```
open-hipp0/
├── packages/
│   ├── core/       # Agent runtime, LLM abstraction, tool execution, orchestrator
│   ├── memory/     # Decision graph, self-learning, user modeling, recall
│   ├── bridge/     # Messaging connectors (Discord/Telegram/Slack/Web/CLI)
│   ├── scheduler/  # Heartbeat cron + natural-language triggers
│   ├── watchdog/   # Self-healing (health checks, watchdog, safe updates)
│   ├── dashboard/  # React 19 + Tailwind + shadcn/ui
│   ├── cli/        # `hipp0` CLI (commander.js)
│   └── sdk/        # External-consumer TypeScript SDK
├── python-sdk/     # Python SDK + framework integrations (Phase 8)
├── skills/         # Built-in skills (agentskills.io format)
├── deployment/     # Docker/K8s/Railway/DO configs (Phase 8)
├── docs/
└── benchmarks/
```

---

## Package Boundaries (enforce — do not cross)

| Package     | Can import from                           | Cannot import from                                    |
| ----------- | ----------------------------------------- | ----------------------------------------------------- |
| `core`      | (nothing — foundational)                  | `memory`, `bridge`, etc.                              |
| `memory`    | `core`                                    | `bridge`, `scheduler`, `watchdog`, `dashboard`, `cli` |
| `bridge`    | `core`                                    | `memory` (gets memory via core's runtime)             |
| `scheduler` | `core`, `memory`                          | `bridge`, `dashboard`                                 |
| `watchdog`  | `core`                                    | anything else (runs independently)                    |
| `dashboard` | `sdk` only                                | `core`, `memory`, etc. directly                       |
| `cli`       | `core`, `memory`, `scheduler`, `watchdog` | `dashboard`                                           |
| `sdk`       | `core`, `memory` (types only)             | `bridge`, `scheduler`, `watchdog`, `dashboard`, `cli` |

Rationale: keeps circular imports impossible, keeps build graph linear, keeps
dashboard portable to any SDK consumer.

---

## Tech Stack

- **Runtime:** Node.js 22+, TypeScript 5.7+ (strict mode, `noUncheckedIndexedAccess`)
- **Module system:** ESM (`"type": "module"`), `moduleResolution: Bundler`
- **Package manager:** pnpm 10.33.0 (pinned via `packageManager` field)
- **Build orchestrator:** Turborepo 2.x (v2 `tasks` syntax)
- **Testing:** Vitest 3.x (workspace root at `vitest.workspace.ts`)
- **Linting:** ESLint 9 (flat config, `eslint.config.js`) + typescript-eslint 8
- **Formatting:** Prettier 3 (100 cols, single quote, trailing comma all)
- **Database:** SQLite (local) or PostgreSQL 17 + pgvector (prod) via Drizzle ORM
- **Logging:** Pino (structured, correlation IDs)
- **Validation:** Zod (runtime boundaries)
- **Observability:** OpenTelemetry (added Phase 4)
- **Sandbox:** Docker ephemeral containers (Phase 1f)
- **Frontend:** React 19 + Tailwind + shadcn/ui (Phase 7)
- **Browser automation:** Playwright (Phase 1f tools or later)

---

## Decision Log

All decisions use this format:

```
DECISION: <title>
REASONING: <why this choice>
ALTERNATIVES_REJECTED: <what we didn't pick and why>
AFFECTS: <which components>
CONFIDENCE: high | medium | low
```

### Phase 1a — Repo Skeleton

**DECISION:** Turbo v2 `tasks` syntax

- REASONING: Turbo 2.x current; `pipeline` deprecated.
- AFFECTS: turbo.json
- CONFIDENCE: high

**DECISION:** `moduleResolution: "Bundler"` in tsconfig.base.json

- REASONING: Modern ESM-first; works with Vite/tsup/esbuild. Aligns with Node 22 + `"type": "module"`.
- ALTERNATIVES_REJECTED: `NodeNext` — requires `.js` extensions everywhere without real benefit for workspace packages.
- AFFECTS: All TS packages. Re-visit if publishing library to npm with CJS compat.
- CONFIDENCE: medium

**DECISION:** `noUncheckedIndexedAccess: true`

- REASONING: Catches `arr[i]` being `T | undefined` at compile time. Matches the "forced verification" mindset.
- AFFECTS: All TS code. Minor ergonomic cost, higher bug-catch.
- CONFIDENCE: high

### Phase 1b — Tooling + CI + DB infra

**DECISION:** ESLint 9 flat config (`eslint.config.js`) over `.eslintrc.cjs`

- REASONING: ESLint 9 defaults to flat config; legacy `.eslintrc` needs `ESLINT_USE_FLAT_CONFIG=false`.
- AFFECTS: Linting only.
- CONFIDENCE: high

**DECISION:** Type-aware ESLint rules disabled until Phase 1c+

- REASONING: `projectService: true` requires per-package tsconfig.json; enabling before packages exist would crash lint.
- AFFECTS: Can't catch `no-floating-promises` etc. in 1a/1b.
- CONFIDENCE: high

**DECISION:** `pgvector/pgvector:pg17` image (not `postgres:17` + manual extension)

- REASONING: Extension preinstalled; avoids apt-get flake in CI.
- AFFECTS: docker-compose.yml
- CONFIDENCE: high

**DECISION:** Vitest `defineWorkspace` API (deprecated but functional) over `test.projects` in root config

- REASONING: Matches the spec's filename `vitest.workspace.ts`. Migration is mechanical when needed.
- CONFIDENCE: medium

### Phase 1c — Package skeletons

**DECISION:** All stub packages use identical shape (`src/index.ts`, `tests/smoke.test.ts`, `vitest.config.ts`, `tsconfig.json`)

- REASONING: Minimizes surprise. Specialization happens when each package gets real code.
- AFFECTS: All 8 packages.
- CONFIDENCE: high

**DECISION:** `rootDir: src` + `exclude: [tests]` in per-package tsconfig.json

- REASONING: Keeps dist/ free of test files. Tests are type-checked by Vitest/Vite loader at runtime.
- TRADE-OFF: `pnpm typecheck` does not catch type errors in tests. Later sub-phases may add `tsconfig.test.json` if test typechecking is needed in CI.
- CONFIDENCE: medium

**DECISION:** Package boundaries enforced by convention (not by tool) for now

- REASONING: Enforcement tools (eslint-plugin-import, syncpack) add complexity. The 8-row matrix above is small enough to police in code review.
- ALTERNATIVES_REJECTED: `eslint-plugin-boundaries` — may add in Phase 7 if drift happens.
- CONFIDENCE: low. Revisit.

**DECISION:** Use `.js` extensions in relative imports (Node ESM canonical pattern)

- REASONING: Works under `moduleResolution: Bundler` AND produces correct compiled output that Node ESM can execute directly. Avoids the "looks fine in dev, breaks in prod" trap.
- AFFECTS: All source/test imports.
- CONFIDENCE: high

---

## Coding Standards

### TypeScript

- Strict mode. No `any` except at API boundaries (document + Zod-validate).
- Prefer `interface` for object shapes, `type` for unions/tuples.
- Name error classes with `Hipp0` prefix extending `Hipp0Error`.
- Exports: prefer named exports. Avoid default exports.

### Error handling

- Every async call wrapped in try/catch at boundaries.
- Throw typed errors; never throw strings.
- Never swallow errors silently. Log with correlation ID.

### Logging

- Pino structured logger. Correlation IDs for every request.
- Log levels: `fatal`, `error`, `warn`, `info`, `debug`, `trace`.
- NEVER log: API keys, tokens, full user messages containing secrets, PII.

### Testing

- Alongside the code, not after.
- Every exported function has at least one unit test.
- Every DB operation has an integration test (real SQLite / real Postgres via Docker).
- Coverage target: 80% per package.
- Tests must be deterministic. Mock external APIs. Real-API tests gated by env vars with `test.skipIf(!process.env.XXX_API_KEY, ...)`.

### Security

- Deny-by-default for file paths, shell commands, network egress.
- Blocked paths (always, cannot be overridden): `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.hipp0/secrets`.
- Sandbox tool execution in Docker ephemeral containers by default.
- Validate every user input with Zod at the boundary.
- Audit-log every privileged action.

---

## External Concepts Reference

- **Hipp0** — the persistent decision memory system. Core primitives: decisions, edges (supports/contradicts/extends/supersedes), outcomes, embeddings, tags. 5-signal scoring for recall. Originates from github.com/perlantir/hipp0ai.
- **Hermes** — the self-learning loop. Core primitives: auto-created skills, skill self-improvement, memory nudging, conversation compression with lineage. From Nous Research's hermes-agent.
- **Honcho** — user modeling dimensions: communication style, expertise, workflow preferences, risk tolerance.
- **OpenClaw** — the closed-source competitor we're replacing. Specific claims about its behavior/flaws require verification before appearing in user-facing docs.
- **agentskills.io** — the skill manifest format. Each skill ships a `SKILL.md`, `manifest.json`, and optional `tools.ts`.

---

## Open Questions / TODOs

- [ ] Add `eslint-plugin-boundaries` (or equivalent) to enforce the import matrix, if drift happens.
- [ ] Decide whether to typecheck tests in CI (currently Vitest handles at runtime only).
- [ ] Postgres migrations path — currently SQLite only in 1d; Postgres mirrors defined but not migrated.
- [ ] Husky + lint-staged setup (deferred from 1b).
- [ ] Sharable `@openhipp0/tsconfig` package — consider when per-package tsconfigs diverge.
- [ ] Verify OpenClaw-specific claims (founder, CVEs, star count, rename history) with WebSearch before they appear in the README / migration guide in Phase 8.

---

## Reading Order for New Contributors / Agents

1. This file (CLAUDE.md).
2. `docs/architecture.md` (system diagram) — added Phase 1g.
3. The package you're touching, starting with its `src/index.ts` and `README.md`.
4. Relevant decision log entries above.

If you make a non-trivial decision, add it to the Decision Log in this file
before finishing your phase.
