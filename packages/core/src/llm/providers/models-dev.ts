/**
 * models.dev registry client — fetches live model metadata (context
 * window, pricing, capabilities). Structural `fetch` for tests.
 */

export interface ModelMetadata {
  readonly id: string;
  readonly provider: string;
  readonly contextWindow: number;
  readonly maxOutput?: number;
  readonly inputUsdPerMillionTokens?: number;
  readonly outputUsdPerMillionTokens?: number;
  readonly vision?: boolean;
  readonly tools?: boolean;
  readonly streaming?: boolean;
  readonly deprecated?: boolean;
  readonly knowledgeCutoff?: string;
}

export interface ModelsDevClientOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof globalThis.fetch;
  /** Response cache TTL (ms). Default 1h. */
  readonly cacheTtlMs?: number;
}

interface CacheEntry {
  readonly at: number;
  readonly data: ReadonlyArray<ModelMetadata>;
}

export class ModelsDevClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #cacheTtl: number;
  #cache: CacheEntry | null = null;

  constructor(opts: ModelsDevClientOptions = {}) {
    this.#baseUrl = opts.baseUrl ?? 'https://models.dev/api.json';
    this.#fetch = opts.fetchImpl ?? globalThis.fetch;
    this.#cacheTtl = opts.cacheTtlMs ?? 60 * 60 * 1_000;
  }

  async listAll(): Promise<readonly ModelMetadata[]> {
    if (this.#cache && Date.now() - this.#cache.at < this.#cacheTtl) return this.#cache.data;
    const resp = await this.#fetch(this.#baseUrl);
    if (!resp.ok) throw new Error(`models.dev ${resp.status}`);
    const raw = (await resp.json()) as Record<string, { models?: Record<string, unknown> }>;
    const out: ModelMetadata[] = [];
    for (const [provider, entry] of Object.entries(raw)) {
      const models = (entry?.models ?? {}) as Record<string, unknown>;
      for (const [id, m] of Object.entries(models)) {
        const meta = m as {
          limit?: { context?: number; output?: number };
          cost?: { input?: number; output?: number };
          modalities?: { input?: readonly string[] };
          tool_call?: boolean;
          reasoning?: boolean;
          knowledge?: string;
          last_updated?: string;
          deprecated?: boolean;
        };
        out.push({
          id,
          provider,
          contextWindow: meta.limit?.context ?? 0,
          ...(meta.limit?.output !== undefined ? { maxOutput: meta.limit.output } : {}),
          ...(meta.cost?.input !== undefined ? { inputUsdPerMillionTokens: meta.cost.input } : {}),
          ...(meta.cost?.output !== undefined ? { outputUsdPerMillionTokens: meta.cost.output } : {}),
          vision: meta.modalities?.input?.includes('image') ?? false,
          tools: meta.tool_call ?? false,
          streaming: true,
          ...(meta.deprecated ? { deprecated: true } : {}),
          ...(meta.knowledge ? { knowledgeCutoff: meta.knowledge } : {}),
        });
      }
    }
    this.#cache = { at: Date.now(), data: out };
    return out;
  }

  async recommendForTask(opts: {
    readonly task: 'chat' | 'tool' | 'vision' | 'long-context';
    readonly providerFilter?: readonly string[];
    readonly minContextWindow?: number;
  }): Promise<readonly ModelMetadata[]> {
    const all = await this.listAll();
    const filtered = all.filter((m) => {
      if (m.deprecated) return false;
      if (opts.providerFilter && !opts.providerFilter.includes(m.provider)) return false;
      if (opts.minContextWindow && m.contextWindow < opts.minContextWindow) return false;
      if (opts.task === 'vision' && !m.vision) return false;
      if (opts.task === 'tool' && !m.tools) return false;
      if (opts.task === 'long-context' && m.contextWindow < 200_000) return false;
      return true;
    });
    // Sort by price ascending (cheap first).
    return [...filtered].sort(
      (a, b) => (a.inputUsdPerMillionTokens ?? 0) + (a.outputUsdPerMillionTokens ?? 0) - ((b.inputUsdPerMillionTokens ?? 0) + (b.outputUsdPerMillionTokens ?? 0)),
    );
  }
}
