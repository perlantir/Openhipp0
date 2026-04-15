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

### Phase 1d — Database (Drizzle/SQLite)

**DECISION:** SQLite-only in 1d; Postgres schema mirror deferred to Phase 2.x

- REASONING: Drizzle requires separate schemas per dialect (sqlite-core vs pg-core). Shipping both doubles code volume without value while dev-first phases don't need Docker. `client.ts` throws `Hipp0NotImplementedError` with a clear message on `postgres://` URLs.
- ALTERNATIVES_REJECTED: Thin abstraction over both dialects — accumulates complexity and bugs for no phase-1 benefit.
- AFFECTS: `packages/memory/src/db/`. Postgres schema mirror + migrations added when deploying.
- CONFIDENCE: high (for now).

**DECISION:** FTS5 virtual table declared via raw SQL in `migrate.ts`, not Drizzle

- REASONING: Drizzle doesn't model SQLite virtual tables or FTS5 triggers. The FTS5 mirror of `session_history.full_text` is created post-migration with raw SQL and triggers that keep it in sync on INSERT/UPDATE/DELETE.
- AFFECTS: `packages/memory/src/db/migrate.ts`.
- CONFIDENCE: high.

**DECISION:** Drizzle 0.36 index extra-config returns an object, not an array

- REASONING: 0.36's `SQLiteTableExtraConfig` type is `Record<string, IndexBuilder>`. Array syntax is 0.38+. Runtime accepts both; TS rejects arrays pre-0.38.
- AFFECTS: All `sqliteTable(..., (t) => ({...}))` sites in schema.ts.
- CONFIDENCE: high.

**DECISION:** UUID v4 primary keys + ISO 8601 UTC timestamps (not INTEGER/epoch)

- REASONING: Same row identity works across SQLite and Postgres. Human-readable timestamps make DB inspection + logs easier. Small storage cost.
- ALTERNATIVES_REJECTED: AUTOINCREMENT integer PKs — don't survive dialect swap; collide on merge.
- CONFIDENCE: high.

### Phase 1e — LLM abstraction

**DECISION:** Faux-streaming in 1e-ii providers (chat wraps chatSync + yields derived chunks)

- REASONING: True incremental streaming across three SDKs is ~3× the implementation and test surface. The AsyncGenerator contract is honored — callers migrate to real streaming later without a shape change. Documented in each provider's file docstring.
- ALTERNATIVES_REJECTED: Implement real streaming now — triples Phase 1e scope without user-visible benefit in the agent loop (which assembles the full response before acting anyway).
- AFFECTS: `provider-anthropic.ts`, `provider-openai.ts`, `provider-ollama.ts`. Iteration target for Phase 2.
- CONFIDENCE: medium. Revisit when the dashboard needs live streaming.

**DECISION:** `override readonly cause: unknown` on `Hipp0RetryExhaustedError`

- REASONING: Node 16.9+ added `Error.cause`. TS's `noImplicitOverride` flags the collision; `override` is the correct narrowing.
- AFFECTS: `packages/core/src/llm/types.ts`. Useful pattern for any future error class that shadows `name`/`message`/`cause`/`stack`.
- CONFIDENCE: high.

**DECISION:** `ProviderFactory` injection point in `LLMClient` constructor

- REASONING: Tests construct providers from fake LLMProvider instances via `(cfg) => fakeProvider`, avoiding SDK mocking. The factory is an escape hatch for deterministic testing without polluting the production API.
- ALTERNATIVES_REJECTED: Mock `@anthropic-ai/sdk`/`openai` via `vi.mock()` — fragile across SDK versions.
- AFFECTS: Client tests. Keep the factory signature stable.
- CONFIDENCE: high.

**DECISION:** Budget-exceeded errors fail fast — not tried against next provider

- REASONING: Spend doesn't recover by switching providers. Failing over would just rack up more cost on the secondary. Explicit `if (err instanceof Hipp0BudgetExceededError) throw err;` in the client's failover loop.
- AFFECTS: `LLMClient.chatSync` / `LLMClient.chat`.
- CONFIDENCE: high.

### Phase 1f — Tool engine

**DECISION:** `Tool.validator` widens input type to `unknown` (not `P`)

- REASONING: Zod schemas using `.default(...)` / `.optional()` have optional-input but required-output types. A narrow `z.ZodType<P>` rejects these. Widening input to `unknown` matches the registry's actual data flow (raw JSON from the LLM) and keeps runtime behavior intact.
- AFFECTS: `packages/core/src/tools/types.ts` Tool interface.
- CONFIDENCE: high.

**DECISION:** Native sandbox uses `detached: true` + `process.kill(-pid, sig)` for timeout kills

- REASONING: `sh -c "sleep 5"` forks sleep; killing sh alone leaves sleep orphaned + holding stdio pipes → `close` never fires → 5s hang. `detached: true` makes the child the head of its own process group; signaling `-pid` reaches every descendant.
- ALTERNATIVES_REJECTED: `tree-kill` library — unnecessary dependency for a 3-line Linux-specific fix.
- AFFECTS: `packages/core/src/tools/sandbox.ts`. Windows needs a different strategy (noted but not in Phase 1 scope).
- CONFIDENCE: high.

**DECISION:** Tool errors become `ok=false` `ToolResult`s, not thrown

- REASONING: The agent loop inspects results and forwards them as `tool_result` blocks to the LLM; thrown errors would abort the loop. Unexpected implementation bugs (not `Hipp0ToolError`) still throw — the runtime should treat those as fatal.
- AFFECTS: `ToolRegistry.execute`, every built-in tool.
- CONFIDENCE: high.

### Phase 1g — Agent runtime

**DECISION:** Three stop conditions beyond `end_turn`: `max_iterations`, `tool_error_cascade` (3 consecutive error iterations), `llm_stop_reason`

- REASONING: Each signals a distinct failure mode. Distinguishing them in `stoppedReason` gives observability without requiring log parsing.
- AFFECTS: `AgentRuntime`, `AgentResponse.stoppedReason`.
- CONFIDENCE: high.

**DECISION:** `MemoryAdapter` defined as an interface in core; concrete implementation in `@openhipp0/memory/adapter`

- REASONING: Core stays memory-agnostic. Phase 1g ships `NoopMemoryAdapter`; Phase 2f's `Hipp0MemoryAdapter` wires it in.
- AFFECTS: `packages/core/src/agent/types.ts`, `packages/memory/src/adapter/`.
- CONFIDENCE: high.

### Phase 2a — Decision graph

**DECISION:** Two embedding providers in-tree: `OpenAIEmbeddingProvider` + `DeterministicEmbeddingProvider`

- REASONING: Tests need deterministic vectors with weakly-meaningful similarity (n-gram hash splash over neighbors). Offline dev needs a local fallback. Real deploys use OpenAI.
- AFFECTS: `packages/memory/src/decisions/embeddings.ts`. Local transformer.js option is Phase 8.
- CONFIDENCE: high.

**DECISION:** Stemmer drops the `es$` rule

- REASONING: `es$ → ''` turns `databases` into `databas` (wrong); `processes → process` only works by luck. `s$` alone covers plurals correctly (`databases → database`, `cats → cat`); `sses$`/`ies$` handle the awkward cases.
- AFFECTS: `packages/memory/src/decisions/tags.ts`.
- CONFIDENCE: high.

**DECISION:** Drizzle's `db.$client` exposed for raw SQL; no custom `$raw` alias

- REASONING: Drizzle 0.36 already exposes the better-sqlite3 handle as `$client`. Our previous `$raw` cast conflicted with its types.
- AFFECTS: `packages/memory/src/db/`, migrations, FTS5 search.
- CONFIDENCE: high.

**DECISION:** Selective re-embed on `updateDecision`

- REASONING: Re-embed only when `title` or `reasoning` changes. Updates to `tags`, `status`, `supersededBy` don't need a new vector — saves API cost + preserves bytes.
- AFFECTS: `packages/memory/src/decisions/record.ts`.
- CONFIDENCE: high.

### Phase 2b — Contradiction detection

**DECISION:** Three-way stance classification (`aversive` / `positive` / `neutral`) instead of binary negation

- REASONING: "Do not use Redis" and "Avoid Redis" are both aversive stances that agree on the conclusion. Earlier binary negation-flip heuristic flagged them as opposing. Unifying negation particles + aversive verbs into a single "aversive" bucket fixes the false positive.
- ALTERNATIVES_REJECTED: Purely LLM-based detection — too expensive at every write, and the heuristic is fine for the hard-band (sim ≥ 0.85).
- AFFECTS: `packages/memory/src/contradict/detect.ts`.
- CONFIDENCE: medium. Benchmark once a corpus exists (target 0.92 F1).

**DECISION:** Two similarity bands with different detectors: `≥0.85` heuristic, `0.70–0.85` classifier (optional)

- REASONING: High similarity + stance mismatch is very likely a contradiction (deterministic heuristic is safe). Medium similarity is ambiguous — only invoke the LLM when the caller supplies a classifier.
- AFFECTS: `detectContradictions` thresholds.
- CONFIDENCE: medium.

### Phase 2c — Context compilation + H0C

**DECISION:** Fixed 5-signal weights (0.35 / 0.20 / 0.15 / 0.15 / 0.15), override-able per call

- REASONING: Matches the spec. `DEFAULT_WEIGHTS` asserts sum = 1.0 in tests. Deployments with different priors can pass `weights: Partial<ScoringWeights>`.
- AFFECTS: `scoring.ts`.
- CONFIDENCE: medium (spec-supplied numbers; tune after real usage data).

**DECISION:** Auto-degrade chain for compression: `markdown → h0c → ultra → truncate`

- REASONING: Caller asks for a format + token budget; we honor the budget over the format. `autoDegrade: false` opts out for strict rendering.
- AFFECTS: `compileFromDecisions`, reported via `meta.degraded` / `meta.formatUsed`.
- CONFIDENCE: high.

**DECISION:** `AgentSystemPromptSection` defined locally in `packages/memory/src/compile/types.ts`

- REASONING: Core and memory both want this shape. Defining it locally on both sides (structurally identical) avoids a hard package dependency that would otherwise go both ways (core → memory for the adapter interface, memory → core for Message).
- AFFECTS: Compile output. Phase 2f kept this even after adding the core dep — the structural match is robust.
- CONFIDENCE: medium.

### Phase 2d — Self-learning loop (Hermes)

**DECISION:** Skill dedup computes embeddings on the fly; embeddings not stored on the skills table

- REASONING: Small volume in early phases (<1000 skills/project). Storing them doubles write cost without noticeable read win. When volumes grow, add an `embedding` column + an index in a Phase 2.x schema bump.
- AFFECTS: `maybeCreateSkill`.
- CONFIDENCE: medium.

**DECISION:** All learning primitives take callback interfaces (`SkillWriter`, `SkillImprover`, `FactExtractor`, `ConversationSummarizer`)

- REASONING: Keeps the learning module DB-pure + testable with deterministic stubs. LLM wiring is the adapter's job (Phase 2f).
- AFFECTS: `packages/memory/src/learning/`.
- CONFIDENCE: high.

**DECISION:** Conversation compression preserves first 2 + last 5 turns; 70% context threshold

- REASONING: Spec numbers. First 2 carry the initial intent; last 5 carry active state. 70% leaves room for the next response without another immediate compress.
- AFFECTS: `maybeCompressSession`.
- CONFIDENCE: medium.

**DECISION:** Prompt-injection scan is allowlist-poor / blocklist-based

- REASONING: False positives are acceptable (entry is dropped, logged); false negatives poison future context. The blocklist catches the common shapes; semantic detection is a Phase 5 policy engine concern.
- AFFECTS: `looksLikePromptInjection`.
- CONFIDENCE: medium.

### Phase 2e — User model + recall

**DECISION:** `riskTolerance='medium'` treated as "not set" in `renderUserModelSnippet`

- REASONING: It's the default. Surfacing it adds noise to every system prompt without information.
- AFFECTS: Prompt rendering only — stored column is untouched.
- CONFIDENCE: high.

**DECISION:** FTS5 search uses raw SQL (two queries: FTS MATCH + rowid join)

- REASONING: Drizzle doesn't model virtual tables. FTS5's rowid ties into the main table's rowid; a `WHERE rowid IN (...)` join hydrates rows while preserving rank order.
- AFFECTS: `packages/memory/src/recall/search.ts`.
- CONFIDENCE: high.

### Phase 2f — Adapter + cross-package re-exports

**DECISION:** `@openhipp0/core` re-exports key types + classes at the package root

- REASONING: Namespace-only exports (`export * as agent`) force consumers to write `agent.AgentRuntime`, which pushes adapter code into awkward shapes. Re-exporting at the root alongside namespaces gives both options with zero cost.
- AFFECTS: `packages/core/src/index.ts`.
- CONFIDENCE: high.

**DECISION:** Every side effect in `Hipp0MemoryAdapter.recordSession` is independently try/catched

- REASONING: Skill creation / nudge / user-model / compression failures must never break the primary "session row was persisted" guarantee. They're also independent — one failure shouldn't cascade into the others.
- AFFECTS: `hipp0-adapter.ts`.
- CONFIDENCE: high.

**DECISION:** `Hipp0MemoryAdapter.compileContext` does NOT swallow errors

- REASONING: Earlier draft wrapped the decision-compiling block in a broad try/catch, which hid a real import bug (`compileFromDecisions` imported from the wrong module). If memory compilation fails, the agent loop should see it.
- AFFECTS: `hipp0-adapter.ts`.
- CONFIDENCE: medium — revisit if observability layer gains a quieter degradation path.

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
