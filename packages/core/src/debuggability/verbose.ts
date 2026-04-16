/**
 * Verbose agent trace — structured events emitted during an agent run.
 *
 * Consumers (CLI --verbose, dashboard live view, dev-mode logging) subscribe
 * to an emitter that the AgentRuntime fires into. Events are small, JSON-
 * serializable, and don't include raw prompts (those pass through the
 * bundle-redaction path if dumped).
 */

export type VerboseEvent =
  | { readonly kind: 'agent.turn.begin'; readonly iteration: number }
  | {
      readonly kind: 'agent.tool.call';
      readonly iteration: number;
      readonly toolName: string;
      readonly argsPreview: string;
    }
  | {
      readonly kind: 'agent.tool.result';
      readonly iteration: number;
      readonly toolName: string;
      readonly ok: boolean;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'agent.llm.call';
      readonly iteration: number;
      readonly provider: string;
      readonly model: string;
      readonly inputTokens: number;
    }
  | {
      readonly kind: 'agent.llm.response';
      readonly iteration: number;
      readonly outputTokens: number;
      readonly costUsd: number;
      readonly cacheHit: boolean;
    }
  | { readonly kind: 'agent.stop'; readonly reason: string };

export type VerboseListener = (event: VerboseEvent) => void;

export class VerboseEmitter {
  private readonly listeners = new Set<VerboseListener>();
  private readonly buffer: VerboseEvent[] = [];
  private readonly maxBuffer: number;

  constructor(opts: { maxBuffer?: number } = {}) {
    this.maxBuffer = opts.maxBuffer ?? 500;
  }

  emit(event: VerboseEvent): void {
    this.buffer.push(event);
    while (this.buffer.length > this.maxBuffer) this.buffer.shift();
    for (const l of this.listeners) l(event);
  }

  on(listener: VerboseListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  history(): readonly VerboseEvent[] {
    return [...this.buffer];
  }

  clear(): void {
    this.buffer.length = 0;
  }
}

/** Format a single event as a single-line stderr-friendly string. */
export function formatVerbose(event: VerboseEvent): string {
  switch (event.kind) {
    case 'agent.turn.begin':
      return `→ turn ${event.iteration}`;
    case 'agent.tool.call':
      return `  → tool ${event.toolName} ${event.argsPreview}`;
    case 'agent.tool.result':
      return `  ← tool ${event.toolName} ${event.ok ? '✓' : '✗'} (${event.durationMs}ms)`;
    case 'agent.llm.call':
      return `  → llm ${event.provider}/${event.model} ${event.inputTokens}t`;
    case 'agent.llm.response':
      return `  ← llm ${event.outputTokens}t $${event.costUsd.toFixed(4)}${event.cacheHit ? ' cache-hit' : ''}`;
    case 'agent.stop':
      return `× stop: ${event.reason}`;
    default: {
      const exhaustive: never = event;
      return JSON.stringify(exhaustive);
    }
  }
}
