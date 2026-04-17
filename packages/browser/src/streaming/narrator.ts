/**
 * Browser narrator — event interface for streaming browser-task progress.
 * G1-f ships the interface + an in-memory buffer sink; G2 wires real
 * transport (WebSocket / bridge adapters / dashboard).
 */

import { EventEmitter } from 'node:events';

export type NarrationEventKind =
  | 'task-started'
  | 'task-step'
  | 'tool-preview'
  | 'tool-executed'
  | 'screenshot'
  | 'partial-output'
  | 'awaiting-approval'
  | 'interrupted'
  | 'task-done'
  | 'task-failed';

export interface NarrationEvent {
  readonly kind: NarrationEventKind;
  readonly at: string;
  readonly taskId: string;
  readonly message?: string;
  readonly toolName?: string;
  readonly toolArgs?: Readonly<Record<string, unknown>>;
  readonly screenshotPngB64?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NarratorSink {
  emit(event: NarrationEvent): void;
}

/** Default sink: stores up to `capacity` events for later retrieval. */
export class BufferSink implements NarratorSink {
  readonly #capacity: number;
  readonly #buffer: NarrationEvent[] = [];

  constructor(capacity = 1000) {
    this.#capacity = capacity;
  }

  emit(event: NarrationEvent): void {
    this.#buffer.push(event);
    if (this.#buffer.length > this.#capacity) this.#buffer.shift();
  }

  all(): readonly NarrationEvent[] {
    return [...this.#buffer];
  }

  clear(): void {
    this.#buffer.length = 0;
  }
}

/** EventEmitter-backed sink — consumers `on('narration', cb)`. */
export class EmitterSink implements NarratorSink {
  readonly #emitter = new EventEmitter();

  emit(event: NarrationEvent): void {
    this.#emitter.emit('narration', event);
  }

  on(listener: (event: NarrationEvent) => void): () => void {
    const fn = (ev: NarrationEvent): void => listener(ev);
    this.#emitter.on('narration', fn);
    return () => this.#emitter.off('narration', fn);
  }
}

/**
 * Narrator — thin facade over a sink. Browser-v2 components call
 * `narrator.step(...)`, `narrator.toolPreview(...)`, etc.; the sink
 * decides what to do with the events (buffer, forward, stream via
 * WebSocket, etc.).
 */
export class Narrator {
  readonly #sink: NarratorSink;
  readonly #taskId: string;
  readonly #now: () => string;

  constructor(sink: NarratorSink, taskId: string, now: () => string = () => new Date().toISOString()) {
    this.#sink = sink;
    this.#taskId = taskId;
    this.#now = now;
  }

  #emit(kind: NarrationEventKind, rest: Omit<NarrationEvent, 'kind' | 'taskId' | 'at'> = {}): void {
    this.#sink.emit({ kind, at: this.#now(), taskId: this.#taskId, ...rest });
  }

  started(message?: string, metadata?: Record<string, unknown>): void {
    this.#emit('task-started', {
      ...(message ? { message } : {}),
      ...(metadata ? { metadata } : {}),
    });
  }

  step(message: string, metadata?: Record<string, unknown>): void {
    this.#emit('task-step', { message, ...(metadata ? { metadata } : {}) });
  }

  toolPreview(toolName: string, toolArgs: Record<string, unknown>): void {
    this.#emit('tool-preview', { toolName, toolArgs });
  }

  toolExecuted(toolName: string, metadata?: Record<string, unknown>): void {
    this.#emit('tool-executed', { toolName, ...(metadata ? { metadata } : {}) });
  }

  screenshot(pngB64: string, message?: string): void {
    this.#emit('screenshot', {
      screenshotPngB64: pngB64,
      ...(message ? { message } : {}),
    });
  }

  partial(text: string): void {
    this.#emit('partial-output', { message: text });
  }

  awaitingApproval(message: string): void {
    this.#emit('awaiting-approval', { message });
  }

  interrupted(message: string): void {
    this.#emit('interrupted', { message });
  }

  done(message?: string): void {
    this.#emit('task-done', message ? { message } : {});
  }

  failed(message: string): void {
    this.#emit('task-failed', { message });
  }
}
