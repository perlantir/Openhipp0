/**
 * Shared HTTP + rate-limiter helper for integration tools.
 *
 * `authedFetch(input, init, { token })` adds an `Authorization: Bearer <token>`
 * header without mutating the caller's init object. `RateLimiter` implements
 * a token-bucket so integrations that hit per-minute ceilings (Brave's free
 * tier: 2000/month → ~2/minute) can be throttled uniformly.
 */

export interface AuthedFetchOptions {
  token: string;
  tokenScheme?: 'Bearer' | 'Basic' | 'Token';
}

export async function authedFetch(
  input: string,
  init: RequestInit = {},
  opts: AuthedFetchOptions,
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('authorization')) {
    const scheme = opts.tokenScheme ?? 'Bearer';
    headers.set('authorization', `${scheme} ${opts.token}`);
  }
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  return fetch(input, { ...init, headers });
}

/**
 * Simple token-bucket rate limiter. Refills at `perSecond` rate up to
 * `burst` tokens. `take()` awaits until a token is available.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number = Date.now();

  constructor(
    private readonly perSecond: number,
    private readonly burst: number = perSecond,
  ) {
    this.tokens = burst;
  }

  async take(cost = 1): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= cost) {
        this.tokens -= cost;
        return;
      }
      const needed = cost - this.tokens;
      const waitMs = Math.ceil((needed / this.perSecond) * 1000);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + elapsedSec * this.perSecond);
    this.lastRefill = now;
  }
}

/** Wrap a fetch call with automatic retry for 429 / 5xx (simple exponential). */
export async function fetchWithRetry(
  doFetch: () => Promise<Response>,
  opts: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 200;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await doFetch();
      if (resp.status === 429 || resp.status >= 500) {
        if (attempt < maxAttempts) {
          await sleep(baseDelayMs * 2 ** (attempt - 1));
          continue;
        }
      }
      return resp;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
        continue;
      }
    }
  }
  throw lastErr ?? new Error('fetchWithRetry: exhausted without a response');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
