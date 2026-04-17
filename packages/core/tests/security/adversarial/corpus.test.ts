import { describe, expect, it } from 'vitest';

import {
  ADVERSARIAL_CORPUS,
  ADVERSARIAL_COUNT,
  casesByExpectedDefense,
  casesByFamily,
} from '../../../src/security/adversarial/index.js';

describe('adversarial corpus', () => {
  it('ships ≥ 85 cases across every family', () => {
    expect(ADVERSARIAL_COUNT).toBeGreaterThanOrEqual(85);
    const families = new Set(ADVERSARIAL_CORPUS.map((c) => c.family));
    expect(families.size).toBeGreaterThanOrEqual(10);
  });

  it('every case has a unique id + non-empty input', () => {
    const ids = new Set<string>();
    for (const c of ADVERSARIAL_CORPUS) {
      expect(c.id.length).toBeGreaterThan(0);
      expect(c.input.length).toBeGreaterThan(0);
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
    }
    expect(ids.size).toBe(ADVERSARIAL_CORPUS.length);
  });

  it('casesByFamily returns only matching cases', () => {
    const direct = casesByFamily('direct-injection');
    expect(direct.length).toBeGreaterThan(10);
    expect(direct.every((c) => c.family === 'direct-injection')).toBe(true);
  });

  it('has benign controls that expect nothing-to-detect', () => {
    const benign = casesByExpectedDefense('nothing-to-detect');
    expect(benign.length).toBeGreaterThan(0);
  });
});
