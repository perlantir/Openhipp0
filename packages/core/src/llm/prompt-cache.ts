/**
 * Provider-side prompt caching (L6 — largest guaranteed win).
 *
 * Anthropic's `cache_control: {type: 'ephemeral'}` marks a content block
 * as a cache breakpoint. Subsequent calls with the same prefix read from
 * the cache (~90% discount on input tokens for cached prefix).
 *
 * This module adds opt-in markers to LLMOptions + ToolDef, and helpers
 * the providers use to translate markers into provider-specific shapes.
 *
 * Stable prefixes we want cached, in priority order:
 *   1. System prompt (usually 500-5000 tokens, identical across turns)
 *   2. Tool definitions (typically 1000-3000 tokens, identical per session)
 *   3. Large fixed context (user model, recalled decisions — these change
 *      less often than the latest user turn)
 *
 * Ephemeral breakpoints cost +25% of prefix tokens on write; a prefix
 * must be reused at least twice to break even. Don't set them on blocks
 * that are unique to a single turn.
 */

import type { LLMOptions, Message, ToolDef } from './types.js';

export interface CacheBreakpointOptions {
  /** Cache the system prompt. Set this when system is stable across turns. */
  readonly system?: boolean;
  /** Cache tool definitions. Set this when the tool list is stable across turns. */
  readonly tools?: boolean;
  /**
   * Cache the first N user-role messages (the oldest turns, typically
   * setup context). Pass 0 to cache nothing; pass Infinity to cache all.
   * Default: 0 (no message caching).
   */
  readonly firstNMessages?: number;
}

/** Augmented LLMOptions carrying cache hints. Providers read this opt-in only. */
export interface CacheAwareOptions extends LLMOptions {
  readonly cacheBreakpoints?: CacheBreakpointOptions;
}

export interface CacheUsage {
  /** Tokens read from cache (90% discount). */
  readonly cachedInputTokens: number;
  /** Tokens written to cache (25% premium). */
  readonly cacheCreationInputTokens: number;
}

/** Mark a system-prompt string as cacheable; provider reads the tag. */
export function tagSystemAsCacheable(system: string): { text: string; cacheControl: true } {
  return { text: system, cacheControl: true };
}

/** Mark tool defs as cacheable; caller merges the result into LLMOptions.tools. */
export function tagToolsAsCacheable(tools: readonly ToolDef[]): readonly ToolDef[] {
  return tools.map((t) => ({ ...t, __cache: true } as ToolDef & { __cache?: boolean }));
}

/**
 * Compute the boundary index for `firstNMessages` caching. The boundary
 * is the last message index to mark as cacheable; messages past it are
 * treated as hot. Returns -1 when no messages should be cached.
 */
export function cacheBoundaryIndex(
  messages: readonly Message[],
  firstN: number | undefined,
): number {
  if (!firstN || firstN <= 0) return -1;
  const capped = Math.min(firstN, messages.length);
  return capped - 1;
}
