/**
 * Exact-match response cache (L1 in the cost-optimization matrix).
 *
 * Hashes a deterministic digest of (messages, system, tools, temperature,
 * topP, stopSequences) to a cached LLMResponse. Identical prompts inside
 * the TTL window return the prior response without a provider call.
 *
 * NOT a semantic cache — paraphrases miss. This is the simplest, safest
 * win; semantic caches (L2) are deferred per scope doc due to privacy
 * footgun (one user's paraphrase hits another's cache).
 *
 * Limitations:
 *   - In-memory only (no cross-process sharing).
 *   - TTL-based eviction; no LRU cap unless `maxEntries` is supplied.
 *   - Streaming responses aren't cached — only `chatSync` results.
 *   - Usage is reported as zero tokens on a cache hit so metrics reflect
 *     the actual (zero) provider spend.
 */

import crypto from 'node:crypto';
import type { LLMOptions, LLMResponse, Message } from './types.js';

export interface ExactCacheOptions {
  /** TTL in ms. Default: 5 minutes. */
  readonly ttlMs?: number;
  /** Max entries before LRU eviction. Default: unlimited (but entries still expire). */
  readonly maxEntries?: number;
  /** Override for tests. Default: Date.now. */
  readonly now?: () => number;
}

export interface ExactCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly size: number;
  readonly evictions: number;
}

interface Entry {
  readonly response: LLMResponse;
  readonly expiresAt: number;
  lastAccessed: number;
}

export class ExactCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly map = new Map<string, Entry>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(opts: ExactCacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 5 * 60_000;
    this.maxEntries = opts.maxEntries ?? Number.POSITIVE_INFINITY;
    this.now = opts.now ?? Date.now;
  }

  get(messages: readonly Message[], options: LLMOptions = {}): LLMResponse | null {
    const key = cacheKey(messages, options);
    const entry = this.map.get(key);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    const t = this.now();
    if (entry.expiresAt <= t) {
      this.map.delete(key);
      this.misses += 1;
      return null;
    }
    entry.lastAccessed = t;
    this.hits += 1;
    // Rebuild response with usage zeroed — the cache hit did not cost tokens.
    return { ...entry.response, usage: { inputTokens: 0, outputTokens: 0 } };
  }

  set(
    messages: readonly Message[],
    options: LLMOptions,
    response: LLMResponse,
  ): void {
    const key = cacheKey(messages, options);
    const t = this.now();
    this.map.set(key, { response, expiresAt: t + this.ttlMs, lastAccessed: t });
    this.evictIfOverflow();
  }

  stats(): ExactCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.map.size,
      evictions: this.evictions,
    };
  }

  clear(): void {
    this.map.clear();
  }

  private evictIfOverflow(): void {
    if (!Number.isFinite(this.maxEntries)) return;
    while (this.map.size > this.maxEntries) {
      // Evict the LRU entry (oldest lastAccessed).
      let lruKey: string | undefined;
      let lruAt = Number.POSITIVE_INFINITY;
      for (const [k, v] of this.map) {
        if (v.lastAccessed < lruAt) {
          lruAt = v.lastAccessed;
          lruKey = k;
        }
      }
      if (lruKey === undefined) return;
      this.map.delete(lruKey);
      this.evictions += 1;
    }
  }
}

export function cacheKey(messages: readonly Message[], options: LLMOptions): string {
  const payload = {
    messages,
    system: options.system,
    tools: options.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
    toolChoice: options.toolChoice,
    temperature: options.temperature,
    topP: options.topP,
    stopSequences: options.stopSequences,
  };
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
