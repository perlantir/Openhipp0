# Migrating from OpenClaw

> **Status:** Phase 8 documents the migration *contract*; the automated
> tooling (`hipp0 migrate openclaw`) lands in **Phase 12**. This guide
> describes what a manual migration looks like today and the shape the
> automated command will adopt.

## What's migrated

| OpenClaw artifact                  | Open Hipp0 destination                        |
| ---------------------------------- | --------------------------------------------- |
| `~/.openclaw/SOUL.md`              | `~/.hipp0/soul.md`                            |
| `~/.openclaw/MEMORY.md`            | `memory_entries` rows                         |
| `~/.openclaw/USER.md`              | `user_models` row (single user)               |
| `~/.openclaw/IDENTITY.md`          | Agent identity in `~/.hipp0/config.json`      |
| `~/.openclaw/skills/`              | `~/.hipp0/skills/openclaw-imports/` (converted) |
| `~/.openclaw/memory/` (daily logs) | `memory_entries` + `session_history` rows     |
| `openclaw.json` LLM providers      | `hipp0.config.ts` provider chain              |
| `openclaw.json` bridges            | `hipp0.config.ts` `bridges` array             |
| `.env` API keys                    | `~/.hipp0/.env`                               |
| Cron entries                       | `scheduler` config                            |
| `HEARTBEAT.md`                     | Scheduler heartbeat task                      |
| `TOOLS.md`                         | Skill manifests                               |
| `AGENTS.md`                        | Multi-agent orchestrator config               |

## Manual migration steps (current)

1. **Back up OpenClaw first:** `cp -a ~/.openclaw ~/.openclaw.backup`.
2. Create a fresh Open Hipp0 project: `hipp0 init <name> --non-interactive`.
3. Copy persona: `cp ~/.openclaw/SOUL.md ~/.hipp0/soul.md`.
4. Import API keys by copying the relevant env entries into `~/.hipp0/.env`.
5. Convert skill manifests (OpenClaw format → agentskills.io):
   - OpenClaw ships permissions in its `*.md` header; move them into the
     `permissions` array of a new `manifest.json`.
   - Copy `SKILL.md` contents verbatim.
6. For daily memory logs, append their contents into `memoryEntries` via
   the memory CLI or a short TypeScript script that calls
   `memory.learning.createMemoryEntry(...)`.
7. Re-embed imported memory: the `decisions.embeddings` module will
   regenerate vectors on next read.

## Automated migration (Phase 12)

```bash
hipp0 migrate openclaw                    # interactive (detects ~/.openclaw)
hipp0 migrate openclaw --dry-run          # preview without writing
hipp0 migrate openclaw --preset full      # skills + memory + config + secrets
hipp0 migrate openclaw --preset user-data # everything except secrets
hipp0 migrate openclaw --source /custom/path
hipp0 migrate openclaw --skill-conflict skip|overwrite|rename
```

Design principles (tracked for Phase 12 implementation):

- **Non-destructive.** OpenClaw files are never modified.
- **Dry-run by default** when invoked non-interactively.
- **Backup before writing.** Every migration creates
  `~/.hipp0/migration-<timestamp>/` holding everything the import touched.
- **Auto-detect legacy names.** `~/.openclaw/`, `~/.clawdbot/`,
  `~/.moltbot/` are all recognized.
- **Re-embed.** After import, imported memories are re-embedded via the
  active embedding provider so they're searchable alongside native data.

## Unverified OpenClaw claims

Anything we haven't personally reproduced (founder names, CVEs, star
counts, rename history) is deliberately absent from this guide. We'll add
it once we can cite a primary source.
