/**
 * Brave Search integration — web search via the Brave Search API
 * (https://api.search.brave.com/). Auth: API key via the
 * `X-Subscription-Token` header.
 *
 * Free tier: 2000 requests/month ≈ 2/minute. We rate-limit to 1/sec to
 * keep headroom and respect Brave's stated soft limit.
 */

import { z } from 'zod';
import type { Tool } from '../../tools/types.js';
import { RateLimiter, fetchWithRetry } from '../http.js';

const limiter = new RateLimiter(1, 3); // 1 req/sec, burst 3

export interface BraveConfig {
  /** API key. Read from HIPP0_BRAVE_API_KEY if not supplied. */
  apiKey?: string;
}

export function createBraveSearchTool(cfg: BraveConfig = {}): Tool<{ q: string; count?: number }> {
  const params = z.object({
    q: z.string().min(1).max(400),
    count: z.number().int().min(1).max(20).optional(),
  });

  return {
    name: 'brave_search',
    description: 'Search the web via the Brave Search API. Returns a ranked JSON list of web results.',
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      required: ['q'],
      properties: {
        q: { type: 'string', description: 'Search query' },
        count: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
      },
    },
    validator: params,
    async execute(input) {
      const apiKey = cfg.apiKey ?? process.env['HIPP0_BRAVE_API_KEY'];
      if (!apiKey) {
        return {
          ok: false,
          output: 'HIPP0_BRAVE_API_KEY is not set. Sign up at https://brave.com/search/api/ to get a key.',
          errorCode: 'HIPP0_BRAVE_NO_KEY',
        };
      }
      await limiter.take();
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', input.q);
      if (input.count) url.searchParams.set('count', String(input.count));

      const resp = await fetchWithRetry(() =>
        fetch(url.toString(), {
          headers: {
            accept: 'application/json',
            'X-Subscription-Token': apiKey,
          },
        }),
      );
      if (!resp.ok) {
        return {
          ok: false,
          output: `Brave API returned ${resp.status}: ${(await resp.text()).slice(0, 200)}`,
          errorCode: 'HIPP0_BRAVE_HTTP',
        };
      }
      const data = (await resp.json()) as { web?: { results?: unknown[] } };
      const results = data.web?.results ?? [];
      return { ok: true, output: JSON.stringify(results, null, 2) };
    },
  };
}

export const braveSearchTool = createBraveSearchTool();
