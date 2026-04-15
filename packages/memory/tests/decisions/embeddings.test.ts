import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  DeterministicEmbeddingProvider,
  deserializeEmbedding,
  normalize,
  serializeEmbedding,
} from '../../src/decisions/embeddings.js';

describe('cosineSimilarity', () => {
  it('identical vectors score 1', () => {
    const v = Float32Array.from([0.1, 0.2, 0.3, 0.4]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('orthogonal vectors score 0', () => {
    const a = Float32Array.from([1, 0, 0, 0]);
    const b = Float32Array.from([0, 1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('opposite vectors score -1', () => {
    const a = Float32Array.from([1, 1, 0, 0]);
    const b = Float32Array.from([-1, -1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it('zero-magnitude vectors produce 0 instead of NaN', () => {
    const a = Float32Array.from([0, 0, 0]);
    const b = Float32Array.from([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('mismatched dims throw', () => {
    expect(() => cosineSimilarity(Float32Array.from([1, 2]), Float32Array.from([1, 2, 3]))).toThrow(
      /length mismatch/,
    );
  });
});

describe('normalize', () => {
  it('produces a unit vector', () => {
    const v = Float32Array.from([3, 4]);
    normalize(v);
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
  });

  it('leaves zero vectors alone', () => {
    const v = Float32Array.from([0, 0, 0]);
    normalize(v);
    expect([...v]).toEqual([0, 0, 0]);
  });
});

describe('serialize / deserialize', () => {
  it('round-trips within quantization tolerance', () => {
    const v = Float32Array.from([0.123456789, -0.987654321, 0.5]);
    const round = deserializeEmbedding(serializeEmbedding(v));
    expect(round.length).toBe(3);
    expect(round[0]).toBeCloseTo(0.123457, 5);
    expect(round[1]).toBeCloseTo(-0.987654, 5);
    expect(round[2]).toBeCloseTo(0.5, 5);
  });

  it('deserialize rejects non-array JSON', () => {
    expect(() => deserializeEmbedding('"not an array"')).toThrow();
  });
});

describe('DeterministicEmbeddingProvider', () => {
  it('same input → same vector (deterministic)', async () => {
    const p = new DeterministicEmbeddingProvider(64);
    const a = await p.embed('hello world');
    const b = await p.embed('hello world');
    expect([...a]).toEqual([...b]);
  });

  it('similar strings score higher than dissimilar ones', async () => {
    const p = new DeterministicEmbeddingProvider(256, 3);
    const db1 = await p.embed('We chose PostgreSQL for durability');
    const db2 = await p.embed('We chose PostgreSQL for reliability');
    const unrelated = await p.embed('Sandwiches are delicious');
    const sim = cosineSimilarity(db1, db2);
    const unr = cosineSimilarity(db1, unrelated);
    expect(sim).toBeGreaterThan(unr);
  });

  it('output is unit-length', async () => {
    const p = new DeterministicEmbeddingProvider(64);
    const v = await p.embed('unit test');
    const norm = Math.sqrt([...v].reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('embedBatch matches embed for each element', async () => {
    const p = new DeterministicEmbeddingProvider(64);
    const batch = await p.embedBatch(['a', 'bb', 'ccc']);
    const one = await p.embed('bb');
    expect([...batch[1]!]).toEqual([...one]);
  });

  it('rejects dim < 8', () => {
    expect(() => new DeterministicEmbeddingProvider(4)).toThrow(RangeError);
  });
});
