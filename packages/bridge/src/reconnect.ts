/**
 * Reconnect supervisor — wraps a connect() function and re-invokes it with
 * exponential backoff on failure. Used by every bridge that opens a long-
 * lived connection (WebSocket, gRPC, Discord gateway, etc.).
 *
 * Lifecycle:
 *   idle → connecting → connected → (disconnect) → idle
 *                                 → (remote close) → reconnecting → connecting
 *
 * `stop()` halts the supervisor permanently — no more reconnect attempts
 * regardless of state. Must be called when the bridge is torn down.
 */

export interface ReconnectConfig {
  baseDelayMs?: number; // default 500
  maxDelayMs?: number; // default 30_000
  maxAttempts?: number; // default Infinity
  jitter?: boolean; // default true
  onAttempt?: (attempt: number) => void;
  onFailure?: (err: unknown, attempt: number) => void;
  onGiveUp?: (lastErr: unknown, attempts: number) => void;
}

export type ReconnectState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'stopped';

export class ReconnectSupervisor {
  private state: ReconnectState = 'idle';
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly connect: () => Promise<void>,
    private readonly cfg: ReconnectConfig = {},
  ) {}

  getState(): ReconnectState {
    return this.state;
  }

  /**
   * Start the supervisor. Runs `connect()` once; on failure, schedules
   * retries using exponential backoff.
   */
  async start(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') return;
    if (this.state === 'stopped') throw new Error('ReconnectSupervisor: start() after stop()');
    this.state = 'connecting';
    this.attempt = 1;
    this.cfg.onAttempt?.(this.attempt);
    try {
      await this.connect();
      this.state = 'connected';
      this.attempt = 0;
    } catch (err) {
      this.cfg.onFailure?.(err, this.attempt);
      this.scheduleReconnect(err);
    }
  }

  /** Signal that the connection dropped. Schedules a reconnect attempt. */
  reportDisconnect(cause?: unknown): void {
    if (this.state === 'stopped' || this.state === 'idle') return;
    this.scheduleReconnect(cause);
  }

  /** Stop all retrying. Idempotent. */
  stop(): void {
    this.state = 'stopped';
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Reset to idle. Useful between test cases. */
  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.state = 'idle';
    this.attempt = 0;
  }

  // ───────────────────────────────────────────────────────────────────────

  private scheduleReconnect(lastErr: unknown): void {
    if (this.state === 'stopped') return;
    const maxAttempts = this.cfg.maxAttempts ?? Infinity;
    if (this.attempt >= maxAttempts) {
      this.cfg.onGiveUp?.(lastErr, this.attempt);
      this.state = 'stopped';
      return;
    }
    const delay = this.computeDelay();
    this.state = 'reconnecting';
    this.timer = setTimeout(() => {
      if (this.state === 'stopped') return;
      this.attempt++;
      this.cfg.onAttempt?.(this.attempt);
      this.state = 'connecting';
      this.connect()
        .then(() => {
          if (this.state === 'stopped') return;
          this.state = 'connected';
          this.attempt = 0;
        })
        .catch((err: unknown) => {
          if (this.state === 'stopped') return;
          this.cfg.onFailure?.(err, this.attempt);
          this.scheduleReconnect(err);
        });
    }, delay);
  }

  private computeDelay(): number {
    const base = this.cfg.baseDelayMs ?? 500;
    const max = this.cfg.maxDelayMs ?? 30_000;
    const jitter = this.cfg.jitter ?? true;
    const raw = Math.min(max, base * 2 ** Math.max(0, this.attempt - 1));
    if (!jitter) return raw;
    const spread = raw * 0.25;
    return Math.max(0, raw + (Math.random() * 2 - 1) * spread);
  }
}
