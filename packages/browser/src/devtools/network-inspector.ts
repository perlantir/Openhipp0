/**
 * Network inspector + HAR export + API catalog.
 *
 * The caller (usually a Playwright CDPSession listener) feeds events in
 * via `onRequest` / `onResponse`. Internally the inspector pairs
 * request/response by id and maintains an API catalog keyed by
 * `${method} ${host}${path}` (query string stripped).
 */

import type { ApiEndpoint, InspectedRequest, NetworkRequest, NetworkResponse } from './types.js';

export class NetworkInspector {
  readonly #inflight = new Map<string, InspectedRequest>();
  readonly #completed: InspectedRequest[] = [];
  readonly #endpoints = new Map<string, ApiEndpoint>();

  onRequest(req: NetworkRequest): void {
    this.#inflight.set(req.id, req);
  }

  onResponse(resp: NetworkResponse): void {
    const req = this.#inflight.get(resp.id);
    if (!req) return;
    this.#inflight.delete(resp.id);
    const durationMs = Date.parse(resp.endedAt) - Date.parse(req.startedAt);
    const merged: InspectedRequest = { ...req, ...resp, durationMs: Number.isFinite(durationMs) ? durationMs : undefined };
    this.#completed.push(merged);
    this.#trackEndpoint(merged);
  }

  #trackEndpoint(req: InspectedRequest): void {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return;
    }
    const key = `${req.method.toUpperCase()} ${url.host}${url.pathname}`;
    const prev = this.#endpoints.get(key);
    const contentType = req.responseMimeType ?? req.responseHeaders?.['content-type'] ?? '';
    const contentTypes = new Set(prev?.contentTypes ?? []);
    if (contentType) contentTypes.add(contentType);
    const endpoint: ApiEndpoint = {
      method: req.method.toUpperCase(),
      host: url.host,
      path: url.pathname,
      occurrences: (prev?.occurrences ?? 0) + 1,
      lastStatus: req.status ?? prev?.lastStatus ?? 0,
      ...(prev?.sampleRequestBody
        ? { sampleRequestBody: prev.sampleRequestBody }
        : req.requestBody
          ? { sampleRequestBody: req.requestBody }
          : {}),
      ...(prev?.sampleResponseBody
        ? { sampleResponseBody: prev.sampleResponseBody }
        : req.responseBodyText
          ? { sampleResponseBody: req.responseBodyText }
          : {}),
      contentTypes: [...contentTypes],
    };
    this.#endpoints.set(key, endpoint);
  }

  get size(): number {
    return this.#completed.length;
  }

  completed(): readonly InspectedRequest[] {
    return [...this.#completed];
  }

  endpoints(): readonly ApiEndpoint[] {
    return [...this.#endpoints.values()].sort((a, b) => b.occurrences - a.occurrences);
  }

  /** Export a minimal HAR 1.2 document. Callers can post-process/save. */
  exportHar(pageUrl = ''): { log: unknown } {
    return {
      log: {
        version: '1.2',
        creator: { name: '@openhipp0/browser', version: '0.0.0' },
        pages: [
          {
            startedDateTime: this.#completed[0]?.startedAt ?? new Date().toISOString(),
            id: 'page_0',
            title: pageUrl,
            pageTimings: { onContentLoad: -1, onLoad: -1 },
          },
        ],
        entries: this.#completed.map((e) => ({
          startedDateTime: e.startedAt,
          time: e.durationMs ?? 0,
          request: {
            method: e.method,
            url: e.url,
            httpVersion: 'HTTP/1.1',
            headers: toHarHeaders(e.requestHeaders ?? {}),
            queryString: toHarQueryString(e.url),
            postData: e.requestBody
              ? { mimeType: e.requestBodyMimeType ?? 'application/octet-stream', text: e.requestBody }
              : undefined,
            cookies: [],
            headersSize: -1,
            bodySize: e.requestBody ? e.requestBody.length : 0,
          },
          response: {
            status: e.status ?? 0,
            statusText: '',
            httpVersion: 'HTTP/1.1',
            headers: toHarHeaders(e.responseHeaders ?? {}),
            content: {
              size: e.responseBodyBytes ?? 0,
              mimeType: e.responseMimeType ?? '',
              text: e.responseBodyText,
            },
            cookies: [],
            redirectURL: '',
            headersSize: -1,
            bodySize: e.responseBodyBytes ?? -1,
          },
          cache: {},
          timings: { send: 0, wait: e.durationMs ?? 0, receive: 0 },
          pageref: 'page_0',
        })),
      },
    };
  }

  /** Convenience helper: find likely "real" API endpoints (JSON, non-static). */
  apiCandidates(): readonly ApiEndpoint[] {
    return this.endpoints().filter((e) =>
      e.contentTypes.some((ct) => ct.includes('json')) &&
      !/\.(?:js|css|png|jpg|jpeg|svg|gif|ico|woff2?|ttf)$/.test(e.path),
    );
  }
}

function toHarHeaders(h: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(h).map(([name, value]) => ({ name, value }));
}

function toHarQueryString(url: string): Array<{ name: string; value: string }> {
  try {
    const u = new URL(url);
    return [...u.searchParams].map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

/**
 * Snapshot localStorage + sessionStorage via `page.evaluate`. Structural
 * so tests don't need a real page.
 */
export interface StorageInspector {
  snapshot(): Promise<import('./types.js').StorageSnapshot>;
}

export function createPageStorageInspector(
  page: { evaluate<T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T> },
): StorageInspector {
  return {
    async snapshot() {
      const result = await page.evaluate(() => {
        function dump(storage: Storage): Record<string, string> {
          const out: Record<string, string> = {};
          for (let i = 0; i < storage.length; i++) {
            const k = storage.key(i);
            if (k !== null) out[k] = storage.getItem(k) ?? '';
          }
          return out;
        }
        return {
          localStorage: dump(localStorage),
          sessionStorage: dump(sessionStorage),
        };
      });
      return result as import('./types.js').StorageSnapshot;
    },
  };
}
