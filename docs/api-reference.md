# API Reference

The production HTTP server exposes the endpoints below. Only `/health` is
implemented in Phase 8; the rest are contract stubs the Python SDK targets
(implementation lands alongside Phase 9+).

## `GET /health`

Returns the current health state. Used for Docker healthcheck, Compose,
Railway, Kubernetes liveness probes.

**Response** (200):
```json
{
  "status": "ok",
  "checks": [],
  "uptime": 1.234,
  "version": "0.0.0"
}
```

`status` is one of `ok` | `warn` | `fail`. `checks` is the detailed
`HealthReport` from `@openhipp0/watchdog` when one is wired.

## `GET /version` *(optional route)*

Callers can register extra routes via `new Hipp0HttpServer({ routes: { 'GET /version': ... } })`.

## Reserved endpoints (contract — not yet implemented)

These are targeted by `@openhipp0/openhipp0-sdk` (Python):

| Method | Path                         | Purpose                                  |
| ------ | ---------------------------- | ---------------------------------------- |
| POST   | `/api/decisions`             | Create a decision                        |
| GET    | `/api/decisions`             | List decisions (`projectId`, `status`, `limit`) |
| GET    | `/api/decisions/:id`         | Fetch one decision                       |
| PATCH  | `/api/decisions/:id`         | Update title/reasoning/confidence/tags   |
| GET    | `/api/memory/search`         | FTS5 search over session history         |
| GET    | `/api/memory/stats`          | Row counts per table                     |

These arrive in a follow-up phase. Until then, use `@openhipp0/mcp` or call
the memory functions directly from a Node process.

## MCP (Model Context Protocol)

See [Getting Started: MCP](./getting-started.md) — the `@openhipp0/mcp`
package exposes ~20 tools over stdio for Claude Desktop, Cursor, Windsurf,
and Claude Code.

## TypeScript import surface

```ts
import {
  AgentRuntime,
  LLMClient,
  ToolRegistry,
  tools,
  agent,
} from '@openhipp0/core';

import { db, decisions, compile, learning } from '@openhipp0/memory';

import { Gateway, WebBridge, Hipp0HttpServer } from '@openhipp0/bridge';

import { SchedulerEngine } from '@openhipp0/scheduler';

import { HealthRegistry, Watchdog, CircuitBreaker } from '@openhipp0/watchdog';

import { createMcpServer, startStdioServer } from '@openhipp0/mcp';
```

Each package's top-level index.ts lists the full surface. Per-sub-module
namespaces (e.g. `core.agent.*`, `memory.compile.*`) are also exported.
