// @openhipp0/core — Agent runtime, LLM abstraction, tool execution, orchestrator
//
// Phase 1e: LLM (types, circuit breaker, retry, cost, providers, client).
// Phase 1f: Tools (registry, path/domain guard, sandbox, built-in tools).
// Phase 1g: Agent runtime loop (prompt builder, decision protocol, main loop).

export const packageName = '@openhipp0/core' as const;
export const version = '0.0.0' as const;

/** LLM abstraction. See packages/core/src/llm/ for details. */
export * as llm from './llm/index.js';

/** Tool execution: registry, permissions, path guard, sandbox, built-ins. */
export * as tools from './tools/index.js';

/** Agent runtime loop. */
export * as agent from './agent/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Top-level re-exports — the handful of types that cross package boundaries
// (memory package's MemoryAdapter implementation, external SDK consumers).
// ─────────────────────────────────────────────────────────────────────────────

export type {
  AgentIdentity,
  AgentResponse,
  AgentRuntimeConfig,
  AgentRuntimeHooks,
  AgentSystemPromptSection,
  CompileContextRequest,
  CompiledContext,
  HandleMessageRequest,
  MemoryAdapter,
  SessionSummary,
  StoppedReason,
} from './agent/index.js';

export type {
  ContentBlock,
  LLMProvider,
  Message,
  TextBlock,
  ToolDef,
  ToolResultBlock,
  ToolUseBlock,
} from './llm/index.js';

/** Skills engine: manifest validation, loader with precedence, registry. */
export * as skills from './skills/index.js';

/** Mobile-pairing primitives (Phase 19). */
export * as pairing from './pairing/index.js';

/** Push notifications — server-side sender + registry (Phase 19C). */
export * as push from './push/index.js';

/** Security: agent policy enforcement, templates, execution governance. */
export * as security from './security/index.js';

/** Multi-agent orchestrator: team config, skill-based routing, fallback. */
export * as orchestrator from './orchestrator/index.js';

/** Browser automation: Playwright-backed engine, page analyzer, 6 browser_* tools. */
export * as browser from './browser/index.js';

/** OAuth2 foundation: authorization-code + PKCE, token store, provider presets. */
export * as auth from './auth/index.js';

/** Third-party integrations: brave / github / gmail / linear (Phase 10). */
export * as integrations from './integrations/index.js';

/** Voice, image generation, vision (Phase 11). */
export * as media from './media/index.js';

/** Enterprise: RLS, SSO, org model, audit export, per-agent API keys (Phase 14). */
export * as enterprise from './enterprise/index.js';

/** Training data pipeline: trajectory export, batch runner, compression (Phase 15). */
export * as training from './training/index.js';

/** Phase 24 — AES-256-GCM encrypted backup + restore (local + S3-compatible). */
export * as backup from './backup/index.js';

/** Phase 25 — Offline mode primitives (outbound queue, conflict resolver, cache-first, local-LLM stub). */
export * as offline from './offline/index.js';

/** Phase 26 — Debuggability: structured error codes, debug bundle redactor, verbose agent trace. */
export * as debuggability from './debuggability/index.js';

/** Phase B1 — Reflection: rubric-gated self-critique + async outcome assessment. */
export * as reflection from './reflection/index.js';

/** Phase B2 — Planning: complexity gate + evidence-validated step tracker. */
export * as planning from './planning/index.js';

// Ergonomic top-level re-exports for consumers (e2e, SDK).
export {
  toJsonl,
  fromJsonl,
  toSftExamples,
  toDpoExamples,
  toAtropos,
  compressTrajectory,
  runBatch,
  createMemoryCheckpointStore,
} from './training/index.js';
export type {
  Trajectory,
  TrajectoryMessage,
  TrajectoryOutcome,
  TrajectoryDecision,
  TrajectorySkill,
  SftExample,
  DpoExample,
  AtroposTrajectory,
  Task as TrainingTask,
} from './training/index.js';

// Top-level re-exports — consumers in @openhipp0/bridge etc. want to use the
// MediaEngine + stub classes without the `media.` namespace prefix.
export {
  MediaEngine,
  OpenAIWhisperProvider,
  WhisperCppProvider,
  OpenAITtsProvider,
  LocalTtsStub,
  OpenAIImageProvider,
  ClaudeVisionProvider,
  OpenAIVisionProvider,
  LocalVisionStub,
  enrichMessage,
  transcribeVoiceAttachment,
  describeImageAttachment,
  Hipp0MediaError,
} from './media/index.js';
export type {
  MediaEngineConfig,
  TranscriptionProvider,
  TranscribeOptions,
  TranscriptionInput,
  TranscriptionResult,
  TtsProvider,
  TtsInput,
  TtsResult,
  ImageGenerationProvider,
  ImageGenerationInput,
  ImageGenerationResult,
  VisionProvider,
  VisionImage,
  VisionDescribeInput,
  VisionDescribeResult,
  VoiceAttachment,
  ImageAttachment,
} from './media/index.js';

// Runtime classes consumed by external packages (memory adapter, SDK).
export { AgentRuntime } from './agent/index.js';
export { LLMClient } from './llm/index.js';
export { ToolRegistry } from './tools/index.js';
