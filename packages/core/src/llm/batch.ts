/**
 * Batch API (L7 in the cost-optimization matrix).
 *
 * Anthropic's Messages Batches API applies a 50% discount to non-
 * interactive workloads that can wait minutes-to-hours for completion.
 * This module is a thin adapter: callers submit N `(messages, options)`
 * tuples, get back a BatchHandle to poll. For scheduled tasks only —
 * interactive paths MUST use LLMClient.chatSync.
 *
 * The Anthropic SDK's batch surface is lazy-loaded to avoid pulling in
 * the sub-module on every core import.
 */

import type { LLMOptions, LLMResponse, Message } from './types.js';

export interface BatchRequest {
  readonly id: string;
  readonly messages: readonly Message[];
  readonly options?: LLMOptions;
}

export type BatchStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'canceling' | 'canceled';

export interface BatchResult {
  readonly id: string;
  readonly response?: LLMResponse;
  readonly error?: string;
}

export interface BatchHandle {
  readonly batchId: string;
  status(): Promise<BatchStatus>;
  results(): Promise<readonly BatchResult[]>;
  cancel(): Promise<void>;
}

/**
 * Minimal batch submitter — providers implement `submit()`. Keep the
 * surface small: the real-world integration sits behind Anthropic's
 * batches API; tests inject a fake that resolves immediately.
 */
export interface BatchProvider {
  submit(requests: readonly BatchRequest[]): Promise<BatchHandle>;
}

/**
 * In-memory batch provider — for tests and for the scheduler tier that
 * doesn't need the cost discount (e.g. Ollama). Completes synchronously.
 */
export function createInMemoryBatchProvider(
  handler: (req: BatchRequest) => Promise<LLMResponse>,
): BatchProvider {
  return {
    async submit(requests) {
      const results: BatchResult[] = [];
      for (const req of requests) {
        try {
          results.push({ id: req.id, response: await handler(req) });
        } catch (err) {
          results.push({
            id: req.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const batchId = `mem-${Date.now()}`;
      return {
        batchId,
        async status() {
          return 'completed';
        },
        async results() {
          return results;
        },
        async cancel() {
          /* no-op: already completed */
        },
      };
    },
  };
}
