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

### Phase 3a — Bridge interface + reliability primitives

**DECISION:** Single `MessageBridge` interface across all 5+ platforms with opaque `platformData`

- REASONING: Keeps the gateway platform-agnostic. Platform-specific fields (Slack trigger_id, Discord guildId, Telegram reply_parameters) pass through without the gateway touching them. Bridges advertise `BridgeCapabilities` so callers can adapt (e.g. dashboard hides button UI if capabilities.buttons=false).
- AFFECTS: Every bridge + the gateway.
- CONFIDENCE: high.

**DECISION:** `ReconnectSupervisor` is a wrapper, not a base class

- REASONING: Each bridge already has its own SDK-specific lifecycle (discord.js Client, grammY Bot, Bolt App). Wrapping the connect() function lets every bridge reuse the exponential-backoff logic without forcing a common base class.
- AFFECTS: Used by bridges that benefit from it (initially none in 3b/3c — each SDK handles its own reconnects — but available for custom bridges + the future WebSocket bridge layer).
- CONFIDENCE: medium.

**DECISION:** `OutboundQueue` drops OLDEST on overflow (not newest)

- REASONING: After a long disconnect, the most recent queued message is typically most relevant to what the user just asked. A two-hour-old "deploy starting…" message arriving after the deploy already finished is worse than never arriving.
- AFFECTS: Any bridge that pipes `send()` through the queue during offline periods.
- CONFIDENCE: medium.

### Phase 3b — CLI + Web bridges

**DECISION:** Test fake for WebBridge uses a 30ms wait instead of draining the initial status frame

- REASONING: ws emits its 'message' event when a frame arrives; attaching the listener after awaiting 'open' loses the server's initial status frame. A brief wait for the server-side connection setup is simpler than synchronizing frame delivery perfectly. Individual tests filter by `type === 'response'` where they care.
- AFFECTS: `packages/bridge/tests/web.test.ts`.
- CONFIDENCE: medium.

**DECISION:** WebBridge JSON wire protocol with `{type: 'message' | 'button' | 'response' | 'status'}`

- REASONING: One self-describing envelope in both directions. Button presses arrive as their own frame type (not overloading 'message') so the server can distinguish "user typed yes" from "user clicked Yes button".
- AFFECTS: WS clients (dashboard chat UI, external consumers).
- CONFIDENCE: high.

**DECISION:** CLI bridge buttons render as numbered text ("[1] Yes [2] No")

- REASONING: No graphical button support in a terminal. Capability still advertises `buttons: true` because the user CAN act on them by number, so gateway-level prompts that depend on buttons still work.
- AFFECTS: `CliBridge.send`, capability shape.
- CONFIDENCE: high.

### Phase 3c — Discord + Telegram + Slack

**DECISION:** Each platform bridge exposes an injectable SDK client (`client` / `bot` / `app`) for testing

- REASONING: The real SDKs (discord.js / grammY / @slack/bolt) own sockets, timers, retries, and network I/O that are extremely painful to mock. Dependency-injecting the top-level SDK handle lets tests supply a tiny fake that implements only the surface the bridge touches.
- AFFECTS: Test strategy for all three platform bridges. The test fakes live in test files.
- CONFIDENCE: high.

**DECISION:** Bot-originated echo messages are filtered inside each bridge (not at the gateway)

- REASONING: Every platform has its own way to identify "this came from my bot" — Discord's `author.id === client.user.id`, Telegram's separate bot Update type (grammY's default handlers exclude bot messages), Slack's `subtype` field. Each bridge is the only layer that understands its SDK's shape.
- AFFECTS: Discord + Slack bridges explicitly filter; Telegram is filtered by the SDK handler path.
- CONFIDENCE: high.

**DECISION:** Button press payloads surface as `IncomingMessage.text = buttonValue` with `platformData.frameType`

- REASONING: Treating a button press as a message (with its value as the text) lets the same agent code handle both. `platformData.frameType` lets callers distinguish when they must (audit, special routing).
- AFFECTS: Web, Telegram, Slack, Discord bridges.
- CONFIDENCE: high.

### Phase 3d — Unified Gateway

**DECISION:** Per-session conversation buffer is passed to the agent as `slice()`, not reference

- REASONING: Passing the live array meant vitest mocks captured a reference — `mock.calls[0]` would show the array in its POST-push state, not at call time. Bug spotted immediately in the gateway tests. Defensive-copy is cheap for <40-entry arrays and prevents any future callers from accidentally mutating the gateway's state.
- AFFECTS: `Gateway.route()`.
- CONFIDENCE: high.

**DECISION:** Session key is `${platform}|${userId}|${channelId}` (not `${platform}|${userId}`)

- REASONING: A user in Discord might be in multiple channels with the bot. Treating each as a distinct session matches user expectations ("ops channel and dev channel are separate conversations").
- AFFECTS: Conversation continuity, session counting for observability.
- CONFIDENCE: high.

**DECISION:** Gateway's agent dependency is structural, not a direct `AgentRuntime` import

- REASONING: `Gateway` takes `{ handleMessage(req): Promise<AgentResponse> }`. Tests pass stubs, production passes AgentRuntime, future multi-agent orchestrators (Phase 6) can pass their own routers — none of which require changing gateway code.
- AFFECTS: `GatewayAgent` interface.
- CONFIDENCE: high.

**DECISION:** Agent errors and send() errors both route through a single `onError` hook

- REASONING: Both are "a message didn't get delivered" failures. The observability layer doesn't usually need to distinguish; when it does, the origin metadata (`{platform, msgId}`) plus the error's own type is enough.
- AFFECTS: Gateway error handling semantics.
- CONFIDENCE: medium.

### Phase 4a — Process Watchdog

**DECISION:** In-process watchdog only; out-of-process restart manager deferred to Phase 7+

- REASONING: Phase 4's value is _soft_ recovery — catching memory pressure before OOM-kill, flagging GC thrashing, preserving state across intentional restarts. True kill-me-and-restart-me requires a process manager; that's an ops concern (`hipp0 start` wrapper + systemd / Docker restart policy), additive on top of what we shipped.
- AFFECTS: `Watchdog` never calls `process.exit`; it only emits `pre_shutdown` and persists a snapshot.
- CONFIDENCE: high.

**DECISION:** State-snapshot schema is exported as a Zod literal (`SNAPSHOT_VERSION = 1`)

- REASONING: This is the public contract a future out-of-process sidecar will read. Bumping the schema requires bumping the version literal; loaders must refuse unknown values. Keeping it inside `types.ts` (not buried in the snapshot store) makes the contract obvious.
- AFFECTS: `packages/watchdog/src/types.ts`.
- CONFIDENCE: high.

**DECISION:** Crash-loop trip is one-shot until `reset()`; GC + heap detectors throttle internally

- REASONING: Once safe mode is active, additional trips just spam the bus. Same logic for the GC detector (one emit per windowMs while pressure persists). Consumers don't get useful information from N copies of the same alert.
- AFFECTS: `CrashLoopDetector`, `GcThrashDetector`.
- CONFIDENCE: high.

**DECISION:** Watchdog forwards subevents on its own bus + auto-trips safe mode on `heap_fatal` / `crash_loop`

- REASONING: One subscription point for the consumer; each composed detector still emits its own events for callers that need granularity.
- AFFECTS: `Watchdog.wireSubevents`.
- CONFIDENCE: high.

### Phase 4b-i + 4b-ii — Health system

**DECISION:** All check probes (DB ping, LLM API-key check, bridge `isConnected`, disk `statfs`, Docker daemon ping, port probe) are constructor-injected — no cross-package imports

- REASONING: Watchdog can't import from `memory` / `bridge` / etc. without inverting the package boundary matrix. Production CLI/runtime (Phase 7) wires real handles; tests inject deterministic stubs. Same precedent as Phase 2d learning callbacks.
- AFFECTS: All `health/checks/*.ts`.
- CONFIDENCE: high.

**DECISION:** AutoFix is opt-in at run-time (`registry.run({autoFix: true})`) and per-check optional

- REASONING: Most checks have no safe autoFix (config write is destructive, port rebind requires app cooperation). Framework supports it; Phase 4b-i ships none implemented; concrete autoFixes land per-check as use cases mature. autoFix throws are captured (never re-thrown).
- AFFECTS: `HealthRegistry.runOne`.
- CONFIDENCE: high.

**DECISION:** Severity composition is fixed: any `fail` → `fail`; else any `warn` → `warn`; else `ok`. `skipped` is informational only

- REASONING: Spec-implied. `skipped` lets headless deploys silence a check (e.g., `BridgesCheck.treatEmptyAsSkipped: true`) without polluting the overall score.
- CONFIDENCE: high.

**DECISION:** `MemoryCheck` (system RAM) is distinct from Phase 4a's `HeapMonitor` (V8 heap)

- REASONING: Two failure modes — host OOM and process heap-limit OOM — surface differently and need separate alerts. Same Watchdog can hold both.
- CONFIDENCE: high.

**DECISION:** `HealthDaemon` serializes ticks (no concurrent runs)

- REASONING: A slow tick that overlaps the next interval would have two registry runs racing — events would interleave confusingly + the in-flight sample would be wasted work. `inFlight` flag drops the second tick rather than queueing.
- AFFECTS: `daemon.ts`.
- CONFIDENCE: high.

### Phase 4c — Safe Updates

**DECISION:** Stage callbacks (migrate / smokeTest / commit / observe) are caller-supplied; updater owns no domain knowledge

- REASONING: Updates can mean migrating a Drizzle schema, swapping a node_modules version, flipping a feature flag — none of which the watchdog package should know about. Same injection pattern as health probes.
- AFFECTS: `AtomicUpdater`, `CanaryUpdater`.
- CONFIDENCE: high.

**DECISION:** Backup uses POSIX `rename` after `cp` for the manifest write; per-source files are copied directly into a fresh timestamped dir

- REASONING: The destination dir is fresh per backup → there's no half-state to overwrite during file copies. The manifest write at the end is the durable "this backup is consistent" marker; if we crash before writing it, the next `openBackup` fails cleanly.
- AFFECTS: `backup.ts`.
- CONFIDENCE: medium.

**DECISION:** Rollback is allowed to throw (Hipp0RollbackFailedError); update-stage failures are NOT

- REASONING: A failed migrate/smoke is recoverable (we have the backup); a failed rollback is not (the package is out of options) — bubble it up so a human sees it. Stage failures stay in the structured `UpdateResult` so callers can log/notify without exception handling.
- AFFECTS: `AtomicUpdater.run`.
- CONFIDENCE: high.

**DECISION:** "Canary" = extended observation window with caller-supplied probe (no traffic split)

- REASONING: Hipp0 is local-first single-process; there's no traffic to split. The operator value of "canary" is "watch for X minutes after upgrading before committing" — that's what `CanaryUpdater` does.
- AFFECTS: `canary.ts`.
- CONFIDENCE: medium.

### Phase 4d — Generalized circuit breakers + predictive detection

**DECISION:** `CircuitBreaker` is re-used verbatim from `@openhipp0/core/llm` — not re-implemented

- REASONING: Per Phase 4 directive. Watchdog adds `BreakerRegistry` (named collection + transition events) on top; the core breaker class is just re-exported for ergonomic construction.
- AFFECTS: Adds `@openhipp0/core` workspace dep on watchdog (matches the package boundary matrix).
- CONFIDENCE: high.

**DECISION:** Predictors use `lastEmitAt: number | null` for throttling instead of `0`

- REASONING: Tests run with synthetic clocks at `now=0`; `0 - 0 < windowMs` would self-throttle the very first emit. Explicit `null` initial state avoids the trap.
- AFFECTS: `OomTrendPredictor`, `ErrorSpikeDetector`, and `AutoPatchRegistry` (uses `Map.has` instead of `?? 0`).
- CONFIDENCE: high.

**DECISION:** OOM prediction uses ordinary least squares on `(takenAt, fraction)` over a sliding window

- REASONING: Memory growth in steady-state agent loops is approximately linear; OLS is cheap, deterministic, and reasonable for the 30-minute horizon spec. False positives self-correct on the next sample (slope drops back below positive) without spam thanks to the throttle.
- ALTERNATIVES_REJECTED: Exponential smoothing — adds tunable params without clearly better behaviour at this horizon.
- AFFECTS: `predictor/oom-trend.ts`.
- CONFIDENCE: medium. Revisit when we have real heap-trajectory data.

**DECISION:** AutoPatch runs all matching patches in registration order, sequentially

- REASONING: Patches may have side-effects that other patches depend on (or conflict with). Sequential + insertion-order is the most predictable ordering. Per-patch cooldown prevents tight loops.
- AFFECTS: `predictor/auto-patch.ts`.
- CONFIDENCE: medium.

### Phase 4e — Wiring + integration

**DECISION:** No new "central watchdog event bus" module; the existing `Watchdog` already serves that role for 4a primitives, and `HealthDaemon` / `BreakerRegistry` / predictors each carry their own EventEmitter

- REASONING: Forcing one shared bus would create awkward namespacing for events across very different domains. Consumers compose via direct subscription; the integration test shows the shape.
- AFFECTS: No file added. Documented here so the next contributor doesn't reach for one.
- CONFIDENCE: medium.

### Phase 5.1 — Skills engine

**DECISION:** Skill manifest is validated against `SkillManifestSchema` (Zod) at load time, not at registration

- REASONING: Load is the I/O boundary; by the time a skill reaches the registry it's already been validated. Separating the two keeps `SkillRegistry` pure (no async, no fs).
- AFFECTS: `packages/core/src/skills/loader.ts`, `registry.ts`.
- CONFIDENCE: high.

**DECISION:** Loader skips `_`-prefixed and `.`-prefixed directories

- REASONING: `_template/` is the spec's built-in template dir; it shouldn't be loaded as a skill. Dot-prefixed dirs are hidden/temp by convention.
- CONFIDENCE: high.

**DECISION:** Skill name is a lowercase-slug (`/^[a-z0-9_-]+$/`), enforced by Zod

- REASONING: Names are used as filesystem directory names, registry keys, and command-line arguments — all of which break on spaces/special chars.
- CONFIDENCE: high.

### Phase 5.2 + 5.3 — Policy engine + execution governance

**DECISION:** `enforce()` checks permission → path → domain → approval, in that order, short-circuiting

- REASONING: Each check is independent and progressively more expensive. Permission is cheapest (set lookup); path requires glob matching; domain is a string match; approval is an async wait. Short-circuiting means a missing permission never reaches the approval step.
- AFFECTS: `packages/core/src/security/policy.ts`.
- CONFIDENCE: high.

**DECISION:** Minimal glob matcher (`**` and `*`), no external `minimatch` dependency

- REASONING: Core must stay dependency-light; the glob patterns we use (`~/.ssh/**`, `./**`) are simple enough for a 10-line regex converter.
- AFFECTS: `policy.ts`. If exotic patterns appear in Phase 7+ configs, swap in a library then.
- CONFIDENCE: medium.

**DECISION:** GovernanceEngine resolves approval promises even on 'denied' (caller checks `decision`)

- REASONING: Earlier draft rejected denied as an error; that forced callers to catch/distinguish deny from timeout. Resolving with the decision object is cleaner — callers destructure `decision` and take the appropriate code path without error handling.
- AFFECTS: `governance.ts`.
- CONFIDENCE: high.

**DECISION:** `ALWAYS_BLOCKED_PATHS` (ssh/aws/gnupg/hipp0-secrets) cannot be overridden by any policy template

- REASONING: Security-critical. Even `permissive` mode doesn't grant access to SSH keys. The list is hardcoded in `templates.ts` and checked independently of the policy's `allowedPaths`.
- AFFECTS: `policy.ts`, `templates.ts`.
- CONFIDENCE: high.

### Phase 6.1 — Heartbeat scheduler

**DECISION:** Minimal 5-field cron parser in-tree, no `cron-parser` dependency

- REASONING: The scheduler package is small; pulling in `cron-parser` adds a transitive dependency tree. Our parser handles `*`, ranges, steps, commas — sufficient for the heartbeat use case.
- AFFECTS: `packages/scheduler/src/cron.ts`.
- CONFIDENCE: medium. Swap if edge cases surface.

**DECISION:** `nextFireTime` brute-force scans minute-by-minute, capped at 2 years

- REASONING: Tasks fire at most once per minute. A 2-year scan is ~1M iterations — completes in <5ms on modern hardware. Algebraic solvers for the general 5-field case are surprisingly tricky to get right.
- CONFIDENCE: high.

**DECISION:** `enabled` field on CronTaskConfig defaults to `true` via Zod, but engine checks `=== false` defensively

- REASONING: `addTask` receives the config as a TS type (not parsed through Zod), so the `.default(true)` doesn't apply to callers passing plain objects. Checking `=== false` instead of `!enabled` avoids the `undefined → disabled` trap.
- CONFIDENCE: high.

### Phase 6.2 — Multi-agent orchestrator

**DECISION:** Routing is pure overlap-count + successRate tiebreaker; no LLM-based classification

- REASONING: Phase 6 scope is library foundations. LLM-classified routing can be layered on top via a classifier that emits `TaskDescriptor.domains` before calling `router.route()`. The router itself stays fast and deterministic.
- AFFECTS: `packages/core/src/orchestrator/router.ts`.
- CONFIDENCE: medium. LLM routing is a Phase 8 concern.

### Phase 7a — CLI foundation (init / config / lifecycle)

**DECISION:** Commands are pure functions returning `CommandResult`, wired into commander separately

- REASONING: Lets every command be unit-tested without spawning child processes or stubbing `process.exit`. The commander wiring in `index.ts` is a thin translator: function → result → console.log + exit code. Tests import the function directly.
- AFFECTS: `packages/cli/src/commands/*.ts`, every test file under `tests/commands/`.
- CONFIDENCE: high.

**DECISION:** All filesystem access goes through an injected `FileSystem` interface

- REASONING: Tests get an in-memory fake (`createMemoryFs`) that mimics the node:fs/promises surface the CLI actually uses (readFile / writeFile / mkdir / exists). No real disk I/O in unit tests → no flakes, no cleanup, no permission issues in CI.
- ALTERNATIVES_REJECTED: `memfs` / `mock-fs` packages — extra dependency for a four-method surface.
- AFFECTS: Every CLI command. The default export `nodeFileSystem` wraps the real module.
- CONFIDENCE: high.

**DECISION:** `hipp0 start` / `stop` are Phase 8 placeholders that point to the bridge Gateway

- REASONING: A proper daemon manager requires systemd/pm2/docker integration, PID tracking across OSes, and supervisor-style restart. That's an ops concern tracked in Phase 8. `status` is implemented (reads a pidfile + `process.kill(pid, 0)`); `start`/`stop` print guidance instead of half-building a manager.
- AFFECTS: `src/commands/lifecycle.ts`. `status` returns exit code 0/3 per Unix convention (0 = running, 3 = not running).
- CONFIDENCE: high.

### Phase 7b — CLI commands (doctor / skill / agent / cron)

**DECISION:** `doctor` takes an injectable `HealthRegistry`, constructs a default one when absent

- REASONING: Production default registers `ConfigCheck` pointed at `~/.hipp0/config.json` with a `Hipp0ConfigSchema` validator. Tests pass their own registry with fake checks so we never hit real disk, LLMs, or docker in unit tests. The registry is the composition boundary — the CLI doesn't register every watchdog check by default; callers who want disk/memory/docker checks add them via `extraChecks`.
- AFFECTS: `src/commands/doctor.ts`. Doctor exit codes: ok/warn → 0, fail → 1.
- CONFIDENCE: high.

**DECISION:** `skill install|test|remove` are intentional placeholders

- REASONING: `install` requires a skill registry protocol (Phase 8). `test` requires the full agent runtime + LLM. `remove` is `fs.rm` but semantically tied to `install`. Shipping stubs would mis-signal "these are ready". Instead, `runSkillDeferred` prints why the command will land in Phase 8.
- AFFECTS: Both the CLI wiring and user docs.
- CONFIDENCE: high.

**DECISION:** `cron add` validates schedules via `@openhipp0/scheduler.parseCron` before writing config

- REASONING: The config is authoritative; a broken cron persisted now would crash the scheduler at startup. Parsing inline rejects invalid schedules with a clear CLI error. Natural-language input goes through `naturalToCron` first, then the cron parser — catching both "every 99 days" and "hello world" as HIPP0_CLI_CRON_INVALID_SCHEDULE.
- AFFECTS: `src/commands/cron.ts`.
- CONFIDENCE: high.

### Phase 7c — CLI commands (memory / misc)

**DECISION:** `memory` commands use a real in-memory SQLite DB in tests (not a mock)

- REASONING: The commands thin-wrap `db.$client.prepare(...)` + `recall.searchSessions`. Faking the Drizzle instance would recreate the entire schema surface. `memoryDb.createClient({ databaseUrl: ':memory:' })` + `runMigrations(db)` is ~3 lines and exercises the real code path end-to-end. This is the same pattern the memory package uses in its own tests.
- AFFECTS: `tests/commands/memory.test.ts` uses a real in-memory DB; production factory uses the default `~/.hipp0/hipp0.db`.
- CONFIDENCE: high.

**DECISION:** `migrate` is SQLite-only; Postgres operators are redirected to `pg_dump`

- REASONING: File-copying a DATABASE_URL that resolves to Postgres would produce garbage. `resolveSqlitePath` throws `Hipp0NotImplementedError` on Postgres URLs; the CLI catches it and emits a clear "use pg_dump/pg_restore" message. Avoids teaching two migration paradigms when SQLite is the local-first default.
- AFFECTS: `src/commands/misc.ts`.
- CONFIDENCE: high.

**DECISION:** `benchmark` lists shell commands instead of spawning child processes

- REASONING: Spawning `pnpm --filter ... test:bench` from inside the CLI requires handling stdio piping, signal forwarding, cwd detection, and pnpm's own version resolution. Printing the command the operator can copy-paste is simpler, equally useful, and keeps the CLI free of child-process complexity until Phase 8 needs it.
- AFFECTS: `runBenchmark`. Output contains the exact shell invocation per suite.
- CONFIDENCE: medium. If operators push back, wrap `execFile` later.

### Phase 8 — Integration, MCP, Python SDK, Docs, Deployment

**DECISION:** E2E tests live in a dedicated `@openhipp0/e2e` workspace package

- REASONING: Cross-cutting scenarios (Web bridge → Gateway → AgentRuntime → MemoryAdapter → SQLite) don't belong in any single package's test suite; putting them in a sibling lets them import every package through the normal workspace resolution.
- ALTERNATIVES_REJECTED: Root-level `tests/e2e/` — would require a bespoke tsconfig + vitest config outside the workspace pattern we've used everywhere else.
- AFFECTS: `packages/e2e/`, root `package.json`, `turbo.json`.
- CONFIDENCE: high.

**DECISION:** Scripted LLM (`FakeLLMProvider`) for E2E instead of real SDK mocks

- REASONING: E2E still runs through `LLMClient` (retry + circuit breaker + budget), so wiring a real provider behind a fake factory is the most realistic test surface. The factory injection point was designed for this in Phase 1e.
- AFFECTS: `packages/e2e/src/fake-llm.ts`.
- CONFIDENCE: high.

**DECISION:** MCP server uses `registerHipp0Tool` adapter over hand-rolling each tool

- REASONING: Hipp0 Tools already have Zod validators; extracting `.shape` lets MCP's `inputSchema` stay in sync with the tool's own validator. Hand-rolled tools (memory CRUD, health, cron) go through the SDK directly since their shapes aren't driven by a Hipp0 Tool.
- AFFECTS: `packages/mcp/src/tool-adapter.ts`.
- CONFIDENCE: high.

**DECISION:** Python SDK is a flat, 6-package monorepo under `python-sdk/`

- REASONING: Each package ships independently on PyPI; a flat layout avoids importlib namespace surprises and lets each have its own `pyproject.toml`. Base SDK + 5 framework adapters (CrewAI / LangGraph / LangChain / AutoGen / OpenAI Agents).
- ALTERNATIVES_REJECTED: uv workspace — adds a tool dependency for contributors without material benefit at this size.
- AFFECTS: `python-sdk/`, `scripts/test-python.sh`.
- CONFIDENCE: high.

**DECISION:** Framework integrations import their framework LAZILY

- REASONING: The integration packages must install cleanly on machines without the framework; lazy imports (or not importing at all) lets CI test every adapter without Playwright / CrewAI / LangGraph binaries. `auto()` silently skips missing frameworks for the same reason.
- AFFECTS: All 5 `openhipp0-*` framework packages.
- CONFIDENCE: high.

**DECISION:** Phase 8's HTTP surface is GET /health only; REST endpoints are a Python-SDK contract, implemented later

- REASONING: Docker/Compose/Railway/K8s healthchecks need `/health`; the richer API surface (decisions/memory/agents) is a bigger design decision (auth model, pagination, webhooks) that doesn't belong on Phase 8's critical path. The Python SDK targets the future shape so users can write code today.
- AFFECTS: `packages/bridge/src/http-server.ts`, `docs/api-reference.md`, Python SDK client.
- CONFIDENCE: medium.

**DECISION:** Docker image runs `hipp0 serve` as a non-root user with a volume-mounted `~/.hipp0`

- REASONING: Principle of least privilege + persistent config survives image upgrades. Standard Docker hardening.
- AFFECTS: `Dockerfile`, `deployment/docker-compose.prod.yml`.
- CONFIDENCE: high.

**DECISION:** (Phase 8 deferred) `hipp0 serve` binary runtime smoke test

- REASONING: Running `hipp0 serve` directly against the source tree fails today because (a) every workspace package's `package.json#main` still points at `src/index.ts`, which Node's native ESM loader can't consume, and (b) `@slack/bolt` is CJS + uses named imports in `packages/bridge/src/slack.ts` — a pattern esbuild/vitest handle but native Node doesn't. Fix is two-parter: shift `main` fields to `dist/` (with a `development` export condition so vitest still finds source), and change the slack import to default + destructure. Blocking this on Phase 9 "production hardening" lets Phase 8 ship the Docker image + compose files + CI/CD without gating on a monorepo-wide refactor.
- AFFECTS: `packages/*/package.json`, `packages/bridge/src/slack.ts`, `packages/cli/bin/hipp0.js`.
- CONFIDENCE: high. (The gap is understood; the fix is deliberate future work.)

### Phase 7d — Dashboard (React 19 + Tailwind v4 + Vite)

**DECISION:** Vite + Tailwind v4 (not v3) + separate vite / vitest configs

- REASONING: Tailwind v4's `@tailwindcss/vite` plugin is zero-config — `@import 'tailwindcss'` in a CSS file + the vite plugin is the full setup. v3 required postcss.config.js, tailwind.config.js, and `@tailwind base/components/utilities`. Vite config drives the production build; vitest config drives tests (separate so tests don't pull in the Tailwind plugin, which requires a browser).
- AFFECTS: `packages/dashboard/{vite.config.ts, vitest.config.ts, src/index.css}`.
- CONFIDENCE: high.

**DECISION:** Vitest uses esbuild's JSX transform instead of `@vitejs/plugin-react`

- REASONING: Type mismatch between vite@6 (bundled transitively through some deps) and vite@7 (vitest's peer). Adding `@vitejs/plugin-react` to vitest.config.ts caused cascading `PluginOption` type errors. esbuild handles `jsx: 'automatic'` natively, which is all our tests need — no Fast Refresh, no HMR. Production build still uses `@vitejs/plugin-react` in `vite.config.ts` for proper Dev/Prod JSX handling.
- ALTERNATIVES_REJECTED: Downgrade vite; override types with `as any`.
- AFFECTS: `vitest.config.ts`. If we ever need plugin-react in tests, cast to the right vite version explicitly.
- CONFIDENCE: medium. Revisit when vitest/vite version alignment shifts.

**DECISION:** WebSocket hook takes an injectable `webSocketCtor`

- REASONING: Jsdom's WebSocket is network-bound; real tests need a fake. Rather than mocking globals, the hook accepts an explicit constructor. Tests pass a tiny `FakeWebSocket` class that tracks `sent` frames and exposes `open()` / `recv()` helpers for driving state. Production leaves `webSocketCtor` unset → falls back to `globalThis.WebSocket`.
- AFFECTS: `src/hooks/useWebSocket.ts`, `src/pages/Chat.tsx`, all WebSocket tests.
- CONFIDENCE: high.

**DECISION:** 8 of the 10 pages are placeholder shells; only Home + Chat render interactive UI

- REASONING: Phase 7's gate is "all pages render". Data wiring (Agents, Memory graph viz, Skills, Scheduler, Health charts, Costs, Audit, Settings) requires the HTTP/WebSocket API surface that lands in Phase 8. Shipping a shell that tells the user which CLI command to use instead is honest; shipping fake charts would teach bad habits. Each shell is ~15 lines (header + dashed-border hint box).
- AFFECTS: Every page in `src/pages/*.tsx` except Home and Chat.
- CONFIDENCE: high.

**DECISION:** `test/globals: true` + `tests/setup.ts` with `afterEach(cleanup)`

- REASONING: React Testing Library's `render` appends to `document.body`; without cleanup, multiple renders in one file collide (we saw multiple `data-testid="ws-status"` failures). Enabling vitest globals lets the setup file use `afterEach` without importing it in every test. Worth the slight global-pollution cost.
- AFFECTS: `vitest.config.ts`, `tests/setup.ts`.
- CONFIDENCE: high.

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
