# Open Hipp0 — Original Build Prompt

> Saved verbatim from the initial prompt that seeded this project. Sections
> marked ⚠ are the ones NOT yet implemented (Phases 4–8). Phases 1–3 are
> complete; their architecture decisions live in the root `CLAUDE.md`.
>
> If anything below looks subtly wrong vs. the original you pasted on
> 2026-04-15, overwrite this file from your original source of truth —
> this is a best-effort reproduction from the build session's context.

---

## Build Rules

1. Work through phases sequentially. NEVER skip ahead.
2. After completing ALL tasks in a phase, run the PHASE GATE checklist.
3. The Phase Gate includes mandatory tests. Fix ALL failures before proceeding.
4. Once the Phase Gate passes, present me with a summary of:
   - What was built
   - All tests passing (show output)
   - Any design decisions made (using the DECISION format below)
   - Any known limitations or TODOs
5. WAIT for my explicit approval before starting the next phase. Do NOT proceed
   until I say "approved" or "go" or "next".
6. Phases 1-2 run in SINGLE SESSION mode. Phase 3+ originally spec'd SWARM MODE
   (spawning specialized agents in parallel via the Agent tool) but the user
   overrode this for the actual build — **single-session mode for all phases**.
7. If you hit a blocker you cannot resolve after 3 attempts, STOP and ask.
   Do NOT silently skip features or weaken tests to pass the gate.

## Decision Logging Format

Record every significant design decision in CLAUDE.md:

```
DECISION: [title]
REASONING: [why this choice]
ALTERNATIVES_REJECTED: [what we didn't pick and why]
AFFECTS: [which components]
CONFIDENCE: [high/medium/low]
```

## Testing Philosophy

- Write tests ALONGSIDE code, not after.
- Every exported function has at least one unit test.
- Every database operation has an integration test.
- Target 80% code coverage minimum per package.
- Phase Gates are pass/fail — 0 test failures allowed to proceed.
- Tests must be deterministic. No flaky tests. Mock external APIs.
  Only hit real APIs in integration tests gated behind env vars.

---

## Project Overview

Open Hipp0 — open-source, local-first autonomous AI agent platform.
Named after the Hipp0 decision memory system at its core (the hippocampus of
your AI agent team). Combines:

1. **OpenClaw** — Messaging-based AI agent with skills, heartbeat scheduler, 50+ integrations.
2. **Hipp0** (github.com/perlantir/hipp0ai) — Persistent decision memory with
   5-signal scoring, contradiction detection, cross-agent context compilation,
   token compression.
3. **Hermes Agent** (by Nous Research) — Self-learning loop with autonomous
   skill creation, skill self-improvement, Honcho dialectic user modeling,
   memory self-nudging, conversation compression with lineage.

### 5 Differentiators over OpenClaw

1. Hipp0-style decision graph + Hermes-style self-learning (combined memory system)
2. Self-healing reliability engine (auto-recovery, safe updates, predictive issue detection)
3. Security-first architecture (Docker sandboxed execution, granular permissions, policy engine)
4. Multi-agent orchestration (specialized agent teams, not just one monolithic agent)
5. Execution governance (human-in-the-loop approval, preflight validation)

### Identifiers

- Package scope: `@openhipp0` (npm scope)
- CLI command: `hipp0`
- Config directory: `~/.hipp0/`
- Database file (local): `~/.hipp0/hipp0.db`

### Tech Stack

- TypeScript (core runtime, monorepo)
- Python (SDKs, framework integrations — Phase 8)
- SQLite (local/dev) + PostgreSQL 17 + pgvector (production)
- Node.js 22+
- Turborepo + pnpm workspaces (monorepo build)
- Drizzle ORM (type-safe database)
- Zod (runtime validation)
- Pino (structured logging)
- React 19 + Tailwind + shadcn/ui (dashboard)
- Docker (sandboxed tool execution)
- Playwright (browser automation)
- Vitest (unit tests) + Playwright (e2e tests)
- OpenTelemetry (observability)

### Coding Standards (apply to ALL phases)

1. **TypeScript strict mode** — No `any` types except at API boundaries. Use Zod for runtime validation.
2. **Error handling** — Every async call wrapped in try/catch. Use typed Hipp0Error subclasses. Never swallow errors.
3. **Logging** — Pino structured logger. Configurable log levels. Correlation IDs for request tracing.
4. **Testing** — Write tests alongside code. Vitest for unit/integration. 80% coverage target.
5. **Documentation** — JSDoc on all exports. README.md in each package. CLAUDE.md at root with all decisions.
6. **Security** — Never log secrets. Env vars for credentials. Validate all inputs. Sanitize outputs.
7. **Performance** — Lazy-load heavy modules. Stream LLM responses. Pool DB connections. Cache embeddings.
8. **Naming** — All exports prefixed or namespaced under `hipp0`. Error classes extend `Hipp0Error`. Config files use `hipp0.config.ts` or `hipp0.json`.

---

## PHASE 1: MONOREPO SCAFFOLDING + FOUNDATION ✅ DONE

**Mode:** Single session (sequential)
**Goal:** Working monorepo with LLM abstraction, tool execution engine, and agent runtime loop.

Tasks:

- 1.1 Scaffold the Monorepo — Turborepo + pnpm workspaces, 8 packages
- 1.2 Docker Compose + Database — Postgres 17 + pgvector + Drizzle schema (13 tables)
- 1.3 LLM Abstraction Layer — provider failover, retry, circuit breaker, cost tracking
- 1.4 Tool Execution Engine — registry, permissions, Docker sandbox
- 1.5 Agent Runtime Loop — agentic loop with tool calls, decision protocol
- 1.6 CLAUDE.md + Documentation

Gate: pnpm build / test / lint / typecheck / migrations / smoke test all pass.

(Split in practice into sub-phases 1a–1g. See CLAUDE.md for the decision log.)

---

## PHASE 2: MEMORY + SELF-LEARNING ENGINE ✅ DONE

**Mode:** Single session (sequential)
**Goal:** Hipp0 decision graph, Hermes self-learning, user modeling, context compilation.

Tasks:

- 2.1 Decision Graph (Hipp0) — CRUD, embeddings (OpenAI + local), Porter-style stemmer, semantic search
- 2.2 Contradiction Detection — embedding similarity >0.85 + opposing conclusions, LLM-assisted for 0.7–0.85, target 0.92 F1
- 2.3 Context Compilation + Token Compression — 5-signal scoring (semantic 0.35, tags 0.20, recency 0.15, role 0.15, outcome 0.15); H0C compression: full / title-only / grouped (markdown / h0c ~8–10x / ultra ~20–33x)
- 2.4 Self-Learning Loop (Hermes) — skill auto-creation (5+ tool calls), skill self-improvement, memory nudging (>10 turns, budget 100 entries), conversation compression (>70% context, preserve first 2 + last 5, lineage chain)
- 2.5 User Modeling (Honcho-Style) — communicationStyle, expertiseDomains, workflowPreferences, activeProjects, toolPreferences, riskTolerance. Incremental LLM updates.
- 2.6 Cross-Session Recall — FTS5 on session_history.fullText. LLM summarization.
- 2.7 Wire Memory into Agent Runtime — replace ALL stubs
- 2.8 Update CLAUDE.md

Gate: pnpm build / test / lint / typecheck / integration all pass. Compile 100 decisions in <50ms.

(Split in practice into sub-phases 2a–2g. See CLAUDE.md for the decision log.)

---

## PHASE 3: MESSAGING BRIDGES + GATEWAY ✅ DONE

**Originally spec'd: bridge-agent via SWARM MODE. In practice: single-session.**

### Task 3.1: MessageBridge Interface

```typescript
interface MessageBridge {
  readonly platform: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  onMessage(handler: (msg: IncomingMessage) => void): void;
  send(channelId: string, content: OutgoingMessage): Promise<void>;
  getCapabilities(): BridgeCapabilities;
}
```

### Task 3.2: Implement Bridges

1. **Discord** — discord.js. Slash commands + conversation + threads + files.
2. **Telegram** — grammy. Inline keyboards + files + @mention.
3. **Slack** — @slack/bolt. App Home + slash commands + threads.
4. **Web** — WebSocket server for dashboard chat.
5. **CLI** — readline interactive terminal.

Each: auto-reconnect with backoff, message queue, approval buttons, audit logging.

### Task 3.3: Unified Gateway

Single process running all configured bridges → routes to agent → routes responses back.

(Split in practice into sub-phases 3a–3e. WhatsApp deferred — no clean official SDK.)

---

## ⚠ PHASE 4: SELF-HEALING RELIABILITY ENGINE (package: `@openhipp0/watchdog`) — NOT YET IMPLEMENTED

Originally spec'd: reliability-agent via SWARM MODE. Use single-session.

### Task 4.1: Process Watchdog

V8 heap monitoring (70/85/95% thresholds), GC thrashing detection, process
isolation, crash loop → safe mode, state snapshot + restore across restarts.

### Task 4.2: Health System

8 checks (config, DB, LLM, bridges, disk, memory, Docker, ports). Auto-fix.
`hipp0 doctor`. Continuous daemon mode.

### Task 4.3: Safe Updates

Backup → migrate → update → smoke test → or rollback.
`hipp0 update [--dry-run|--rollback|--canary]`

### Task 4.4: Circuit Breakers + Predictive Detection

Apply to LLM/bridges/tools/DB. Memory trend → predict OOM 30min ahead.
Error rate spikes. Known-issue auto-patch.

**Reuse `packages/core/src/llm/circuit-breaker.ts` — do not re-implement.**

---

## ⚠ PHASE 5: SKILLS SYSTEM + SECURITY (package: `@openhipp0/core` — `src/skills/` + `src/security/`) — NOT YET IMPLEMENTED

Originally spec'd: skills-agent via SWARM MODE. Use single-session.

### Task 5.1: Skills Engine

Loader (workspace > global > built-in), `manifest.json` validation (Zod),
registry, CLI integration. Skills format: [agentskills.io](https://agentskills.io)
Markdown with frontmatter + optional `tools.ts`.

### Task 5.2: Permission & Policy Engine

`AgentPolicy` schema. Enforcement middleware on every tool call.
Templates: strict / moderate / permissive. **Always block** (non-overridable):
`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.hipp0/secrets`.

### Task 5.3: Execution Governance

Preflight preview for high-stakes actions. Approval via bridge buttons.
Override with justification → audit.

---

## ⚠ PHASE 6: SCHEDULER + ORCHESTRATOR (packages: `@openhipp0/scheduler` + `@openhipp0/core/orchestrator`) — NOT YET IMPLEMENTED

**Lead agent handles this** (was described as "lead-agent" in swarm mode).

### Task 6.1: Heartbeat Scheduler

Cron (5-field) + natural language. Fresh agent session per task. Webhook
triggers. Delivery to configured channel.

### Task 6.2: Multi-Agent Orchestrator

Team config (YAML). Route by `agentSkillsProfile`. Multi-domain coordination.
Fallback: ask user.

---

## ⚠ PHASES 3–6 GATE (run after Phase 6 completes, or at any intermediate point)

```bash
# 1. Full build
pnpm build                                    # 0 errors

# 2. All tests
pnpm test                                     # 0 failures, ≥75% coverage

# 3. Lint + types
pnpm lint && pnpm tsc --noEmit                # 0 errors

# 4. Bridge tests
pnpm --filter bridge test                     # all bridges connect/send/receive (mocked)

# 5. Watchdog tests
pnpm --filter watchdog test                   # health, recovery, updates, circuit breakers

# 6. Security tests
pnpm --filter core test:security              # policy enforcement, path blocking, approval flow

# 7. Scheduler tests
pnpm --filter scheduler test                  # cron triggers, natural language parsing

# 8. Integration: message via Web bridge → agent → tools → response → decision extracted
pnpm test:integration                         # full flow works
```

---

## ⚠ PHASE 7: CLI + DASHBOARD (packages: `@openhipp0/cli` + `@openhipp0/dashboard`) — NOT YET IMPLEMENTED

### Task 7.1: CLI (`packages/cli/`)

Using `commander.js`:

```
hipp0 init [name]           # Interactive wizard
hipp0 start / stop / status
hipp0 doctor [--auto-fix]
hipp0 update [--dry-run|--rollback|--canary]
hipp0 config set <key> <val>
hipp0 skill search|install|create|test|audit|list|remove
hipp0 memory search <query> / stats
hipp0 agent add|list|remove
hipp0 cron add|list|remove
hipp0 migrate dump|restore|copy
hipp0 benchmark --suite all
```

### Task 7.2: Dashboard (`packages/dashboard/`)

React 19 + Tailwind + shadcn/ui. Pages: Home, Chat, Agents, Memory (graph viz),
Skills, Scheduler, Health, Costs, Audit, Settings. WebSocket real-time.

### Gate

```bash
pnpm build                                    # 0 errors
pnpm test                                     # 0 failures, ≥75% coverage
pnpm lint && pnpm tsc --noEmit                # 0 errors
pnpm --filter cli test                        # init, doctor, start/stop all work
pnpm --filter dashboard test                  # all pages render, WebSocket works
```

---

## ⚠ PHASE 8: INTEGRATION + POLISH + LAUNCH — NOT YET IMPLEMENTED

### Task 8.1: End-to-End Tests

Full flow e2e:

1. `hipp0 init` → creates project
2. Message via Web → agent → tools → response
3. Decision extracted + stored
4. Skill auto-created after complex task
5. User model updated
6. Scheduled task fires + delivers
7. Health check detects issue + self-heals
8. Safe update without data loss

### Task 8.2: MCP Server

25+ tools exposed for Claude Desktop, Cursor, Windsurf, Claude Code.

### Task 8.3: Python SDK

`hipp0-sdk`, `hipp0-crewai`, `hipp0-langgraph`, `hipp0-langchain`,
`hipp0-autogen`, `hipp0-openai-agents`. Auto-instrumentation:
`import hipp0; hipp0.auto()`

> NOTE: Original prompt said `nexus-*` but user clarified on 2026-04-15:
> "Use hipp0-sdk, hipp0-crewai, etc. The nexus- references in Task 8.3 were
> a leftover from a rename."

### Task 8.4: Documentation

`getting-started.md`, `architecture.md`, `api-reference.md`, `cli.md`,
`security.md`, `self-hosting.md`, `skills-guide.md`, `framework-guides/` (5),
`troubleshooting.md`, `migration-from-openclaw.md`

### Task 8.5: Deployment

Dockerfile + docker-compose.yml (production), DigitalOcean 1-click,
Railway template, GitHub Actions CI/CD.

### Final Gate

```bash
pnpm build                                              # 0 errors
pnpm test                                               # 0 failures, ≥80% overall coverage
pnpm test:e2e                                            # full flow passes
pnpm lint && pnpm tsc --noEmit                           # 0 errors
docker compose build                                     # images build
docker compose up -d && sleep 10 && curl localhost:3100/health   # {"status":"healthy"}
npx @openhipp0/cli init test-project --non-interactive   # project created
```

---

## Phase Flow (Quick Reference)

```
PHASE 1: Foundation          [Single Session]  → Gate → Wait for approval  ✅
PHASE 2: Memory Engine       [Single Session]  → Gate → Wait for approval  ✅
PHASE 3: Bridges             [Single Session]  → Gate → Wait for approval  ✅
PHASE 4: Reliability         [Single Session]  → Gate → Wait for approval  ⚠ next
PHASE 5: Skills + Security   [Single Session]  → Gate → Wait for approval
PHASE 6: Scheduler + Orch    [Single Session]  → Gate → Wait for approval
PHASE 7: CLI + Dashboard     [Single Session]  → Gate → Wait for approval
PHASE 8: Integration + Launch [Single Session]  → Final Gate → SHIP IT 🦛
```
