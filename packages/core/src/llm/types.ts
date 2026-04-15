/**
 * Shared LLM types and error hierarchy.
 *
 * Provider-agnostic. Each provider (Anthropic, OpenAI, Ollama) maps its native
 * API surface into these types. The client (packages/core/src/llm/client.ts)
 * composes providers into a failover chain with budget + circuit breaker.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Message + content types
// ─────────────────────────────────────────────────────────────────────────────

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: Role;
  content: string | ContentBlock[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions (JSON-Schema based)
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema for the tool's input. */
  inputSchema: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming + sync response types
// ─────────────────────────────────────────────────────────────────────────────

export type StreamChunk =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; inputDelta: string }
  | { type: 'message_stop'; stopReason: StopReason; usage: TokenUsage };

export type StopReason = 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | 'other';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResponse {
  content: ContentBlock[];
  stopReason: StopReason;
  usage: TokenUsage;
  model: string;
  provider: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Call options
// ─────────────────────────────────────────────────────────────────────────────

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  tools?: ToolDef[];
  toolChoice?: 'auto' | 'any' | 'none' | { name: string };
  signal?: AbortSignal;
  system?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider interface
// ─────────────────────────────────────────────────────────────────────────────

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  /** Streaming chat. Yields chunks; final return is the complete assembled response. */
  chat(messages: Message[], options?: LLMOptions): AsyncGenerator<StreamChunk, LLMResponse>;
  /** Non-streaming chat. Prefer `chat()` in user-facing paths. */
  chatSync(messages: Message[], options?: LLMOptions): Promise<LLMResponse>;
  /** Approximate token count (for budget planning, not billing). */
  countTokens(text: string): number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Client configuration
// ─────────────────────────────────────────────────────────────────────────────

export type ProviderType = 'anthropic' | 'openai' | 'ollama';

export interface ProviderConfig {
  type: ProviderType;
  model: string;
  /** If omitted, read from env: ANTHROPIC_API_KEY / OPENAI_API_KEY (ollama ignored). */
  apiKey?: string;
  /** Override the default provider endpoint (e.g. for Ollama or proxies). */
  baseUrl?: string;
  /** Maximum concurrent requests against this provider. Default: unlimited. */
  maxConcurrent?: number;
}

export interface BudgetConfig {
  dailyLimitUsd: number;
  /** Emit a warning when spend crosses this fraction of dailyLimitUsd. Default: 0.8 */
  alertAtPercent?: number;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  /** Add random jitter ±25% of computed delay. Default: true. */
  jitter?: boolean;
}

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before the circuit opens. */
  failureThreshold: number;
  /** How long to stay open before attempting a half-open probe. */
  resetTimeMs: number;
}

export interface LLMClientConfig {
  /** Ordered failover chain. First entry is primary. */
  providers: ProviderConfig[];
  budget?: BudgetConfig;
  retry?: RetryConfig;
  circuitBreaker?: CircuitBreakerConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error hierarchy (Hipp0Error → *)
// ─────────────────────────────────────────────────────────────────────────────

export class Hipp0Error extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class Hipp0LLMError extends Hipp0Error {
  readonly provider: string;
  readonly httpStatus: number | undefined;
  readonly retryable: boolean;
  constructor(
    message: string,
    provider: string,
    httpStatus: number | undefined = undefined,
    retryable = false,
  ) {
    super(message, 'HIPP0_LLM_ERROR');
    this.provider = provider;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

export class Hipp0BudgetExceededError extends Hipp0Error {
  readonly dailyLimitUsd: number;
  readonly currentUsd: number;
  constructor(dailyLimitUsd: number, currentUsd: number) {
    super(
      `Daily LLM budget exceeded: $${currentUsd.toFixed(4)} spent against $${dailyLimitUsd.toFixed(2)} limit`,
      'HIPP0_BUDGET_EXCEEDED',
    );
    this.dailyLimitUsd = dailyLimitUsd;
    this.currentUsd = currentUsd;
  }
}

export class Hipp0CircuitOpenError extends Hipp0Error {
  readonly provider: string;
  readonly retryAfterMs: number;
  constructor(provider: string, retryAfterMs: number) {
    super(
      `Circuit breaker open for provider "${provider}"; retry after ${retryAfterMs}ms`,
      'HIPP0_CIRCUIT_OPEN',
    );
    this.provider = provider;
    this.retryAfterMs = retryAfterMs;
  }
}

export class Hipp0RetryExhaustedError extends Hipp0Error {
  readonly attempts: number;
  // `cause` exists on Error (Node 16.9+). Override to narrow & document.
  override readonly cause: unknown;
  constructor(message: string, attempts: number, cause: unknown) {
    super(message, 'HIPP0_RETRY_EXHAUSTED');
    this.attempts = attempts;
    this.cause = cause;
  }
}

export class Hipp0TimeoutError extends Hipp0Error {
  readonly timeoutMs: number;
  constructor(message: string, timeoutMs: number) {
    super(message, 'HIPP0_TIMEOUT');
    this.timeoutMs = timeoutMs;
  }
}

export class Hipp0AllProvidersFailedError extends Hipp0Error {
  readonly providerErrors: readonly { provider: string; error: unknown }[];
  constructor(providerErrors: readonly { provider: string; error: unknown }[]) {
    super(`All ${providerErrors.length} provider(s) failed`, 'HIPP0_ALL_PROVIDERS_FAILED');
    this.providerErrors = providerErrors;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas — use at API boundaries (CLI flags, config files, HTTP endpoints)
// ─────────────────────────────────────────────────────────────────────────────

export const ProviderConfigSchema = z.object({
  type: z.enum(['anthropic', 'openai', 'ollama']),
  model: z.string().min(1),
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  maxConcurrent: z.number().int().positive().optional(),
}) satisfies z.ZodType<ProviderConfig>;

export const BudgetConfigSchema = z.object({
  dailyLimitUsd: z.number().positive(),
  alertAtPercent: z.number().min(0).max(1).optional(),
}) satisfies z.ZodType<BudgetConfig>;

export const RetryConfigSchema = z.object({
  maxAttempts: z.number().int().positive(),
  baseDelayMs: z.number().positive(),
  maxDelayMs: z.number().positive().optional(),
  jitter: z.boolean().optional(),
}) satisfies z.ZodType<RetryConfig>;

export const CircuitBreakerConfigSchema = z.object({
  failureThreshold: z.number().int().positive(),
  resetTimeMs: z.number().positive(),
}) satisfies z.ZodType<CircuitBreakerConfig>;

export const LLMClientConfigSchema = z.object({
  providers: z.array(ProviderConfigSchema).min(1),
  budget: BudgetConfigSchema.optional(),
  retry: RetryConfigSchema.optional(),
  circuitBreaker: CircuitBreakerConfigSchema.optional(),
}) satisfies z.ZodType<LLMClientConfig>;
