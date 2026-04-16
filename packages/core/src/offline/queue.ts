/**
 * Outbound action queue — pure TS state machine, no runtime deps.
 *
 * Ported + generalized from packages/mobile/src/sync/queue.ts so desktop
 * CLI + self-hosted server can share one implementation. Mobile's copy
 * stays in place until it migrates opportunistically (same rule as
 * retro-d's phase17.ts deferral).
 */

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
  /** Serial by default; concurrency > 1 if handler is safe to parallelize. */
  concurrency?: number;
  /** Hard cap before dropping the oldest queued action on overflow. Default 500. */
  maxSize?: number;
  /** Override for tests. Default: Math.random() + Date.now() id. */
  idFactory?: () => string;
  /** Monotonic clock override; default Date.now. */
  now?: () => number;
}

export type ActionHandler<T = unknown> = (action: QueuedAction<T>) => Promise<void>;

function defaultIdFactory(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Ordered outbound queue. Drop-oldest on overflow (matches Phase 3a's
 * bridge OutboundQueue rule — recency > retention when buffer is full).
 */
export class OutboundActionQueue {
  private actions: QueuedAction[] = [];
  private seqCounter = 0;
  private inFlight = 0;
  private readonly concurrency: number;
  private readonly maxSize: number;
  private readonly idFactory: () => string;
  private readonly now: () => number;
  private readonly persistence: QueuePersistence | undefined;

  constructor(options: QueueOptions = {}, persistence?: QueuePersistence) {
    this.concurrency = options.concurrency ?? 1;
    this.maxSize = options.maxSize ?? 500;
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.now = options.now ?? Date.now;
    this.persistence = persistence;
  }

  async restore(): Promise<void> {
    if (!this.persistence) return;
    const loaded = await this.persistence.load();
    this.actions = [...loaded].sort((a, b) => a.seq - b.seq);
    this.seqCounter = Math.max(0, ...this.actions.map((a) => a.seq));
  }

  enqueue<T>(kind: string, payload: T): QueuedAction<T> {
    this.seqCounter += 1;
    const action: QueuedAction<T> = {
      id: this.idFactory(),
      kind,
      payload,
      createdAt: this.now(),
      attempts: 0,
      seq: this.seqCounter,
    };
    this.actions.push(action);
    while (this.actions.length > this.maxSize) {
      this.actions.shift();
    }
    void this.save();
    return action;
  }

  peek(): readonly QueuedAction[] {
    return [...this.actions];
  }

  size(): number {
    return this.actions.length;
  }

  /**
   * Drain the queue. Each action is handed to `handler`; on success it's
   * removed, on failure `attempts` increments + `lastError` is set and
   * the action stays in place. `maxAttempts` drops actions that keep
   * failing (caller typically logs these).
   */
  async drain(
    handler: ActionHandler,
    opts: { maxAttempts?: number } = {},
  ): Promise<{ processed: number; dropped: number }> {
    const maxAttempts = opts.maxAttempts ?? 5;
    let processed = 0;
    let dropped = 0;
    const snapshot = [...this.actions];
    for (const action of snapshot) {
      if (this.inFlight >= this.concurrency) break;
      this.inFlight += 1;
      try {
        await handler(action);
        this.actions = this.actions.filter((a) => a.id !== action.id);
        processed += 1;
      } catch (err) {
        action.attempts += 1;
        action.lastError = err instanceof Error ? err.message : String(err);
        if (action.attempts >= maxAttempts) {
          this.actions = this.actions.filter((a) => a.id !== action.id);
          dropped += 1;
        }
      } finally {
        this.inFlight -= 1;
      }
    }
    await this.save();
    return { processed, dropped };
  }

  clear(): void {
    this.actions = [];
    void this.save();
  }

  private async save(): Promise<void> {
    if (!this.persistence) return;
    try {
      await this.persistence.save(this.actions);
    } catch {
      /* persistence failures are non-fatal — the queue is in-memory authoritative */
    }
  }
}
