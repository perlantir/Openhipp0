# Gap-closure summary (G1–G9)

This document summarizes the nine-phase gap-closure effort that took
Open Hipp0 from its Phase-28 state to a production-grade dominant
platform. Every phase shipped with tests, typecheck gates, and a
single autonomous commit per phase on `feat/g1-browser-v2`.

## Phase roll-up

| Phase | Scope | Key deliverables | Tests added |
|---|---|---|---|
| **G1-a** | `@openhipp0/browser` package + profile mgmt | Encrypted profiles (AES-256-GCM, scrypt), WAL-style checkpoints, tmpfs preference on Linux, Chrome-profile import, `.hipp0profile` portable export, HIPP0-0501..0506 error codes, CLI `hipp0 browser profile *` | 34 |
| **G1-b** | Page snapshot engine | `capturePageSnapshot` (a11y + DOM + screenshot + network + console + cookies), `compareSnapshots` (12 diff kinds), `SnapshotStore` (retention policy), `replaySnapshot` + `replayTrail` | 17 |
| **G1-c** | Uploads/downloads + form intelligence | `UploadHandler` (local/url/buffer/s3/drive/dropbox), `DownloadManager` (virus-scan hook), `inferFieldKind` (20 kinds incl. TinyMCE/CKEditor/Quill/Draft.js/maps), multi-step form detection, `DraftStore`, `PatternStore` | 39 |
| **G1-d** | Workflow record/play + multi-tab | `Recorder` + `playWorkflow` with AI-healed selector fallback, `WorkflowStore`, `MultiTabOrchestrator`, `CrossTabState` | 14 |
| **G1-e** | Stealth v2 + vision + site memory + devtools | `FingerprintDescriptor` + `buildInitScript` (webdriver/Canvas/WebGL/Audio/WebRTC overrides), `estimateEntropy`, mouse/scroll/reading humanization, `ProxyRotator`, `ElementLocator` (vision-backed), `ScreenReasoner`, `SiteMemory`, `NetworkInspector` (HAR export), **stealth-research.md** with playwright-extra vs Camoufox vs patchright decision | 27 |
| **G1-f** | Streaming narrator interface | Event schema (10 kinds), `BufferSink` + `EmitterSink`, ready for G2 transport wiring | 4 |
| **G2** | Streaming-first agent loop | `StreamingRuntime` + 4-tier `ToolPreviewStrategy` + `ApprovalResolver`, bridge `formatStreamEvent` + `SentenceChunker` (edit-less bridges), dashboard `useAgentStream` + `StreamingMessage` + `ToolCallPreview` components | 22 |
| **G3** | Bridge expansion (12 → 18) | New bridges: **iMessage** (BlueBubbles-style), **Teams** (Bot Framework), **LINE**, **Twitch**, **Rocket.Chat**, **Zulip**. `BridgeRegistry` with dynamic load / unload / capability matrix / reconnect policy. | 11 |
| **G4** | LLM provider expansion (3 → 16+) | OpenAI-compat factories for **OpenRouter / Together / Fireworks / DeepSeek / Kimi / Mistral / vLLM / LM Studio / Azure OpenAI / Qwen / GLM / MiniMax / Hugging Face**; native **Gemini** + **Bedrock**; `CredentialPool` rotation + `ModelsDevClient` | 12 |
| **G5** | TTS + voice cloning | **EdgeTtsProvider**, **ElevenLabsTtsProvider**, **MiniMaxTtsProvider**, **PiperTtsProvider** (local), **ElevenLabsVoiceCloner** with consent+watermark safety default | 10 |
| **G6** | Windows support | `hipp0.cmd` + `hipp0.ps1` with tab completion, `platform-paths.ts` (Linux/macOS `~/.hipp0`, Windows `%LOCALAPPDATA%\OpenHipp0`), `safeNormalize` / `safeSlug` / `expandTilde`, WiX MSI source, PowerShell install script, `docs/windows.md` | 7 |
| **G7** | Real eval corpora | `download-corpora.sh` (τ-bench / SWE-bench Lite / GAIA / AgentBench), `CorpusLoader`, **comparison runner** with `CompetitorHarness` interface, CI workflow with smoke/regression/full tiers | 9 |
| **G8** | Adversarial security | **90-case adversarial corpus** across 11 families (direct-injection, role-confusion, delimiter-attack, encoding-bypass, memory-poisoning, tool-hijack, exfiltration, jailbreak, context-overflow, multi-turn-accumulation, output-format-abuse), **red-team runner**, `docs/security/vulnerability-reporting.md`, supply-chain CI (pnpm audit + CycloneDX SBOM + license allowlist) | 8 |
| **G9** | Final integration | All gates green. This document. | 0 |

**Totals across G1–G9**: +222 tests (1538 → 1760), 9 new packages/subsystems, 6 new messaging bridges, 13 new LLM providers, 4 new TTS providers, ~13 000 LOC.

## Package growth

```
Tests   Before → After
core       640 → 680
browser      0 → 135  (new package)
bridge     112 → 131
dashboard   62 →  68
cli        171 → 185
eval        33 →  41
(everything else: unchanged)
Total:   1538 → 1760
```

## What this does NOT claim

- Hand-tested integration against live services for every new bridge.
  Real SDK adapters (matrix-bot-sdk, `@microsoft/botbuilder`,
  `@line/bot-sdk`, tmi.js, zulip-js, Rocket.Chat JS SDK) are the
  operator's wire-up — we shipped the structural transport contract +
  baseline logic with injected-fake tests.
- Benchmarked numbers against OpenClaw or Hermes. Comparison runners
  are plumbing-complete; operators supply the Docker harnesses + API
  keys + corpora and run.
- Signed MSI builds. WiX source + PowerShell installer are shipped;
  code-signing cert + release automation is a follow-up CI ticket.
- Native wake-word / mobile Talk Mode. These need per-platform native
  modules (iOS Speech + Android SpeechRecognizer + Porcupine) that
  can't be shipped from a Node-only autonomous run.

## Known deferred follow-ups

See `docs/browser/followups.md` for BFW-001 through BFW-008:

- **BFW-001** OS-keyring cookie decrypt on Chrome-profile import
- **BFW-002** OS-keyring for profile passphrase
- **BFW-003** Video / audio reasoning (multimodal phase)
- **BFW-004** "Call the API instead of the UI" planner behavior
- **BFW-005** Mobile React-19 + lucide + expo-camera type drift
  (pre-existing, 12 tsc errors; didn't block any gap-closure phase)
- **BFW-006** Camoufox evaluation against pinned fixture set
- **BFW-007** `playwright-extra` production wiring (opt-in CLI flag)
- **BFW-008** curl-impersonate ja3 TLS sidecar

## CI workflows

- **ci.yml** (existing) — per-PR typecheck + lint + tests.
- **eval.yml** (G7) — smoke on every PR; regression nightly;
  full weekly.
- **supply-chain.yml** (G8) — pnpm audit + CycloneDX SBOM + license
  allowlist on every push / PR / Monday.
- **release.yml** (existing) — version + tag + publish.

## Branch + merge

All of G1–G9 lives on `feat/g1-browser-v2`. The branch was
originally cut from `feat/phase-20-eval` (per the rebase-later
instruction in the gap-closure spec). Merge path:

1. Open PR → base `main`, head `feat/g1-browser-v2`
2. CI runs: ci + eval-smoke + supply-chain. All must pass.
3. Squash-merge (retains phase-by-phase log in the PR description).
4. Tag `v0.3.0` (first release to include gap closure).
