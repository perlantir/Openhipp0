import { describe, expect, it } from 'vitest';
import {
  normalizeTag,
  normalizeTags,
  tagOverlapCount,
  tagSimilarity,
} from '../../src/decisions/tags.js';

describe('normalizeTag', () => {
  it('lowercases and trims', () => {
    expect(normalizeTag('  Database  ')).toBe('database');
    // 'database' ends in 'e', no suffix rule applies — stays as is.
  });

  it('stems plurals: cats → cat', () => {
    expect(normalizeTag('cats')).toBe('cat');
  });

  it('stems ies → y: companies → company', () => {
    expect(normalizeTag('companies')).toBe('company');
  });

  it('stems sses → ss: classes → class', () => {
    expect(normalizeTag('classes')).toBe('class');
  });

  it('stems ed: worked → work', () => {
    expect(normalizeTag('worked')).toBe('work');
  });

  it('stems ing: running → runn', () => {
    expect(normalizeTag('running')).toBe('runn');
  });

  it('leaves short stems alone (guard against over-stripping)', () => {
    expect(normalizeTag('is')).toBe('is');
    expect(normalizeTag('was')).toBe('was');
  });

  it('leaves non-ASCII words as lowercased identity', () => {
    expect(normalizeTag('データベース')).toBe('データベース');
  });

  it('leaves kebab-case tokens identifiable', () => {
    expect(normalizeTag('event-loop')).toBe('event-loop');
  });

  it('returns empty for empty input', () => {
    expect(normalizeTag('')).toBe('');
    expect(normalizeTag('   ')).toBe('');
  });
});

describe('normalizeTags', () => {
  it('dedupes after normalization', () => {
    const out = normalizeTags(['Cat', 'cats', 'CAT', 'dog']);
    expect(out.sort()).toEqual(['cat', 'dog']);
  });

  it('drops empty entries', () => {
    const out = normalizeTags(['valid', '', '  ', 'other']);
    expect(out.sort()).toEqual(['other', 'valid']);
  });
});

describe('tagSimilarity', () => {
  it('identical sets → 1', () => {
    expect(tagSimilarity(['db', 'orm'], ['db', 'orm'])).toBe(1);
  });

  it('disjoint sets → 0', () => {
    expect(tagSimilarity(['db'], ['ui'])).toBe(0);
  });

  it('normalization lets plurals collide: cat/cats', () => {
    expect(tagSimilarity(['cat'], ['cats'])).toBe(1);
  });

  it('Jaccard: 2 in common / 4 in union = 0.5', () => {
    expect(tagSimilarity(['a', 'b', 'c'], ['b', 'c', 'd'])).toBeCloseTo(2 / 4);
  });

  it('both empty → 0 (not NaN)', () => {
    expect(tagSimilarity([], [])).toBe(0);
  });
});

describe('tagOverlapCount', () => {
  it('counts normalized matches from a in b', () => {
    expect(tagOverlapCount(['Cats', 'dogs'], ['cat', 'bird'])).toBe(1);
  });

  it('zero overlap → 0', () => {
    expect(tagOverlapCount(['x'], ['y'])).toBe(0);
  });
});
