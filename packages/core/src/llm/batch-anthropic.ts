/**
 * Anthropic Messages Batches adapter — real SDK wiring for the BatchProvider
 * contract (`packages/core/src/llm/batch.ts`).
 *
 * The Anthropic SDK's `messages.batches` surface is typed heavily. We take
 * a structural `AnthropicBatchClient` interface so tests can inject a
 * hand-rolled stub without importing the full SDK, and production passes
 * the real client (`anthropic.messages.batches`).
 *
 * Scope: this is a thin translator from our BatchRequest shape to
 * Anthropic's BatchCreateParams.Request, and from their
 * MessageBatchIndividualResponse back to our BatchResult.
 *
 * Known limitations:
 *   - Real batches can take up to 24h to complete; `status()` returns
 *     'in_progress' until the batch ends. The caller polls.
 *   - Tool use + image inputs carry through verbatim in `params`.
 *   - Cost savings (50%) are applied by Anthropic on their billing side;
 *     our cost-tracker can't tell "batch" from "interactive" from
 *     individual usage rows.
 */

import type {
  BatchHandle,
  BatchProvider,
  BatchResult,
  BatchStatus,
} from './batch.js';
import type { LLMResponse } from './types.js';

// ─── Structural SDK surface ──────────────────────────────────────────────

export interface AnthropicBatchCreateRequest {
  readonly custom_id: string;
  readonly params: {
    readonly model: string;
    readonly max_tokens: number;
    readonly messages: readonly { readonly role: 'user' | 'assistant'; readonly content: unknown }[];
    readonly system?: string;
    readonly temperature?: number;
    readonly top_p?: number;
    readonly stop_sequences?: readonly string[];
  };
}

export interface AnthropicMessageBatch {
  readonly id: string;
  readonly processing_status: 'in_progress' | 'canceling' | 'ended';
}

export interface AnthropicBatchIndividualResponse {
  readonly custom_id: string;
  readonly result:
    | { readonly type: 'succeeded'; readonly message: { readonly content: unknown[]; readonly stop_reason: string; readonly usage: { readonly input_tokens: number; readonly output_tokens: number }; readonly model: string } }
    | { readonly type: 'errored'; readonly error: { readonly type: string; readonly message: string } }
    | { readonly type: 'canceled' }
    | { readonly type: 'expired' };
}

export interface AnthropicBatchClient {
  create(params: { requests: readonly AnthropicBatchCreateRequest[] }): Promise<AnthropicMessageBatch>;
  retrieve(batchId: string): Promise<AnthropicMessageBatch>;
  results(batchId: string): Promise<AsyncIterable<AnthropicBatchIndividualResponse>>;
  cancel(batchId: string): Promise<AnthropicMessageBatch>;
}

// ─── Provider ────────────────────────────────────────────────────────────

export interface AnthropicBatchProviderOptions {
  readonly client: AnthropicBatchClient;
  /** Model to use when a BatchRequest omits options.model. */
  readonly defaultModel: string;
  /** Default max_tokens. Anthropic requires this on every request. */
  readonly defaultMaxTokens?: number;
}

export function createAnthropicBatchProvider(
  opts: AnthropicBatchProviderOptions,
): BatchProvider {
  const { client, defaultModel } = opts;
  const defaultMaxTokens = opts.defaultMaxTokens ?? 4096;

  return {
    async submit(requests): Promise<BatchHandle> {
      const sdkRequests: AnthropicBatchCreateRequest[] = requests.map((r) => ({
        custom_id: r.id,
        params: {
          model: defaultModel,
          max_tokens: r.options?.maxTokens ?? defaultMaxTokens,
          messages: r.messages.map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          })),
          ...(r.options?.system && { system: r.options.system }),
          ...(r.options?.temperature !== undefined && { temperature: r.options.temperature }),
          ...(r.options?.topP !== undefined && { top_p: r.options.topP }),
          ...(r.options?.stopSequences && { stop_sequences: r.options.stopSequences }),
        },
      }));

      const batch = await client.create({ requests: sdkRequests });
      return createHandle(client, batch.id);
    },
  };
}

function createHandle(client: AnthropicBatchClient, batchId: string): BatchHandle {
  return {
    batchId,
    async status(): Promise<BatchStatus> {
      const current = await client.retrieve(batchId);
      return mapStatus(current.processing_status);
    },
    async results(): Promise<readonly BatchResult[]> {
      const current = await client.retrieve(batchId);
      if (current.processing_status !== 'ended') return [];
      const iter = await client.results(batchId);
      const out: BatchResult[] = [];
      for await (const resp of iter) {
        out.push(toBatchResult(resp));
      }
      return out;
    },
    async cancel(): Promise<void> {
      await client.cancel(batchId);
    },
  };
}

function mapStatus(s: AnthropicMessageBatch['processing_status']): BatchStatus {
  switch (s) {
    case 'in_progress':
      return 'in_progress';
    case 'canceling':
      return 'canceling';
    case 'ended':
      return 'completed';
    default:
      return 'pending';
  }
}

function toBatchResult(resp: AnthropicBatchIndividualResponse): BatchResult {
  const result = resp.result;
  if (result.type === 'succeeded') {
    const msg = result.message;
    const response: LLMResponse = {
      content: msg.content as LLMResponse['content'],
      stopReason: mapStopReason(msg.stop_reason),
      usage: {
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
      },
      model: msg.model,
      provider: 'anthropic',
    };
    return { id: resp.custom_id, response };
  }
  if (result.type === 'errored') {
    return { id: resp.custom_id, error: `${result.error.type}: ${result.error.message}` };
  }
  if (result.type === 'canceled') {
    return { id: resp.custom_id, error: 'canceled' };
  }
  return { id: resp.custom_id, error: 'expired' };
}

function mapStopReason(raw: string): LLMResponse['stopReason'] {
  switch (raw) {
    case 'end_turn':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    default:
      return 'end_turn';
  }
}
