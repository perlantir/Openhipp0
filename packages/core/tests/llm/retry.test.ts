import { describe, expect, it, vi } from 'vitest';
import { computeDelayMs, defaultIsRetryable, retry } from '../../src/llm/retry.js';
import { Hipp0LLMError, Hipp0RetryExhaustedError } from '../../src/llm/types.js';

const noSleep = (_ms: number): Promise<void> => Promise.resolve();

describe('defaultIsRetryable', () => {
  it('Hipp0LLMError with retryable=true → true', () => {
    expect(defaultIsRetryable(new Hipp0LLMError('x', 'anthropic', 500, true))).toBe(true);
  });

  it('Hipp0LLMError with retryable=false → false', () => {
    expect(defaultIsRetryable(new Hipp0LLMError('x', 'anthropic', 400, false))).toBe(false);
  });

  it('5xx status → true', () => {
    expect(defaultIsRetryable({ status: 503 })).toBe(true);
    expect(defaultIsRetryable({ statusCode: 500 })).toBe(true);
    expect(defaultIsRetryable({ statusCode: 504 })).toBe(true);
  });

  it('429 → true', () => {
    expect(defaultIsRetryable({ status: 429 })).toBe(true);
  });

  it('408 → true', () => {
    expect(defaultIsRetryable({ status: 408 })).toBe(true);
  });

  it('4xx (non-408/429) → false', () => {
    expect(defaultIsRetryable({ status: 400 })).toBe(false);
    expect(defaultIsRetryable({ status: 401 })).toBe(false);
    expect(defaultIsRetryable({ status: 404 })).toBe(false);
  });

  it('network codes → true', () => {
    expect(defaultIsRetryable({ code: 'ECONNRESET' })).toBe(true);
    expect(defaultIsRetryable({ code: 'ENOTFOUND' })).toBe(true);
    expect(defaultIsRetryable({ code: 'ETIMEDOUT' })).toBe(true);
    expect(defaultIsRetryable({ code: 'UND_ERR_SOCKET' })).toBe(true);
  });

  it('AbortError name → true', () => {
    expect(defaultIsRetryable({ name: 'AbortError' })).toBe(true);
  });

  it('plain Error / string / null → false', () => {
    expect(defaultIsRetryable(new Error('bad'))).toBe(false);
    expect(defaultIsRetryable('string error')).toBe(false);
    expect(defaultIsRetryable(null)).toBe(false);
    expect(defaultIsRetryable(undefined)).toBe(false);
  });
});

describe('computeDelayMs', () => {
  it('exponential growth without jitter', () => {
    const rng = () => 0.5;
    expect(computeDelayMs(1, 100, undefined, false, rng)).toBe(100);
    expect(computeDelayMs(2, 100, undefined, false, rng)).toBe(200);
    expect(computeDelayMs(3, 100, undefined, false, rng)).toBe(400);
    expect(computeDelayMs(4, 100, undefined, false, rng)).toBe(800);
  });

  it('caps at maxDelayMs', () => {
    expect(computeDelayMs(10, 100, 500, false)).toBe(500);
  });

  it('jitter ±25% around computed value', () => {
    const lowRng = () => 0; // rng*2-1 = -1, full negative jitter
    const highRng = () => 1; // rng*2-1 = 1, full positive jitter
    const low = computeDelayMs(3, 100, undefined, true, lowRng);
    const high = computeDelayMs(3, 100, undefined, true, highRng);
    expect(low).toBeCloseTo(300); // 400 - 25%
    expect(high).toBeCloseTo(500); // 400 + 25%
  });

  it('jitter never returns negative', () => {
    expect(computeDelayMs(1, 10, undefined, true, () => 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('retry', () => {
  it('returns immediately on first success', async () => {
    const fn = vi.fn(async () => 42);
    const result = await retry(fn, { maxAttempts: 3, baseDelayMs: 1, sleep: noSleep });
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries retryable errors then succeeds', async () => {
    let attempt = 0;
    const fn = vi.fn(async () => {
      attempt++;
      if (attempt < 3) throw new Hipp0LLMError('transient', 'anthropic', 503, true);
      return 'ok';
    });
    const result = await retry(fn, { maxAttempts: 5, baseDelayMs: 1, sleep: noSleep });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('wraps last error in Hipp0RetryExhaustedError after all attempts', async () => {
    const err = new Hipp0LLMError('always', 'anthropic', 503, true);
    const fn = vi.fn(async () => {
      throw err;
    });
    await expect(retry(fn, { maxAttempts: 3, baseDelayMs: 1, sleep: noSleep })).rejects.toThrow(
      Hipp0RetryExhaustedError,
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('rethrows non-retryable errors immediately without wrapping', async () => {
    const err = new Hipp0LLMError('fatal', 'openai', 400, false);
    const fn = vi.fn(async () => {
      throw err;
    });
    await expect(retry(fn, { maxAttempts: 5, baseDelayMs: 1, sleep: noSleep })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls onRetry hook on each retry (not on final failure)', async () => {
    const onRetry = vi.fn();
    const err = new Hipp0LLMError('always', 'anthropic', 500, true);
    const fn = async () => {
      throw err;
    };
    await expect(
      retry(fn, { maxAttempts: 3, baseDelayMs: 1, sleep: noSleep, onRetry }),
    ).rejects.toThrow(Hipp0RetryExhaustedError);
    expect(onRetry).toHaveBeenCalledTimes(2); // after attempt 1 and 2, not after final
  });

  it('respects signal abort before first attempt', async () => {
    const ctl = new AbortController();
    ctl.abort(new Error('cancelled by user'));
    const fn = vi.fn();
    await expect(
      retry(fn, { maxAttempts: 3, baseDelayMs: 1, sleep: noSleep, signal: ctl.signal }),
    ).rejects.toThrow('cancelled by user');
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects invalid maxAttempts / baseDelayMs', async () => {
    await expect(retry(async () => 1, { maxAttempts: 0, baseDelayMs: 1 })).rejects.toThrow(
      RangeError,
    );
    await expect(retry(async () => 1, { maxAttempts: 1, baseDelayMs: 0 })).rejects.toThrow(
      RangeError,
    );
  });

  it('custom isRetryable overrides default classification', async () => {
    const fn = vi.fn(async () => {
      throw new Error('plain error');
    });
    // Normally plain Error is not retryable; override to make it so.
    await expect(
      retry(fn, {
        maxAttempts: 3,
        baseDelayMs: 1,
        sleep: noSleep,
        isRetryable: () => true,
      }),
    ).rejects.toThrow(Hipp0RetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
