// packages/mobile/src/sync/queue.ts
// Outbound action queue. Pure TypeScript state machine — no RN deps, so
// it's unit-testable under vitest. Host wires it to AsyncStorage /
// expo-sqlite for durability at boot time via the persist() callback.

export interface QueuedAction<T = unknown> {
  id: string;
  kind: string;
  payload: T;
  createdAt: number;
  attempts: number;
  lastError?: string;
  /** Monotonic, assigned on enqueue so replay honors insertion order. */
  seq: number;
}

export interface QueuePersistence {
  load(): Promise<readonly QueuedAction[]>;
  save(actions: readonly QueuedAction[]): Promise<void>;
}

export interface QueueOptions {
  /** Cap on simultaneous attempts. Default 1 (serial). */
  concurrency?: number;
  /** Hard cap before the oldest action is dropped. Default 500. */
  maxSize?: number;
}

export type ActionHandler = (action: QueuedAction) => Promise<void>;

function randomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Ordered outbound queue. Drop-oldest on overflow (same rule Phase 3a's
 * bridge OutboundQueue uses — recency beats retention when the buffer is
 * full).
 */
export class OutboundActionQueue {
  private actions: QueuedAction[] = [];
  private seqCounter = 0;
  private inFlight = 0;
  private readonly concurrency: number;
  private readonly maxSize: number;
  private readonly persistence: QueuePersistence | undefined;

  constructor(options: QueueOptions = {}, persistence?: QueuePersistence) {
    this.concurrency = options.concurrency ?? 1;
    this.maxSize = options.maxSize ?? 500;
    this.persistence = persistence;
  }

  async restore(): Promise<void> {
    if (!this.persistence) return;
    const loaded = await this.persistence.load();
    this.actions = [...loaded].sort((a, b) => a.seq - b.seq);
    this.seqCounter = Math.max(0, ...this.actions.map((a) => a.seq));
  }

  private async persist(): Promise<void> {
    if (!this.persistence) return;
    await this.persistence.save(this.actions);
  }

  async enqueue<T>(kind: string, payload: T): Promise<QueuedAction<T>> {
    const action: QueuedAction<T> = {
      id: randomId(),
      kind,
      payload,
      createdAt: Date.now(),
      attempts: 0,
      seq: ++this.seqCounter,
    };
    this.actions.push(action);
    while (this.actions.length > this.maxSize) this.actions.shift();
    await this.persist();
    return action;
  }

  get size(): number {
    return this.actions.length;
  }

  peek(): readonly QueuedAction[] {
    return this.actions;
  }

  /** Run pending actions through the handler; stops on first failure. */
  async drain(handler: ActionHandler): Promise<{ processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;
    while (this.actions.length > 0 && this.inFlight < this.concurrency) {
      const action = this.actions[0];
      if (!action) break;
      this.inFlight++;
      try {
        await handler(action);
        this.actions.shift();
        processed++;
        await this.persist();
      } catch (err) {
        action.attempts += 1;
        action.lastError = err instanceof Error ? err.message : String(err);
        failed++;
        await this.persist();
        this.inFlight--;
        // Stop draining on first failure — caller retries later
        return { processed, failed };
      }
      this.inFlight--;
    }
    return { processed, failed };
  }

  async clear(): Promise<void> {
    this.actions = [];
    this.seqCounter = 0;
    await this.persist();
  }
}
