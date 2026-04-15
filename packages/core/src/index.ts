// @openhipp0/core — Agent runtime, LLM abstraction, tool execution, orchestrator
//
// Phase 1e: LLM (types, circuit breaker, retry, cost, providers, client).
// Phase 1f: Tools (registry, path/domain guard, sandbox, built-in tools).
// Phase 1g: Agent runtime loop (next).

export const packageName = '@openhipp0/core' as const;
export const version = '0.0.0' as const;

/** LLM abstraction. See packages/core/src/llm/ for details. */
export * as llm from './llm/index.js';

/** Tool execution: registry, permissions, path guard, sandbox, built-ins. */
export * as tools from './tools/index.js';
