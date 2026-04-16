# Migrating from Hermes Agent (Nous Research) → Open Hipp0

Open Hipp0 ships a one-command migration for Hermes Agent users. Run:

```bash
hipp0 migrate hermes                     # interactive (dry-run preview first)
hipp0 migrate hermes --dry-run           # preview without writing
hipp0 migrate hermes --preset full       # include secrets (tokens)
hipp0 migrate hermes --preset user-data  # no secrets (default)
hipp0 migrate hermes --source /custom/path
hipp0 migrate hermes --non-interactive   # scripted installs, dry-run by default
```

## What gets migrated

| Hermes source | Open Hipp0 destination | Notes |
|---|---|---|
| `~/.hermes/SOUL.md` | `~/.hipp0/soul.md` | Agent persona |
| `~/.hermes/MEMORY.md` | Ingested into `memoryEntries` + archived under `~/.hipp0/archive/` | Re-embedded after migration |
| `~/.hermes/skills/` | `~/.hipp0/skills/hermes-imports/` | **Direct copy** — already agentskills.io format |
| `~/.hermes/config.yaml` | Structured config + archived under `~/.hipp0/archive/hermes-config.yaml` | Models/channels parsed best-effort |
| `~/.hermes/auth.json` | `~/.hipp0/.env` (allowlisted keys only) | Nested-provider flatten |
| `~/.hermes/cron/jobs.json` | `~/.hipp0/config.json` (cron section) | Schedule + action preserved |
| `~/.hermes/sessions.sqlite` | `~/.hipp0/import/hermes-sessions.sqlite` | Memory package folds into `sessionHistory` on next start |

Secret directories (`~/.hermes/secrets/`, `.ssh`, `.aws`, `.gnupg`) are
**always skipped**, even with `--preset full`.

## Safety guarantees

- **Non-destructive:** source files are never modified.
- **Backup before overwrite:** every destination file that already exists
  is copied into `~/.hipp0/migration-<ISO-timestamp>/` first.
- **Idempotent:** re-running the migration produces the same destination.
- **Dry-run default** when stdin is not a TTY or `--non-interactive` is
  passed — the exact plan is printed; no writes happen until you re-run
  interactively.

## Manual review items

After the migration completes, check:

1. `~/.hipp0/skills/hermes-imports/` — skills copied verbatim. Open
   `manifest.json` on each to confirm the `triggerPattern` still suits
   your routing policy.
2. `~/.hipp0/.env` — only allowlisted env keys were imported
   (see `ALLOWED_ENV_KEYS` in `packages/cli/src/commands/migrate-shared.ts`).
3. `hipp0 doctor` — validates the config shape and exits 0/1 accordingly.
4. If you had a custom Honcho user-model in Hermes, the
   `sessionHistory`-backed recall engine will populate user state
   automatically on next message ingress — no manual import needed.

## Rollback

Nothing to roll back — source files are untouched. If you want to undo the
migration, delete `~/.hipp0/soul.md`, `~/.hipp0/skills/hermes-imports/`,
and `~/.hipp0/archive/hermes-*`. Memory entries can be removed via
`hipp0 memory` subcommands.
