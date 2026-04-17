# Contributing to Open Hipp0

Thanks for considering a contribution. Open Hipp0 is a local-first
autonomous-agent platform built to be hackable — we want you to change it.

## Getting set up

```bash
corepack enable
pnpm install
pnpm -r build
pnpm -r test
```

You should see the full test suite pass locally before touching anything.
If it doesn't, open an issue before filing a PR — the baseline must be
green for the CI gates to be meaningful.

## Workflow

1. Fork + branch from `main`. Branch names follow
   `<kind>/<short-description>`, e.g. `fix/oauth-refresh-leak` or
   `feat/skills-marketplace-pagination`.
2. Make the smallest change that solves the problem. Avoid drive-by
   refactors — they make reviews harder and risk conflicts.
3. Add tests alongside code. Every exported function should have at least
   one test. Tests live in `packages/<name>/tests/`.
4. Run `pnpm -r test && pnpm -r typecheck && pnpm -r lint` before pushing.
5. Open a PR against `main`. Paste the actual output of the three gate
   commands into the PR description (the rules in `CLAUDE.md` require it).

## What goes where

Read [`CLAUDE.md`](./CLAUDE.md) first — it's ~1000 lines of decision log
covering every non-trivial architectural call. Most "should I put this
in core or memory?" questions have an answer there already.

Package boundaries are enforced by convention, not by tool. The import
matrix in `CLAUDE.md` is authoritative:

- `core` depends on nothing.
- `memory` depends on `core`.
- `bridge` depends on `core` (not `memory`).
- `dashboard` depends only on `sdk`.

Crossing a boundary without discussion will get the PR sent back.

## What needs a CLAUDE.md entry

Any of the following require a new entry in the Decision Log:

- A new module / subdirectory in a package.
- A change to a type exported across package boundaries.
- A choice between two equally-valid approaches where someone down the
  line might reasonably pick the other.
- Introducing a new dependency (production or dev).

Format is documented at the top of the Decision Log.

## Tests

- Alongside code, not after. `packages/<name>/tests/**/*.test.ts`.
- Mock external APIs via injected fetch / SDK clients. Don't mock Anthropic
  SDK internals — inject an `LLMProvider` instead.
- Real-API tests are allowed behind `test.skipIf(!process.env.XXX_KEY)`.
  They don't run by default.

## Security

- Never log API keys, tokens, or full user messages.
- Never commit `.env` files or secrets. Our CI runs `pnpm audit` + secret
  scanning; don't bypass.
- Report vulnerabilities privately via [`SECURITY.md`](./SECURITY.md).

## Code style

- Strict TypeScript, ESM-only, named exports. `.js` extensions on relative
  imports (canonical Node ESM).
- Prettier enforces formatting; let it do its thing.
- Error classes are `Hipp0`-prefixed and extend `Hipp0Error`.
- Every structured error has a registry entry in
  `packages/core/src/debuggability/error-codes.ts` with an `HIPP0-XXXX`
  external code + a `fix` hint. Don't ship an error without an entry.

## RFCs

Non-trivial design changes (new packages, breaking API changes, new
persistence model) use the RFC process documented in
[`docs/RFC-TEMPLATE.md`](./docs/RFC-TEMPLATE.md). RFCs follow the Rust
RFC model — post the proposal, give it a week of review, iterate.

## Code of conduct

All interactions are governed by [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

---

When in doubt, open an issue and ask. We'd rather have a short discussion
up front than rework a large PR.
