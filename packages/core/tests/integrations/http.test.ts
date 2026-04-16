import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter, authedFetch, fetchWithRetry } from '../../src/integrations/http.js';

const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('authedFetch', () => {
  it('adds Bearer auth when none is present', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('ok', { status: 200 }),
    );
    await authedFetch('https://x.test/', {}, { token: 'abc' });
    const headers = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
      ?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer abc');
  });

  it('does not overwrite an existing Authorization header', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('ok'),
    );
    await authedFetch(
      'https://x.test/',
      { headers: { authorization: 'Basic preset' } },
      { token: 'abc' },
    );
    const headers = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
      ?.headers as Headers;
    expect(headers.get('authorization')).toBe('Basic preset');
  });
});

describe('fetchWithRetry', () => {
  it('retries on 5xx and eventually returns the last response', async () => {
    let n = 0;
    const resp = await fetchWithRetry(
      async () => {
        n++;
        if (n < 3) return new Response('x', { status: 503 });
        return new Response('ok', { status: 200 });
      },
      { baseDelayMs: 1, maxAttempts: 5 },
    );
    expect(resp.status).toBe(200);
    expect(n).toBe(3);
  });

  it('returns a 4xx non-429 without retrying', async () => {
    let n = 0;
    const resp = await fetchWithRetry(
      async () => {
        n++;
        return new Response('nope', { status: 400 });
      },
      { baseDelayMs: 1, maxAttempts: 5 },
    );
    expect(resp.status).toBe(400);
    expect(n).toBe(1);
  });
});

describe('RateLimiter', () => {
  it('lets the burst through immediately', async () => {
    const rl = new RateLimiter(10, 3);
    const start = Date.now();
    await rl.take();
    await rl.take();
    await rl.take();
    expect(Date.now() - start).toBeLessThan(50);
  });
});
