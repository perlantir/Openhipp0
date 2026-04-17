/**
 * Streaming adapter for bridges — turns `StreamEvent`s from
 * `@openhipp0/core/streaming` into bridge-facing actions (edit-message
 * updates, new-message sends, reaction buttons for approval).
 *
 * Baseline `formatStreamEvent` produces a markdown string suitable for
 * any bridge that supports text. Per-bridge adapters (WebBridge uses
 * edit-in-place; Telegram/Discord batch edits; WhatsApp chunks at
 * sentence boundaries) override the rendering strategy.
 */

import type { streaming } from '@openhipp0/core';

type StreamEvent = streaming.StreamEvent;

export interface StreamingBridgeDeps {
  /** Called for every event — the bridge decides whether to send/edit. */
  readonly handle: (event: StreamEvent, accumulated: string) => Promise<void> | void;
}

export function formatStreamEvent(event: StreamEvent): string {
  switch (event.kind) {
    case 'turn-started':
      return '';
    case 'token':
      return event.text;
    case 'partial':
      return event.text + '\n';
    case 'tool-call-preview':
      return `\n_**${event.toolName}** — awaiting approval_${event.summary ? `\n> ${event.summary}` : ''}\n`;
    case 'tool-call-approved':
      return `\n✓ _${event.toolName} approved_\n`;
    case 'tool-call-rejected':
      return `\n✗ _${event.toolName} rejected${event.reason ? `: ${event.reason}` : ''}_\n`;
    case 'tool-call-execute':
      return `\n_running **${event.toolName}**…_\n`;
    case 'tool-result':
      return event.ok
        ? `\n_**${event.toolName}** returned_\n`
        : `\n_**${event.toolName}** failed: ${event.error}_\n`;
    case 'progress':
      return `\n_${event.label}${event.fraction !== null ? ` (${Math.round(event.fraction * 100)}%)` : ''}_\n`;
    case 'interrupted':
      return `\n_interrupted: ${event.reason}_\n`;
    case 'error':
      return `\n**error** [${event.externalCode ?? event.code}]: ${event.message}\n`;
    case 'done':
      return '';
    default:
      return '';
  }
}

/**
 * Accumulates tokens into a single message and invokes `handle` on every
 * event. Bridges that support edit-in-place (Telegram, Discord, Slack,
 * Web) use `accumulated` as the full message; bridges without edit
 * (WhatsApp, SMS) can detect sentence boundaries and emit chunks.
 */
export class StreamingAccumulator {
  readonly #deps: StreamingBridgeDeps;
  #acc = '';

  constructor(deps: StreamingBridgeDeps) {
    this.#deps = deps;
  }

  async push(event: StreamEvent): Promise<void> {
    const piece = formatStreamEvent(event);
    if (piece) this.#acc += piece;
    await this.#deps.handle(event, this.#acc);
  }

  get text(): string {
    return this.#acc;
  }

  reset(): void {
    this.#acc = '';
  }
}

// ─── Sentence-boundary chunker (for WhatsApp / SMS) ────────────────────────

export interface ChunkedEmitOpts {
  readonly minChunkChars?: number;
  readonly maxChunkChars?: number;
}

export class SentenceChunker {
  readonly #min: number;
  readonly #max: number;
  #buffer = '';

  constructor(opts: ChunkedEmitOpts = {}) {
    this.#min = opts.minChunkChars ?? 80;
    this.#max = opts.maxChunkChars ?? 1000;
  }

  push(text: string): string | null {
    this.#buffer += text;
    if (this.#buffer.length < this.#min) return null;
    const idx = this.#nextBoundary();
    if (idx < 0 && this.#buffer.length < this.#max) return null;
    if (idx < 0) {
      // Hard flush at max
      const chunk = this.#buffer.slice(0, this.#max);
      this.#buffer = this.#buffer.slice(this.#max);
      return chunk;
    }
    const chunk = this.#buffer.slice(0, idx + 1);
    this.#buffer = this.#buffer.slice(idx + 1).trimStart();
    return chunk;
  }

  flush(): string | null {
    if (this.#buffer.length === 0) return null;
    const out = this.#buffer;
    this.#buffer = '';
    return out;
  }

  #nextBoundary(): number {
    // Last sentence-terminator that leaves room for at least #min chars of prefix.
    const candidates = [...this.#buffer.matchAll(/[.!?](?=\s|$)/g)];
    for (let i = candidates.length - 1; i >= 0; i--) {
      const pos = candidates[i]!.index!;
      if (pos >= this.#min) return pos;
    }
    return -1;
  }
}
