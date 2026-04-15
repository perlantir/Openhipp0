/**
 * Retry wrapper with exponential backoff + jitter.
 *
 * An error is retryable when `isRetryable(err) === true`. By default, retries
 * `Hipp0LLMError` with `retryable: true`, plus common transient signals
 * (AbortError, ECONNRESET, fetch network errors, 5xx-ish).
 *
 * Delay: `baseDelayMs * 2^(attempt-1)`, capped at `maxDelayMs`, optional ±25%
 * jitter. Never sleeps after the last attempt.
 */

import { Hipp0LLMError, Hipp0RetryExhaustedError, type RetryConfig } from './types.js';

export interface RetryOptions extends RetryConfig {
  /** Classifier for which errors are retryable. Default: `defaultIsRetryable`. */
  isRetryable?: (err: unknown) => boolean;
  /** Sleep function. Default: setTimeout-based. Override in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Hook observed on every retry (e.g. for metrics). */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  /** Abort signal that aborts the entire retry loop. */
  signal?: AbortSignal;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Default retryability heuristic. Returns true if:
 *   - `err` is Hipp0LLMError with `.retryable === true`
 *   - `err.name` is 'AbortError' (timeout) — but NOT if the caller's signal aborted
 *   - `err` looks like a network error (code: ECONNRESET / ENOTFOUND / ETIMEDOUT / UND_ERR_*)
 *   - `err` has a `status`/`statusCode` in [408, 429, 500, 502, 503, 504]
 */
export function defaultIsRetryable(err: unknown): boolean {
  if (err instanceof Hipp0LLMError) return err.retryable;

  if (err && typeof err === 'object') {
    const e = err as { code?: string; status?: number; statusCode?: number; name?: string };
    if (e.code && /^(ECONN|ENOT|ETIMED|UND_ERR)/.test(e.code)) return true;
    const status = e.status ?? e.statusCode;
    if (
      status === 408 ||
      status === 429 ||
      (typeof status === 'number' && status >= 500 && status < 600)
    ) {
      return true;
    }
    // AbortError from fetch timeouts (distinct from user-cancelled AbortSignals)
    if (e.name === 'AbortError') return true;
  }
  return false;
}

/** Compute backoff delay for the given attempt (1-based). */
export function computeDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number | undefined,
  jitter: boolean | undefined,
  rng: () => number = Math.random,
): number {
  const raw = baseDelayMs * 2 ** (attempt - 1);
  const capped = maxDelayMs !== undefined ? Math.min(raw, maxDelayMs) : raw;
  if (jitter === false) return capped;
  // ±25% jitter
  const spread = capped * 0.25;
  return Math.max(0, capped + (rng() * 2 - 1) * spread);
}

/**
 * Run `fn` up to `opts.maxAttempts` times. Sleeps between attempts with
 * exponential backoff + optional jitter. Throws Hipp0RetryExhaustedError
 * wrapping the last error when attempts are exhausted.
 *
 * Non-retryable errors are rethrown immediately without wrapping.
 */
export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    jitter = true,
    isRetryable = defaultIsRetryable,
    sleep = defaultSleep,
    onRetry,
    signal,
  } = opts;

  if (maxAttempts < 1) throw new RangeError('maxAttempts must be >= 1');
  if (baseDelayMs <= 0) throw new RangeError('baseDelayMs must be > 0');

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw signal.reason ?? new Error('Aborted');
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxAttempts) {
        if (attempt === maxAttempts && isRetryable(err)) {
          throw new Hipp0RetryExhaustedError(
            `Retry exhausted after ${attempt} attempts`,
            attempt,
            err,
          );
        }
        throw err;
      }
      const delay = computeDelayMs(attempt, baseDelayMs, maxDelayMs, jitter);
      onRetry?.(err, attempt, delay);
      await sleep(delay);
    }
  }
  // Unreachable — the for loop either returns or throws.
  throw new Hipp0RetryExhaustedError('Retry exhausted (unreachable)', maxAttempts, lastErr);
}
