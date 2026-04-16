import { describe, expect, it } from 'vitest';
import {
  MarketplaceClient,
  type MarketplaceFetch,
} from '../../../src/skills/marketplace/client.js';
import { computeBundleHash } from '../../../src/skills/marketplace/installer.js';
import { Hipp0MarketplaceError } from '../../../src/skills/marketplace/types.js';

function fakeFetch(responses: Record<string, unknown>): MarketplaceFetch {
  return async (url) => {
    const body = responses[url];
    if (body === undefined) {
      return {
        ok: false,
        status: 404,
        async json() { return {}; },
        async text() { return ''; },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() { return body; },
      async text() { return JSON.stringify(body); },
    };
  };
}

const sampleListing = {
  name: 'github-search',
  description: 'search github',
  version: '1.0.0',
  publisher: 'community',
  tags: ['git', 'search'],
  downloads: 120,
  rating: 4.5,
  ratingCount: 12,
  bundleUrl: 'https://example.com/bundles/github-search.json',
  publishedAt: '2026-04-16T00:00:00Z',
};

describe('MarketplaceClient.browse', () => {
  it('returns listings for a valid response', async () => {
    const client = new MarketplaceClient({
      indexUrl: 'https://ix/api/v1',
      fetchImpl: fakeFetch({
        'https://ix/api/v1/listings': { listings: [sampleListing] },
      }),
    });
    const out = await client.browse();
    expect(out[0]?.name).toBe('github-search');
    expect(out[0]?.rating).toBe(4.5);
  });

  it('passes query parameters', async () => {
    let capturedUrl = '';
    const client = new MarketplaceClient({
      indexUrl: 'https://ix/api/v1',
      fetchImpl: async (url) => {
        capturedUrl = url;
        return {
          ok: true,
          status: 200,
          async json() { return { listings: [] }; },
          async text() { return ''; },
        };
      },
    });
    await client.browse({ tag: 'git', search: 'pr', limit: 5 });
    expect(capturedUrl).toContain('tag=git');
    expect(capturedUrl).toContain('q=pr');
    expect(capturedUrl).toContain('limit=5');
  });

  it('raises Hipp0MarketplaceError on a non-2xx', async () => {
    const client = new MarketplaceClient({
      indexUrl: 'https://ix/api/v1',
      fetchImpl: fakeFetch({}),
    });
    await expect(client.browse()).rejects.toBeInstanceOf(Hipp0MarketplaceError);
  });

  it('raises on malformed response', async () => {
    const client = new MarketplaceClient({
      indexUrl: 'https://ix/api/v1',
      fetchImpl: fakeFetch({
        'https://ix/api/v1/listings': { not: 'right' },
      }),
    });
    await expect(client.browse()).rejects.toThrow(/INVALID_LISTINGS|Invalid listings/);
  });
});

describe('MarketplaceClient.getListing', () => {
  it('returns a single validated listing', async () => {
    const client = new MarketplaceClient({
      indexUrl: 'https://ix/api/v1',
      fetchImpl: fakeFetch({ 'https://ix/api/v1/listings/github-search': sampleListing }),
    });
    const got = await client.getListing('github-search');
    expect(got.version).toBe('1.0.0');
  });
});

describe('MarketplaceClient.fetchBundle', () => {
  it('validates the fetched bundle', async () => {
    const manifest = {
      name: 'x',
      description: 'x',
      version: '0.1.0',
      tools: [],
      dependencies: [],
      tags: [],
    };
    const contentHash = computeBundleHash({ manifest, skillMd: 'hi', publishedAt: '', publisher: 'me' } as never);
    const bundle = { manifest, skillMd: 'hi', publishedAt: '2026-04-16', publisher: 'me', contentHash };
    const client = new MarketplaceClient({
      fetchImpl: fakeFetch({ 'https://cdn/bundles/x.json': bundle }),
    });
    const got = await client.fetchBundle('https://cdn/bundles/x.json');
    expect(got.manifest.name).toBe('x');
    expect(got.contentHash).toHaveLength(64);
  });
});
