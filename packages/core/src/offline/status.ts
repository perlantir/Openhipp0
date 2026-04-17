/**
 * OnlineStatusTracker — minimal observable "are we online?" state with
 * a probe-driven refresh and event emission on transitions.
 *
 * Consumers (dashboard degraded-mode banner, CLI "serving offline"
 * indicator, mobile app indicator) subscribe to the same primitive.
 */

export type OnlineStatus = 'online' | 'degraded' | 'offline';

export type OnlineProbe = () => Promise<{ ok: boolean; latencyMs?: number }>;

export interface OnlineStatusOptions {
  readonly probe: OnlineProbe;
  /** Poll interval in ms. Default 30_000. */
  readonly intervalMs?: number;
  /** Above this latency (ms), status is "degraded" even on success. Default 3000. */
  readonly degradedLatencyMs?: number;
  /** Override Date.now for tests. */
  readonly now?: () => number;
}

export type OnlineStatusListener = (next: OnlineStatus, previous: OnlineStatus) => void;

export class OnlineStatusTracker {
  private current: OnlineStatus = 'online';
  private readonly listeners = new Set<OnlineStatusListener>();
  private readonly probe: OnlineProbe;
  private readonly intervalMs: number;
  private readonly degradedLatencyMs: number;

  constructor(opts: OnlineStatusOptions) {
    this.probe = opts.probe;
    this.intervalMs = opts.intervalMs ?? 30_000;
    this.degradedLatencyMs = opts.degradedLatencyMs ?? 3000;
  }

  status(): OnlineStatus {
    return this.current;
  }

  on(listener: OnlineStatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async tick(): Promise<OnlineStatus> {
    try {
      const result = await this.probe();
      if (!result.ok) {
        this.transition('offline');
      } else if ((result.latencyMs ?? 0) > this.degradedLatencyMs) {
        this.transition('degraded');
      } else {
        this.transition('online');
      }
    } catch {
      this.transition('offline');
    }
    return this.current;
  }

  intervalMsValue(): number {
    return this.intervalMs;
  }

  private transition(next: OnlineStatus): void {
    if (next === this.current) return;
    const prev = this.current;
    this.current = next;
    for (const l of this.listeners) l(next, prev);
  }
}
