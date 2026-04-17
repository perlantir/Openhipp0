/**
 * Types for the agent runtime (packages/core/src/agent/).
 *
 * The runtime is the integration point between the LLM client and the tool
 * registry. It runs the agentic loop, handles tool calls, and hands off to
 * the memory module (via MemoryAdapter) for persistence and context compilation.
 */

import type { LLMClient } from '../llm/client.js';
import type { ContentBlock, Message } from '../llm/types.js';
import type { ExecutionContext } from '../tools/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ReflectionAdapter, ReflectionConfig } from '../reflection/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Agent identity + prompt building
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentIdentity {
  id: string;
  name: string;
  role: string;
}

export interface AgentSystemPromptSection {
  title: string;
  body: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory adapter — keeps core → memory directional dependency clean.
// The real implementation lives in @openhipp0/memory (Phase 2). Phase 1g
// ships a NoopMemoryAdapter that satisfies the interface.
// ─────────────────────────────────────────────────────────────────────────────

export interface MemoryAdapter {
  compileContext(req: CompileContextRequest): Promise<CompiledContext>;
  recordSession(session: SessionSummary): Promise<void>;
}

export interface CompileContextRequest {
  agent: AgentIdentity;
  projectId: string;
  userId?: string;
  /** The user's latest message — used to guide retrieval. */
  query: string;
}

export interface CompiledContext {
  /** Prompt sections to append to the system prompt. Empty is fine. */
  sections: AgentSystemPromptSection[];
}

export interface SessionSummary {
  agent: AgentIdentity;
  projectId: string;
  userId?: string;
  messages: Message[];
  iterations: number;
  toolCallsCount: number;
  tokensUsed: { input: number; output: number };
  finalText: string;
  startedAt: number;
  finishedAt: number;
  stoppedReason: StoppedReason;
}

export const NoopMemoryAdapter: MemoryAdapter = {
  async compileContext(): Promise<CompiledContext> {
    return { sections: [] };
  },
  async recordSession(): Promise<void> {
    /* no-op */
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Runtime config
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentRuntimeConfig {
  llmClient: LLMClient;
  toolRegistry: ToolRegistry;
  agent: AgentIdentity;
  projectId: string;
  /**
   * Execution context sans {agent, projectId}. The runtime injects those from
   * its own config so each tool call is attributed correctly.
   */
  executionContext: Omit<ExecutionContext, 'agent' | 'projectId'>;
  /** Default 20. The loop bails with stoppedReason=max_iterations if reached. */
  maxIterations?: number;
  /** Prepended to the system prompt (after the auto-generated header). */
  basePromptSections?: readonly AgentSystemPromptSection[];
  /** Tool names to expose. If omitted, the full registry is offered. */
  toolNames?: readonly string[];
  /** Memory adapter for context compilation + session persistence. */
  memory?: MemoryAdapter;
  /** Observability hooks. */
  hooks?: AgentRuntimeHooks;
  /** Model-level overrides. */
  model?: { temperature?: number; maxTokens?: number };
  /**
   * Reflection subsystem — opt-in draft critique + async outcome assessment.
   * When absent, reflection is disabled (no runtime cost).
   */
  reflection?: { adapter?: ReflectionAdapter; config?: ReflectionConfig };
}

export interface AgentRuntimeHooks {
  onIteration?(iteration: number, assistantContent: ContentBlock[]): void;
  onToolCall?(call: {
    name: string;
    params: unknown;
    ok: boolean;
    errorCode?: string;
    durationMs: number;
  }): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Runtime request / response
// ─────────────────────────────────────────────────────────────────────────────

export interface HandleMessageRequest {
  userId?: string;
  message: string;
  /** Prior turns (excluding the new user message). */
  conversation?: readonly Message[];
}

export type StoppedReason =
  | 'end_turn' // assistant returned text with no tool calls
  | 'max_iterations' // hit maxIterations mid-loop
  | 'tool_error_cascade' // ≥3 consecutive iterations with tool errors
  | 'llm_stop_reason' // LLM returned a non-end_turn stop (e.g. max_tokens)
  | 'other';

export interface AgentResponse {
  /** The assistant's final text (empty if stoppedReason != 'end_turn'). */
  text: string;
  /** The full message trajectory (system excluded). */
  messages: Message[];
  iterations: number;
  toolCallsCount: number;
  tokensUsed: { input: number; output: number };
  /** LLM's reported stop reason on the last response. */
  finalStopReason: string;
  stoppedReason: StoppedReason;
  startedAt: number;
  finishedAt: number;
  /** Reflection: number of revision passes applied to the final reply. */
  revisionsApplied?: number;
}
