# Troubleshooting

## `hipp0 serve` exits immediately with EADDRINUSE

Port 3100 is already taken. Either stop whatever's using it or override:

```bash
HIPP0_PORT=3200 hipp0 serve
# or
hipp0 serve --port 3200
```

## Docker healthcheck keeps failing

Inside the container, `GET /health` must return 2xx. Check:
```bash
docker compose logs hipp0
docker compose exec hipp0 node -e "fetch('http://127.0.0.1:3100/health').then(r=>console.log(r.status))"
```

If the server never binds, look for a DB connection error — `DATABASE_URL`
pointing at an unreachable Postgres is the most common cause.

## `Hipp0NotImplementedError: Postgres support is deferred to Phase 2.x`

Phase 1d shipped SQLite only. Unset `DATABASE_URL` or prefix with
`sqlite:`/`file:` to force SQLite. The Postgres mirror schema lands in
a subsequent phase.

## Memory tests failing with `Cannot read properties of undefined (reading 'Symbol(drizzle:Columns)')`

You imported a Drizzle table from a namespaced re-export. Use
`memory.db.sessionHistory` (not `sessionHistory`) when importing through
the top-level package.

## Circuit breaker opens after a handful of 5xx

The LLM client's default `failureThreshold` is 5. Check
`packages/core/src/llm/client.ts` for the circuit state transitions.
Reset with a restart or wait `resetTimeMs` (default 60s).

## `hipp0 init` complains the config already exists

Pass `--force` to overwrite, or remove `~/.hipp0/config.json` manually.

## FTS5 queries return zero hits

`memory_search` in the MCP server escapes the query via `escapeFts5()`
before running. If you're hitting the memory package directly, pass
the query through `recall.escapeFts5()` first — raw queries with
special chars (`/`, `-`, `"`, `:`) break SQLite FTS5.

## Python SDK tests: "imported module 'test_instrument' has this __file__ attribute..."

Multiple framework packages have a `tests/test_instrument.py` file; pytest
collects them in one invocation and collides. Run per-package:

```bash
./scripts/test-python.sh                      # all
./scripts/test-python.sh openhipp0-crewai     # one
```

## `pnpm install` fails under corporate proxy

Set `HTTP_PROXY` / `HTTPS_PROXY` and verify:
```bash
pnpm config get registry
pnpm config get proxy
```

## Where to file a bug

GitHub issues: <https://github.com/openhipp0/openhipp0/issues>. Include:
- OS + Node version (`node --version`, `uname -a`)
- `pnpm -v`
- The failing command's full output
- Contents of `~/.hipp0/config.json` (redact API keys)
