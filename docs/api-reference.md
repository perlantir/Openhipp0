# API Reference

The production HTTP server exposes the endpoints below. `/health` ships by
default; the REST API under `/api/*` is an opt-in. Start the server with
`hipp0 serve --with-api` (or `HIPP0_WITH_API=1`) to mount it.

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

## REST API (opt-in via `--with-api` / `HIPP0_WITH_API=1`)

| Method | Path                         | Status | Body / Query |
|--------|------------------------------|--------|--------------|
| POST   | `/api/decisions`             | 201    | `{ projectId, title, reasoning, madeBy, confidence, affects?, tags? }` |
| GET    | `/api/decisions`             | 200    | `?projectId=… &status=active|superseded|rejected &limit=50 &offset=0` |
| GET    | `/api/decisions/:id`         | 200/404| — |
| PATCH  | `/api/decisions/:id`         | 200/404| `{ title?, reasoning?, confidence?, tags?, status? }` |
| GET    | `/api/memory/search`         | 200/400| `?projectId=… &q=… &agentId? &userId? &limit=10` |
| GET    | `/api/memory/stats`          | 200    | — |

### Auth

Pass `--api-token <secret>` (or set `HIPP0_API_TOKEN`) to enforce a bearer
check on every `/api/*` route. Callers send `Authorization: Bearer <secret>`;
responses are `401 Unauthorized` otherwise. When no token is configured, the
routes are open — only do this inside a trusted network.

### Response format

Every endpoint returns JSON. Successful responses are the resource itself
(or an array for list endpoints). Errors have the shape
`{ "error": "…", "id"? }` with the appropriate HTTP status.

### Python SDK

`@openhipp0/openhipp0-sdk` targets this surface directly. See
[`python-sdk/openhipp0-sdk/README.md`](../python-sdk/openhipp0-sdk/README.md).

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
