// @openhipp0/core — Agent runtime, LLM abstraction, tool execution, orchestrator
//
// Phase 1e-i ships the LLM foundation: types, circuit breaker, retry, cost
// tracker. Providers + client land in 1e-ii; tools + agent runtime in 1f/1g.

export const packageName = '@openhipp0/core' as const;
export const version = '0.0.0' as const;

/** LLM abstraction. See packages/core/src/llm/ for details. */
export * as llm from './llm/index.js';
