/**
 * Cache-first read-through store.
 *
 * Reads: try the local cache → on miss (or caller-requested stale-time
 * expired), try the remote fetcher → write result back to cache.
 * On fetcher failure (offline), fall through to the stale cache entry
 * if one exists.
 *
 * Writes: cache is authoritative for writes; queue to the outbound
 * action queue (not owned here — the caller wires them together so this
 * module stays storage-agnostic).
 */

export interface CacheEntry<T> {
  readonly value: T;
  /** Unix ms when this entry was last written. */
  readonly writtenAt: number;
  /** Optional TTL in ms; `undefined` = no expiry. */
  readonly ttlMs?: number;
}

export interface CacheStore {
  get<T>(kind: string, id: string): Promise<CacheEntry<T> | null>;
  set<T>(kind: string, id: string, value: T, ttlMs?: number): Promise<void>;
  list<T>(kind: string): Promise<readonly { id: string; entry: CacheEntry<T> }[]>;
  delete(kind: string, id: string): Promise<void>;
  clear(kind?: string): Promise<void>;
}

export type RemoteFetcher<T> = (kind: string, id: string) => Promise<T | null>;

export interface CacheFirstOptions {
  /** Force a network fetch even if the cache has a fresh entry. */
  readonly forceRefresh?: boolean;
  /** If cache TTL has elapsed, fetch; falls back to stale cache on fetch fail. */
  readonly respectTtl?: boolean;
  /** Override; default Date.now. */
  readonly now?: () => number;
}

export async function cacheFirstRead<T>(
  store: CacheStore,
  fetcher: RemoteFetcher<T>,
  kind: string,
  id: string,
  opts: CacheFirstOptions = {},
): Promise<{ value: T | null; source: 'cache' | 'remote' | 'stale-cache' | 'miss' }> {
  const now = opts.now ?? Date.now;
  const entry = await store.get<T>(kind, id);
  const stale =
    entry !== null &&
    opts.respectTtl === true &&
    entry.ttlMs !== undefined &&
    now() > entry.writtenAt + entry.ttlMs;
  if (entry && !stale && !opts.forceRefresh) {
    return { value: entry.value, source: 'cache' };
  }
  try {
    const fresh = await fetcher(kind, id);
    if (fresh !== null) {
      await store.set(kind, id, fresh, entry?.ttlMs);
      return { value: fresh, source: 'remote' };
    }
    if (entry) return { value: entry.value, source: 'stale-cache' };
    return { value: null, source: 'miss' };
  } catch {
    if (entry) return { value: entry.value, source: 'stale-cache' };
    return { value: null, source: 'miss' };
  }
}

/** In-memory reference implementation. Use in tests + non-persistent deploys. */
export function createMemoryCache(): CacheStore {
  const data = new Map<string, Map<string, CacheEntry<unknown>>>();
  const bucket = (kind: string): Map<string, CacheEntry<unknown>> => {
    let b = data.get(kind);
    if (!b) {
      b = new Map();
      data.set(kind, b);
    }
    return b;
  };
  return {
    async get(kind, id) {
      return (bucket(kind).get(id) as CacheEntry<never> | undefined) ?? null;
    },
    async set(kind, id, value, ttlMs) {
      bucket(kind).set(id, { value, writtenAt: Date.now(), ...(ttlMs !== undefined && { ttlMs }) });
    },
    async list(kind) {
      return [...bucket(kind).entries()].map(([id, entry]) => ({ id, entry: entry as CacheEntry<never> }));
    },
    async delete(kind, id) {
      bucket(kind).delete(id);
    },
    async clear(kind) {
      if (kind) data.delete(kind);
      else data.clear();
    },
  };
}
