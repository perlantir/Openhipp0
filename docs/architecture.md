# Architecture

```
         ┌──────────────────────────────────────┐
         │   Messaging bridges                  │
         │   Discord ◂ Telegram ◂ Slack         │
         │   WebSocket ◂ CLI                    │
         └──────────────┬───────────────────────┘
                        │  IncomingMessage
                        ▼
                   ┌─────────┐
                   │ Gateway │  session buffer per (platform|user|channel)
                   └────┬────┘
                        │  HandleMessageRequest
                        ▼
              ┌───────────────────┐
              │   AgentRuntime    │──── compileContext ──┐
              │   (agentic loop)  │                       │
              └────┬──────────────┘                       │
                   │ tool_use                              │
                   ▼                                       ▼
              ┌──────────┐                           ┌────────────────────┐
              │   LLM    │                           │   MemoryAdapter    │
              │  (Claude │                           │  - decisions       │
              │   / GPT  │                           │  - user model      │
              │   /Ollama)│                          │  - session recall  │
              └──────────┘                           │  - skill creation  │
                   │                                 └────────┬───────────┘
                   ▼                                          │
              ┌──────────────┐                                │
              │ ToolRegistry │                                │
              │  fs / web /  │                        ┌──────▼──────┐
              │  shell (sandboxed)                    │  SQLite /   │
              └──────┬───────┘                        │ Postgres+  │
                     ▼                                │  pgvector   │
              ┌──────────────┐                        └─────────────┘
              │  Watchdog    │   health / updates / circuit breakers
              └──────────────┘
```

## Package boundary matrix

| Package     | Can import from                           | Cannot import from                                    |
| ----------- | ----------------------------------------- | ----------------------------------------------------- |
| `core`      | (nothing — foundational)                  | `memory`, `bridge`, etc.                              |
| `memory`    | `core`                                    | `bridge`, `scheduler`, `watchdog`, `dashboard`, `cli` |
| `bridge`    | `core`                                    | `memory` (via core's runtime adapter interface only)  |
| `scheduler` | `core`, `memory`                          | `bridge`, `dashboard`                                 |
| `watchdog`  | `core`                                    | anything else (runs independently)                    |
| `dashboard` | `sdk` only                                | `core`, `memory`, etc. directly                       |
| `cli`       | `core`, `memory`, `scheduler`, `watchdog`, `bridge`, `browser` | `dashboard`                        |
| `mcp`       | `core`, `memory`, `scheduler`, `watchdog`, `browser` | `bridge`, `dashboard`                      |
| `browser`   | `core` (primitives in `core/browser`)     | everything else                                       |
| `sdk`       | `core`, `memory` (types only)             | `bridge`, `scheduler`, `watchdog`, `dashboard`, `cli` |

Rationale: keeps the build graph linear, prevents circular imports, and
lets the dashboard stay portable across SDK consumers. `browser` (G1-a) holds
higher-level automation capabilities (profiles, snapshots, workflows, multi-tab,
site memory, network inspector) above `core/browser` primitives.

## Tech stack

- **Runtime:** Node.js 22, TypeScript 5.7 strict (`noUncheckedIndexedAccess: true`)
- **Module system:** ESM with `.js` suffixes on relative imports (Node canonical)
- **Build:** Turborepo 2.x (v2 `tasks` syntax), pnpm 10 workspaces
- **Testing:** Vitest 3 (workspace project per package)
- **Linting:** ESLint 9 flat config + typescript-eslint 8, Prettier 3
- **Database:** SQLite (dev) or Postgres 17 + pgvector (prod) via Drizzle ORM 0.36
- **Validation:** Zod 3 at every API boundary
- **Logging:** Pino structured logs with correlation ids
- **Sandbox:** Docker ephemeral containers for shell tool
- **Frontend:** React 19 + Tailwind v4 + shadcn/ui + Vite
- **MCP:** `@modelcontextprotocol/sdk` 1.29+

## Key design decisions

See `CLAUDE.md` at the repo root for the full decision log (~70 entries
covering every sub-phase 1a → 8.5). Highlights:

- **UUID v4 primary keys + ISO 8601 UTC timestamps** — same row identity across
  SQLite and Postgres; inspection-friendly timestamps.
- **FTS5 virtual table** declared via raw SQL + triggers (Drizzle doesn't model
  virtual tables).
- **Faux-streaming** in Phase 1e providers — `chat()` wraps `chatSync()` and
  yields derived chunks; real incremental streaming is a future upgrade.
- **Tool errors become `{ok:false}` ToolResults**, not thrown — the agent loop
  forwards them to the LLM as `tool_result` blocks.
- **Three-way stance classification** for contradiction detection
  (aversive / positive / neutral) — "don't use X" and "avoid X" agree.
- **Deny-by-default paths:** `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.hipp0/secrets`
  are hardcoded blocks that no policy template can override.
- **In-process watchdog only** — true kill-me-and-restart-me is an ops concern
  (systemd / Docker restart policy). We emit `pre_shutdown` + snapshot state.
