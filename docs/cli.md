# CLI Reference

The `hipp0` binary is the primary operator surface. Every command is a pure
function under `@openhipp0/cli`; the commander wiring is a thin translator.

## Global flags

- `--json` — emit structured JSON instead of human-readable text

## Commands

### `hipp0 init [name]`
Initialize a new project. Writes `~/.hipp0/config.json`.
- `--force` — overwrite existing config
- `--non-interactive` — accept defaults (requires `name`)

### `hipp0 serve`
Start the production HTTP server on port 3100.
- `--port <n>` — override port (default 3100 / `HIPP0_PORT`)
- `--host <h>` — override bind host (default 0.0.0.0 / `HIPP0_HOST`)

`GET /health` returns `{ status, checks, uptime, version }`.

### `hipp0 status`
Report whether the daemon is running. Exit code 0 = running, 3 = not.

### `hipp0 start` / `hipp0 stop` (placeholders)
Full daemon management lands in a later phase; currently point to
`hipp0 serve` + your OS supervisor (systemd / Docker / pm2).

### `hipp0 doctor`
Run the full health check registry.
- `--auto-fix` — attempt remediation on failing checks.

### `hipp0 config`
- `hipp0 config get <key>` — dotted (e.g. `llm.provider`)
- `hipp0 config set <key> <value>`

### `hipp0 skill`
- `list` / `search <q>` / `audit` / `create <name>` — live
- `install` / `test` / `remove` — deferred placeholders

### `hipp0 agent`
- `add <name> [--domain <d>] [--skills s1,s2]`
- `list`
- `remove <name>`

### `hipp0 cron`
- `add <id> <schedule>` — cron or natural-language (`"every 30 minutes"`)
- `list`
- `remove <id>`

### `hipp0 memory`
- `stats` — row counts
- `search <query> -p <projectId> [-l <limit>] [--agent <id>] [--user <id>]`

### `hipp0 migrate`
SQLite only; Postgres users go through `pg_dump`/`pg_restore`.
- `dump <out>`
- `restore <in> [--force]`
- `copy <src> <dst>`

### `hipp0 benchmark [--suite <name>]`
Prints the shell invocation for the named bench suite.

### `hipp0 update` (placeholder)
- `--dry-run` — preview
- `--rollback` — revert
- `--canary` — single-canary rollout

## Exit codes

- `0` — success
- `1` — general error
- `3` — daemon not running (`status`)

## Testing commands programmatically

```ts
import { runInit, type FileSystem } from '@openhipp0/cli';

const fs: FileSystem = { /* in-memory fake */ };
const result = await runInit({ name: 'x', nonInteractive: true, filesystem: fs, configPath: '/tmp/c.json' });
expect(result.exitCode).toBe(0);
```

Every command is tested that way — no child-process spawning in the unit
suite.
