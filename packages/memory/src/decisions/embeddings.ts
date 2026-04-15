/**
 * Embedding generation + vector utilities.
 *
 * Two providers ship in-tree:
 *   - OpenAIEmbeddingProvider: real embeddings via text-embedding-3-small
 *     (1536 dims). Requires OPENAI_API_KEY or an injected client.
 *   - DeterministicEmbeddingProvider: hash-based stub for tests. Same input
 *     always produces the same vector; similar strings produce *somewhat*
 *     similar vectors (shared n-gram hashing) so similarity tests are
 *     meaningful without hitting the network.
 *
 * Storage format: JSON-encoded number arrays in SQLite's TEXT column
 * (see packages/memory/src/db/schema.ts). Postgres+pgvector will use the
 * vector type natively — conversion helpers defined here keep both paths
 * compatible.
 */

import OpenAI from 'openai';

/** Default embedding dimensionality (text-embedding-3-small). */
export const EMBEDDING_DIM = 1536;

export interface EmbeddingProvider {
  readonly name: string;
  readonly dim: number;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI-backed provider
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenAIEmbeddingOptions {
  apiKey?: string;
  model?: string;
  dim?: number;
  client?: OpenAI;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly dim: number;
  private readonly model: string;
  private readonly client: OpenAI;

  constructor(opts: OpenAIEmbeddingOptions = {}) {
    this.model = opts.model ?? 'text-embedding-3-small';
    this.dim = opts.dim ?? EMBEDDING_DIM;
    this.client = opts.client ?? new OpenAI({ apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY });
  }

  async embed(text: string): Promise<Float32Array> {
    const resp = await this.client.embeddings.create({
      model: this.model,
      input: text,
      dimensions: this.dim,
    });
    const first = resp.data[0];
    if (!first) throw new Error('OpenAI embeddings returned no data');
    return Float32Array.from(first.embedding);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const resp = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      dimensions: this.dim,
    });
    return resp.data.map((d) => Float32Array.from(d.embedding));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic stub (tests, offline dev)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hash-based deterministic embedding. Uses a rolling-hash n-gram sketch so
 * textually-similar strings produce similar vectors. NOT cryptographic;
 * NOT a real language model. Use only for tests / smoke paths.
 */
export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'deterministic';
  readonly dim: number;
  private readonly ngramSize: number;

  constructor(dim = 128, ngramSize = 3) {
    if (dim < 8) throw new RangeError('dim must be >= 8');
    this.dim = dim;
    this.ngramSize = ngramSize;
  }

  async embed(text: string): Promise<Float32Array> {
    return Promise.resolve(this.hashEmbed(text));
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.resolve(texts.map((t) => this.hashEmbed(t)));
  }

  private hashEmbed(text: string): Float32Array {
    const v = new Float32Array(this.dim);
    const lower = text.toLowerCase();
    // Single-character "1-gram" contributions — catches short strings.
    for (let i = 0; i < lower.length; i++) {
      const h = fnv1a(lower.charCodeAt(i).toString()) % this.dim;
      v[h] = (v[h] ?? 0) + 1;
    }
    // N-gram sliding window.
    for (let i = 0; i + this.ngramSize <= lower.length; i++) {
      const gram = lower.slice(i, i + this.ngramSize);
      const h = fnv1a(gram) % this.dim;
      v[h] = (v[h] ?? 0) + 1;
      // Also splash into a neighbor bucket so near-miss n-grams share mass.
      const h2 = (h + 1) % this.dim;
      v[h2] = (v[h2] ?? 0) + 0.25;
    }
    return normalize(v);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Vector utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Cosine similarity in [-1, 1]. Returns 0 for zero-magnitude inputs. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** In-place L2-normalize. Returns the same buffer for chaining. */
export function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += (v[i] ?? 0) ** 2;
  if (sum === 0) return v;
  const inv = 1 / Math.sqrt(sum);
  for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) * inv;
  return v;
}

/** Serialize to JSON-encoded number array (SQLite-friendly). */
export function serializeEmbedding(v: Float32Array): string {
  // Rounding to 6 decimals saves ~40% of storage without perceptible sim loss.
  const rounded = Array.from(v, (x) => Math.round(x * 1e6) / 1e6);
  return JSON.stringify(rounded);
}

/** Deserialize from the JSON text stored in the DB. */
export function deserializeEmbedding(raw: string): Float32Array {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error('embedding: expected JSON array');
  return Float32Array.from(parsed as number[]);
}

// ─────────────────────────────────────────────────────────────────────────────

/** FNV-1a 32-bit hash. Small, fast, deterministic, no allocations. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}
