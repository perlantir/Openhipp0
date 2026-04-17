/**
 * MarketplaceClient — pure fetch-driven client for a remote skills index.
 *
 * Index contract:
 *   GET  <indexUrl>/listings           → { listings: MarketplaceListing[] }
 *   GET  <indexUrl>/listings/<name>    → MarketplaceListing
 *   GET  <bundleUrl>                   → SkillBundle (JSON)
 *
 * Fetch is injected so tests can exercise every code path without the
 * network. Zod validates every response so a malicious index can't leak
 * unvalidated fields into an InstalledSkillRecord.
 */

import {
  Hipp0MarketplaceError,
  MarketplaceListingSchema,
  SkillBundleSchema,
  type MarketplaceListing,
  type SkillBundle,
} from './types.js';

export type MarketplaceFetch = (input: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface MarketplaceClientOptions {
  /** Base URL for the index (default: `https://agentskills.io/api/v1`). */
  readonly indexUrl?: string;
  /** Override for tests. Default: `globalThis.fetch`. */
  readonly fetchImpl?: MarketplaceFetch;
  /** Abort pending requests after this many ms. Default: 10_000. */
  readonly timeoutMs?: number;
}

export interface BrowseOptions {
  readonly tag?: string;
  readonly search?: string;
  readonly limit?: number;
}

export class MarketplaceClient {
  private readonly indexUrl: string;
  private readonly fetchImpl: MarketplaceFetch;
  private readonly timeoutMs: number;

  constructor(opts: MarketplaceClientOptions = {}) {
    this.indexUrl = (opts.indexUrl ?? 'https://agentskills.io/api/v1').replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as MarketplaceFetch);
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  async browse(query: BrowseOptions = {}): Promise<readonly MarketplaceListing[]> {
    const params = new URLSearchParams();
    if (query.tag) params.set('tag', query.tag);
    if (query.search) params.set('q', query.search);
    if (query.limit) params.set('limit', String(query.limit));
    const url = `${this.indexUrl}/listings${params.size > 0 ? `?${params.toString()}` : ''}`;
    const body = await this.fetchJson(url);
    const parsed = z.object({ listings: z.array(MarketplaceListingSchema) }).safeParse(body);
    if (!parsed.success) {
      throw new Hipp0MarketplaceError(
        `Invalid listings response: ${parsed.error.message}`,
        'HIPP0_MARKETPLACE_INVALID_LISTINGS',
      );
    }
    return parsed.data.listings;
  }

  async getListing(name: string): Promise<MarketplaceListing> {
    const body = await this.fetchJson(`${this.indexUrl}/listings/${encodeURIComponent(name)}`);
    const parsed = MarketplaceListingSchema.safeParse(body);
    if (!parsed.success) {
      throw new Hipp0MarketplaceError(
        `Invalid listing response: ${parsed.error.message}`,
        'HIPP0_MARKETPLACE_INVALID_LISTING',
      );
    }
    return parsed.data;
  }

  async fetchBundle(bundleUrl: string): Promise<SkillBundle> {
    const body = await this.fetchJson(bundleUrl);
    const parsed = SkillBundleSchema.safeParse(body);
    if (!parsed.success) {
      throw new Hipp0MarketplaceError(
        `Invalid bundle: ${parsed.error.message}`,
        'HIPP0_MARKETPLACE_INVALID_BUNDLE',
      );
    }
    return parsed.data;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await this.fetchImpl(url, { signal: controller.signal });
      if (!resp.ok) {
        throw new Hipp0MarketplaceError(
          `HTTP ${resp.status} for ${url}`,
          'HIPP0_MARKETPLACE_HTTP',
        );
      }
      return await resp.json();
    } catch (err) {
      if (err instanceof Hipp0MarketplaceError) throw err;
      throw new Hipp0MarketplaceError(
        `Fetch failed: ${(err as Error).message}`,
        'HIPP0_MARKETPLACE_FETCH',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

// Lazy-import zod to avoid circular typings in the types.ts re-export path.
import { z } from 'zod';
