# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Instead, email the maintainers directly at the address listed in
`package.json#repository.url` owners, or submit a GitHub Security Advisory
via the repository's Security tab. Please include:

- A short description of the issue.
- Steps to reproduce.
- The commit / version affected.
- (Optional) a suggested fix.

We aim to acknowledge reports within **72 hours** and provide a remediation
timeline within one week.

## Supported versions

Only the latest published version on `main` is supported for security
fixes. This project is pre-1.0; there are no LTS channels yet.

## Disclosure timeline

Our default is coordinated disclosure with a 90-day cap:

1. Report received, triaged, confirmed.
2. Fix developed, tested, merged.
3. Release cut; reporter credited in the release notes (unless they
   request anonymity).
4. Public advisory published.

If you need a shorter or longer embargo, say so in the initial report.

## Out of scope

- Denial-of-service from untrusted user-submitted prompts. The policy
  engine + sandbox + budget are the defense layer; operators who disable
  them accept the risk.
- Attacks that require an already-compromised local machine (malware
  accessing `~/.hipp0/`, physical access, etc.).
- Vulnerabilities in upstream dependencies without a realized exploit in
  Open Hipp0 code. Please report those upstream first.

## Our security posture

See [`docs/security.md`](./docs/security.md) for the threat model +
mitigations. In summary:

- Deny-by-default file / shell / network.
- AES-256-GCM for anything encrypted at rest (browser credential vault,
  cloud backups).
- Docker sandbox for `shell.execute` by default.
- SHA-256-hashed per-agent API keys; plaintext returned exactly once.
- Postgres RLS for multi-tenant isolation.
- Prompt-injection defense via source-tagging + spotlighting (Phase 21).

Paid external pen tests are out of the v1 budget. Community review +
automated `pnpm audit` in CI are the baseline.
