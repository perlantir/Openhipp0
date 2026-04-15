/**
 * Built-in web tool: web_fetch.
 *
 * Only HTTPS by default. Host must match the context's allowedDomains list
 * (exact or `*.suffix` wildcard). Response body is capped at maxBytes.
 * Rate limiting is a minimal in-process token bucket per host.
 */

import { z } from 'zod';
import { Hipp0DomainDeniedError } from '../types.js';
import { isHostAllowed } from '../path-guard.js';
import type { Tool } from '../types.js';

const webFetchParams = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'HEAD', 'POST']).default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  maxBytes: z.number().int().positive().max(10_000_000).default(2_000_000),
  allowHttp: z.boolean().default(false),
});

export interface WebFetchToolOptions {
  /** Minimum ms between requests to the same host. Default: 250. */
  minIntervalMsPerHost?: number;
  /** Override fetch (tests). */
  fetchFn?: typeof fetch;
}

export function createWebFetchTool(
  opts: WebFetchToolOptions = {},
): Tool<z.infer<typeof webFetchParams>> {
  const minInterval = opts.minIntervalMsPerHost ?? 250;
  const fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  const lastHit = new Map<string, number>();

  return {
    name: 'web_fetch',
    description:
      'Fetch a URL (HTTPS by default). The host must be in allowedDomains. Response body is truncated at maxBytes.',
    permissions: ['net.fetch'],
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', format: 'uri' },
        method: { type: 'string', enum: ['GET', 'HEAD', 'POST'], default: 'GET' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        body: { type: 'string' },
        maxBytes: { type: 'integer', minimum: 1, maximum: 10_000_000, default: 2_000_000 },
        allowHttp: { type: 'boolean', default: false },
      },
    },
    validator: webFetchParams,
    async execute(params, ctx) {
      let parsed: URL;
      try {
        parsed = new URL(params.url);
      } catch {
        return { ok: false, output: 'Invalid URL', errorCode: 'HIPP0_INVALID_URL' };
      }
      if (parsed.protocol !== 'https:' && !(params.allowHttp && parsed.protocol === 'http:')) {
        return {
          ok: false,
          output: `Scheme not permitted: ${parsed.protocol}`,
          errorCode: 'HIPP0_SCHEME_DENIED',
        };
      }
      if (!isHostAllowed(parsed.hostname, ctx.allowedDomains)) {
        throw new Hipp0DomainDeniedError('web_fetch', parsed.hostname);
      }

      // Per-host rate limit
      const host = parsed.hostname.toLowerCase();
      const now = Date.now();
      const last = lastHit.get(host) ?? 0;
      const wait = last + minInterval - now;
      if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
      }
      lastHit.set(host, Date.now());

      let resp: Response;
      try {
        resp = await fetchFn(parsed.toString(), {
          method: params.method,
          ...(params.headers && { headers: params.headers }),
          ...(params.body && params.method === 'POST' && { body: params.body }),
          ...(ctx.signal && { signal: ctx.signal }),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, output: msg, errorCode: 'HIPP0_FETCH_NETWORK' };
      }

      // Enforce maxBytes by streaming
      const reader = resp.body?.getReader();
      let body = '';
      let bytes = 0;
      let truncated = false;
      const decoder = new TextDecoder('utf-8');
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            bytes += value.byteLength;
            if (bytes > params.maxBytes) {
              truncated = true;
              break;
            }
            body += decoder.decode(value, { stream: true });
          }
        }
        body += decoder.decode();
      }

      const headersObj: Record<string, string> = {};
      resp.headers.forEach((v, k) => {
        headersObj[k] = v;
      });

      return {
        ok: resp.ok,
        output: body,
        ...(resp.ok ? {} : { errorCode: `HIPP0_FETCH_${resp.status}` }),
        metadata: {
          status: resp.status,
          host,
          bytes,
          truncated,
          headers: headersObj,
        },
      };
    },
  };
}

/** Pre-built tool using the global fetch. Convenient default for most callers. */
export const webFetchTool = createWebFetchTool();
