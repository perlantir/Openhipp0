/**
 * Public surface of @openhipp0/core/llm.
 *
 * Phase 1e-i exports: types, circuit breaker, retry, cost tracker.
 * Phase 1e-ii will add: providers (Anthropic / OpenAI / Ollama) + client.
 */

export * from './types.js';
export { CircuitBreaker, type CircuitState, type ClockFn } from './circuit-breaker.js';
export { retry, computeDelayMs, defaultIsRetryable, type RetryOptions } from './retry.js';
export {
  BudgetEnforcer,
  computeCostUsd,
  getPrice,
  registerPrice,
  type BudgetStatus,
  type ModelPrice,
  type SpendEntry,
} from './cost-tracker.js';
