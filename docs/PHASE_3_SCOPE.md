# Phase 3 — Scope & Ordering (revised 2026-04-16)

Phase 3 was originally scoped as Phases 19–28. Phase 19 shipped as 51b1b11 on
2026-04-16. Before committing to the rest of the original scope, this
document captures the revisions made after a retrospective review.

Two changes compared to the original Phase-3 prompt:

1. **Phases reordered.** You can't optimize what you can't measure, and you
   can't safely ship a skills marketplace on an unhardened core.
2. **Scope trimmed per phase.** The original prompt was ambitious to the
   point of over-scoping (e.g. 7 cost optimization layers, 5-language docs
   at launch, $299/yr Apple Enterprise distribution). Each phase below lists
   what's in v1 and what's cut / deferred.

Retrospective patches on already-shipped work land **before** Phase 20 so
the new phases build on a clean base.

---

## Revised phase order

```
┌ Retrospective patches (land on the Phase-1-to-19 base) ───────────────
│   Retro-A1: API key middleware for /api/*      [security gap]
│   Retro-A2: RLS session context middleware     [security gap]
│   Retro-A3: Pairing tokens → SQLite persistence [durability]
│   Retro-A4: OAuth2 refresh-token rotation      [correctness]
│   Retro-B:  Source-tagged connectors + media cost tracking
│   Retro-C:  Dashboard Audit wire-up + full-flow e2e test
│   Retro-D:  Split phase17.ts into per-integration subdirs
│   Retro-E:  Python SDK expansion (voice/push/widgets/enterprise)
│   Retro-F:  Hygiene (Docker filter + typed FlatList wrapper)
└────────────────────────────────────────────────────────────────────────

┌ Revised Phase 3 (was 20–28; now 20–27) ───────────────────────────────
│   Phase 20: Evaluation framework         (was Phase 23)
│   Phase 21: Prompt injection defense     (was Phase 25)
│   Phase 22: Cost optimization            (was Phase 20, measured now)
│   Phase 23: Skills marketplace           (was Phase 21, gated on 21)
│   Phase 24: Cloud backup + restore       (was Phase 22)
│   Phase 25: Offline mode                 (was Phase 24, folded into
│             Phase-19 sync infra)
│   Phase 26: Debuggability + launch checklist (was 26 + 27 + 28 merged)
└────────────────────────────────────────────────────────────────────────
```

Net: 9 phases → 7 phases + a retrospective pass. Community/governance
(original Phase 27) is not a phase — it's continuous work that scales with
adoption.

---

## Retrospective patches

### Retro-A — Security wire-up

All four of these close real gaps that shipped in earlier phases.

- **A1 — API key middleware.** Phase 14 built per-agent API keys (SHA-256
  hashed) but they aren't wired into `/api/*`. Today the API takes a single
  static Bearer token via `HIPP0_API_TOKEN` and that's it. Fix: middleware
  that resolves an incoming Bearer token against either the env token *or*
  the agent-keys table, sets `req.agentId` on success.
- **A2 — RLS session context.** Phase 14 defined RLS policies for
  tenant/project isolation but `setSessionContext()` is never called on
  incoming HTTP requests, so tenant isolation is silently disabled for API
  callers. Fix: middleware that extracts tenant+project from the resolved
  API key and calls `setSessionContext()` before the route handler runs.
- **A3 — Pairing token persistence.** Phase 19 pairing tokens live in
  memory only; server restart wipes pending pairings. Fix: move to SQLite
  using the existing DB client. One migration + one store swap.
- **A4 — OAuth2 refresh rotation.** Phase 10 has PKCE but no refresh-token
  rotation hook on `TokenStore`. Revoked tokens stay valid until TTL. Fix:
  `rotate()` method on `TokenStore` + optional `shouldRotate` policy on
  `OAuth2Client`.

### Retro-B — Source tagging + cost accounting

- Phase 16 connectors ingest raw Notion / Linear / Slack / GitHub-PR /
  Confluence content into memory without tagging origin or trust. When
  Phase 21 (prompt injection defense) lands, every ingested record needs
  `{origin, trust}`. Retrofit now — cheaper than later.
- Phase 11 media subsystem has no cost accounting. Whisper is ~$0.006/min;
  OpenAI TTS is $15 per million chars. Phase 19B just made both live via
  mobile; Phase 22 (cost optimization) needs the signal.

### Retro-C — Dashboard Audit + full-flow e2e

- `Costs` page stays a shell until Phase 22 lands. Wire `Audit` now (Phase
  14 shipped the export already).
- E2E test for pair → biometric → REST call → RLS filter → response. Single
  biggest coverage gap in the current test suite.

### Retro-D — Split `phase17.ts` — **deferred (opportunistic)**

14 integrations in one 627-line file (todoist already landed in its own
dir). Splitting matches the brave/github/gmail/linear pattern but is
pure mechanical reorganization — zero correctness or security payoff
against a ~15-new-file cost plus regression risk across the 44 existing
integration tests.

**Decision:** leave `phase17.ts` in place as the source of truth.
Opportunistic split: each time we *next touch* one of its 14
integrations (skill update, OAuth plumbing change, bug fix), move that
integration out to its own subdir in the same PR. Within 3–6 months
this should drain `phase17.ts` organically with zero dedicated effort.

When the count drops below 4 integrations, delete `phase17.ts` entirely
and finish the migration in one small PR.

### Retro-E — Python SDK expansion

Voice, push, widgets, and enterprise REST endpoints have no Python client.
Add thin wrappers in `openhipp0-sdk/client.py`.

### Retro-F — Hygiene

- Docker's turbo filter (`!@openhipp0/mobile !@openhipp0/relay`) should
  live in a `.turbo-filter-server` convention the Dockerfile + CI can
  both source. One source of truth.
- Mobile `FlatList<T>` fights `noUncheckedIndexedAccess` + `strict`
  repeatedly. Ship a `typedFlatList<T>` wrapper once, use it everywhere.

---

## Phase 20 — Evaluation framework (was 23)

**v1 scope**

- Reuse **published benchmarks** where they exist: τ-bench, SWE-bench Lite,
  AgentBench, GAIA. Original benchmarks only for memory + self-learning,
  where no standard exists.
- **Tiered suite:** smoke (seconds, every PR) / regression (minutes,
  nightly) / full (hours, weekly).
- Metrics: success rate, latency, cost (USD), tool call count, user
  intervention count, safety (permissions + approvals respected).
- Regression detection via numeric thresholds committed to source.

**Cut / deferred**

- "vs OpenClaw / Hermes" public comparisons — legally risky, low ROI.
- A/B test infrastructure — pushed to Phase 22 where it's actually needed.
- Public leaderboard — shipped as a static GitHub Pages site after v1,
  not as part of the framework.

---

## Phase 21 — Prompt injection defense (was 25)

**v1 scope**

- **Source-tagged inputs.** Every prompt fragment tagged `{origin, trust}`.
  This is the load-bearing defense (research-backed: spotlighting,
  Greshake 2023).
- **Memory origin tagging** (retrofits Retro-B). Untrusted-origin entries
  are *quarantined* — they appear in recall but are marked and never
  auto-promote into decisions.
- **Policy engine gating** (Phase 5.2 already does this) + Docker sandbox
  (Phase 1f) remain the runtime backstop. No bypass.

**Cut / deferred**

- **Canary tokens** — off by default. Some users legitimately ask their
  agent to list credentials; canaries false-positive. Opt-in setting only.
- **Behavior monitoring** — telemetry-only in v1; no auto-pause. Building a
  trained anomaly model requires a labeled dataset we don't have.
- **Pattern library / regex filter** — ships as a *detector* that logs
  matches for review, not as a *filter* that blocks. Pattern libraries die
  against novel attacks; rely on source tagging + policy gating.

---

## Phase 22 — Cost optimization (was 20, now measured)

**v1 scope — ship only what we can measure a win on**

- **L6: Provider-side prompt caching** (Anthropic `cache_control`). Largest
  guaranteed win. Stable prefixes: system prompt + soul + tool defs.
- **L4: Model router** (Haiku → Sonnet → Opus cascade) gated by regression
  tests from Phase 20. Routes misclassify → regressions caught → rollback.
- **L7: Batch API** for scheduled tasks only (non-interactive path).
- **L1: Exact cache** — 50 LOC, trivial win on repetitive queries.
- **Cost dashboard wire-up** (Phase 19 left it a shell; data exists now).

**Cut / deferred**

- **L2: Semantic cache** — privacy footgun (one user's paraphrase hits
  another's cache) + latency tax. Revisit only with tenant isolation
  proven via Phase 20 benchmarks.
- **L3: Plan cache** — plans rot fast against UI + API changes. A silently
  half-succeeding cached plan is worse than regenerating. Defer until the
  eval framework can detect plan rot.
- **L5: Prompt compression (LLMLingua)** — benefits only long retrieved
  contexts, not chat turns. Measure first; ship only if material.

---

## Phase 23 — Skills marketplace (was 21)

**v1 scope**

- Browse + install from agentskills.io.
- Runtime enforcement via existing Phase 1f sandbox + Phase 5.2 policy
  engine. Every installed skill is untrusted code until the user grants
  per-tool permissions.
- User rating + community review score.
- Update / pin / rollback.

**Cut / deferred**

- **"Static analysis" malicious-pattern scanner** — security theater.
  Motivated attackers route around regex. The sandbox + policy engine
  are the real defense.
- **Signed publisher program** — pointless without a PKI. Do it properly
  (sigstore/cosign) in v2, or not at all.
- **Revenue sharing / premium skills** — not a technical phase. Billing +
  tax + legal. Separate decision.
- **Auto-generated skill sharing** — privacy minefield. User-initiated
  only in v1 (explicit export + publish flow).

---

## Phase 24 — Cloud backup + restore (was 22)

**v1 scope**

- AES-256-GCM encryption, user-provided key stored in system keychain.
- **Two storage backends:** S3-compatible (AWS / Backblaze / R2 / Wasabi /
  MinIO) + local path.
- Daily full snapshots. Integrity check after creation.
- Canonical backup manifest (tables, row counts, checksums, schema
  version) — added to core now, read by backup.
- Import on a fresh instance restores everything.

**Cut / deferred**

- **Google Drive / Dropbox** — OAuth compliance surface balloons for
  dubious benefit.
- **Incremental backup** — SQLite page-level deltas are hard to get right.
  Daily full snapshots + S3 lifecycle rules for retention are simpler and
  survive restore corner cases.
- **BIP-39 recovery phrase** — dangerous UX. Users lose it → data bricked.
  Document "key loss = data loss" instead of implying recovery.
- **"Open Hipp0 Cloud" hosted offering** — drops out; we run no
  infrastructure.

---

## Phase 25 — Offline mode (was 24)

**v1 scope**

- **Generalize the Phase-19 mobile sync infrastructure** to cover the
  desktop CLI + self-hosted server. Don't build a parallel offline system.
- Cache-first reads (decisions, skills, memory, user model).
- Queued outbound actions with the existing `OutboundActionQueue` +
  `conflict-resolver`.
- Degraded-mode UI indicators.
- **Local LLM fallback** limited to summarization + classification.
  Ollama's tool-call support on small models is unreliable; tool use
  stays cloud-only in v1.

---

## Phase 26 — Debuggability + launch checklist (was 26 + 27 + 28 merged)

**v1 scope**

- Structured error codes (HIPP0-XXXX + message + cause + fix + docsUrl).
  Most of this already exists via Pino + `Hipp0Error`; audit coverage.
- `hipp0 debug` command generates a redacted bundle. No upload endpoint;
  paste into a GitHub issue.
- Verbose agent mode (`--verbose`).
- Error recovery UI actions in dashboard + mobile.
- Minimum viable community infra: CONTRIBUTING.md, CoC, issue templates,
  RFC template (adopted from Rust RFC).
- Launch checklist: full regression sweep, smoke on all supported
  platforms (Ubuntu, Fedora, macOS Intel, macOS Silicon, WSL2, Termux),
  security.txt, automated `pnpm audit` in CI.

**Cut / deferred**

- **Multi-language docs at launch** — maintenance burden is crushing for a
  small team. English first; community translations.
- **Bug bounty at launch** — legal + financial exposure. Use a
  `SECURITY.md` policy instead.
- **Paid external penetration test** — budget reality. First-round
  community review + automated audit in CI. Revisit if a sponsor materializes.
- **"30-day no-leak run"** — not CI-runnable. Do manually; publish the
  artifact.

---

## Community / governance — ongoing, not a phase

This was Phase 27 in the original scope. It's continuous work that scales
with actual adoption, not a milestone. It consists of:

- CONTRIBUTING.md + CODE_OF_CONDUCT.md + SECURITY.md.
- Issue + PR templates.
- RFC process (adopt Rust or Swift Evolution; don't invent).
- Discord / discussion forum when demand materializes.

Ship the base docs with Phase 26 (launch checklist), treat everything else
as opportunistic.

---

## Out of scope for Phase 3 entirely

These were implied by the original prompt or by ambient project goals; this
doc explicitly punts them.

- **Hosted SaaS layer.** The project runs no infrastructure. Any hosted
  offering is a separate project by a separate party.
- **Commercial skill marketplace billing.** Out of scope for the phase;
  possibly out of scope for the project.
- **Apple Enterprise distribution ($299/yr).** Apple revokes certs used for
  public OSS distribution. TestFlight external + APK sideload cover the
  actual use case.
- **Public relay infrastructure.** The `@openhipp0/relay` package exists
  so any user can run their own; the Open Hipp0 project does not run one.
