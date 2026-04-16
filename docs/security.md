# Security

Open Hipp0 is designed around **deny-by-default** execution, **sandboxed
tools**, and **explicit approval** for high-stakes actions. This doc covers
the threat model, the guarantees the current implementation makes, and the
knobs operators have.

## Always-blocked paths

No policy template — not even `permissive` — can override these:

- `~/.ssh/**`
- `~/.aws/**`
- `~/.gnupg/**`
- `~/.hipp0/secrets/**`

Implementation: `packages/core/src/security/policy.ts` + `templates.ts`.

## Tool sandboxing

- `shell_execute` runs under one of three modes:
  - `none` — direct exec (dev / test only)
  - `native` — detached child in its own process group; killed via
    `process.kill(-pid, sig)` on timeout
  - `docker` — ephemeral container with network + fs restrictions
- `file_read` / `file_write` / `file_list` pass every path through
  `assertPathAllowed()` — checks the blocked list + the context's
  `allowedPaths` allowlist.
- `web_fetch` enforces a domain allowlist via `isHostAllowed()`.

## Policy engine

`packages/core/src/security/policy.ts` exports three templates:

| Template     | Use case                                          |
| ------------ | ------------------------------------------------- |
| `strict`     | Production / untrusted inputs. Everything approved. |
| `moderate`   | Default for interactive dev. Sends/payments approved. |
| `permissive` | Power users / offline work. Still can't touch blocked paths. |

Policies are enforced via middleware that runs **before** any tool executes.

## Approval flow (governance)

High-stakes actions (purchases, deploys, external sends) can be gated
through `GovernanceEngine`. Approvals arrive via the configured bridge
(button press / slash command), not via trusting the LLM's "I'll be
careful". If approval times out, the action is rejected.

## Data at rest

- API keys live in `~/.hipp0/.env` (0600). Never logged.
- Session history stored in SQLite / Postgres. Encrypt the volume at the
  OS / cloud level; the app does not encrypt rows.
- The credential vault (landing Phase 9) uses AES-256-GCM with a master
  password or OS keychain.

## Data in transit

- HTTP server binds `0.0.0.0:3100` by default — front it with a reverse
  proxy (Caddy / nginx / Traefik) that terminates TLS.
- WebSocket bridge (`WebBridge`) has an injectable `authenticate(req)`
  callback; supply one in production.

## Audit logging

Every privileged tool call is written to `auditLog` with `projectId`,
`agentId`, `userId`, `action`, `targetType`, `targetId`, `details`, `costUsd`.
Export via:

```sql
SELECT * FROM audit_log WHERE created_at > '2026-04-01' ORDER BY created_at;
```

## Reporting vulnerabilities

Email security@openhipp0.dev (placeholder until the domain is live). Do not
open public issues for security reports.
