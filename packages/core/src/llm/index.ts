/**
 * Public surface of @openhipp0/core/llm.
 *
 * Phase 1e-i: types, circuit breaker, retry, cost tracker.
 * Phase 1e-ii: providers (Anthropic / OpenAI / Ollama) + failover client.
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
export {
  MODEL_CATALOG,
  lookupModel,
  costRatio,
  isNearEol,
  isDeprecated,
  type ModelRecord,
} from './model-catalog.js';
export {
  validateHotSwap,
  CanaryRouter,
  DEFAULT_COST_BUDGET_MULTIPLIER,
  type HotSwapProposal,
  type HotSwapVerdict,
  type HotSwapReject,
  type CanaryRouterOptions,
  type CanaryDecision,
} from './hot-swap.js';
export { AnthropicProvider, type AnthropicProviderOptions } from './provider-anthropic.js';
export { OpenAIProvider, type OpenAIProviderOptions } from './provider-openai.js';
export { OllamaProvider, type OllamaProviderOptions, type FetchFn } from './provider-ollama.js';
export {
  LLMClient,
  defaultProviderFactory,
  type LLMClientHooks,
  type ProviderFactory,
  type UsageRecord,
} from './client.js';
