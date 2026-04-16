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

/** Security: agent policy enforcement, templates, execution governance. */
export * as security from './security/index.js';

/** Multi-agent orchestrator: team config, skill-based routing, fallback. */
export * as orchestrator from './orchestrator/index.js';

// Runtime classes consumed by external packages (memory adapter, SDK).
export { AgentRuntime } from './agent/index.js';
export { LLMClient } from './llm/index.js';
export { ToolRegistry } from './tools/index.js';
