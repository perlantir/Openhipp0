/**
 * OutboundQueue — buffers send() calls while the bridge is offline and
 * flushes them in order when reconnected.
 *
 * Capacity-bounded: on overflow, the oldest entry is dropped (caller is
 * notified via onDrop). Entries older than `maxAgeMs` are dropped as well —
 * sending a 2-hour-old "deploy starting…" after reconnect is worse than
 * never sending it.
 */

export interface QueuedOutbound<T> {
  channelId: string;
  payload: T;
  enqueuedAt: number;
}

export interface OutboundQueueConfig<T> {
  capacity?: number; // default 500
  maxAgeMs?: number; // default 60 minutes
  onDrop?: (entry: QueuedOutbound<T>, reason: 'capacity' | 'age') => void;
  now?: () => number;
}

export class OutboundQueue<T> {
  private readonly buf: QueuedOutbound<T>[] = [];
  private readonly capacity: number;
  private readonly maxAgeMs: number;
  private readonly now: () => number;
  private readonly onDrop: OutboundQueueConfig<T>['onDrop'];

  constructor(cfg: OutboundQueueConfig<T> = {}) {
    this.capacity = cfg.capacity ?? 500;
    this.maxAgeMs = cfg.maxAgeMs ?? 60 * 60 * 1000;
    this.now = cfg.now ?? Date.now;
    this.onDrop = cfg.onDrop;
  }

  size(): number {
    return this.buf.length;
  }

  enqueue(channelId: string, payload: T): void {
    // Evict expired entries first.
    this.evictExpired();

    if (this.buf.length >= this.capacity) {
      const dropped = this.buf.shift();
      if (dropped) this.onDrop?.(dropped, 'capacity');
    }
    this.buf.push({ channelId, payload, enqueuedAt: this.now() });
  }

  /**
   * Invokes `deliver` sequentially on each queued entry. If `deliver` throws,
   * the entry is re-queued at the head and iteration stops — caller can retry.
   */
  async flush(deliver: (entry: QueuedOutbound<T>) => Promise<void>): Promise<number> {
    this.evictExpired();
    let delivered = 0;
    while (this.buf.length > 0) {
      const entry = this.buf[0]!;
      try {
        await deliver(entry);
        this.buf.shift();
        delivered++;
      } catch {
        // Leave entry at head; caller retries.
        break;
      }
    }
    return delivered;
  }

  clear(): void {
    this.buf.length = 0;
  }

  /** Snapshot for inspection / tests. */
  peek(): readonly QueuedOutbound<T>[] {
    return [...this.buf];
  }

  private evictExpired(): void {
    if (this.buf.length === 0) return;
    const cutoff = this.now() - this.maxAgeMs;
    while (this.buf.length > 0 && this.buf[0]!.enqueuedAt < cutoff) {
      const dropped = this.buf.shift()!;
      this.onDrop?.(dropped, 'age');
    }
  }
}
