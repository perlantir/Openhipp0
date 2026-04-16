import { describe, expect, it } from 'vitest';
import { createModelRouter, defaultClassify } from '../../src/llm/router.js';
import type { TierConfig } from '../../src/llm/router.js';

const tiers: TierConfig = {
  haiku: { type: 'anthropic', model: 'claude-haiku-4-5' },
  sonnet: { type: 'anthropic', model: 'claude-sonnet-4-6' },
  opus: { type: 'anthropic', model: 'claude-opus-4-7' },
};

describe('defaultClassify', () => {
  it('opus for safety-sensitive', () => {
    expect(defaultClassify({ safetySensitive: true })).toBe('opus');
  });
  it('opus for very long input', () => {
    expect(defaultClassify({ estimatedInputTokens: 50_000 })).toBe('opus');
  });
  it('sonnet for reasoning', () => {
    expect(defaultClassify({ requiresReasoning: true })).toBe('sonnet');
  });
  it('sonnet for medium-length input', () => {
    expect(defaultClassify({ estimatedInputTokens: 10_000 })).toBe('sonnet');
  });
  it('haiku for short simple tasks', () => {
    expect(defaultClassify({ estimatedInputTokens: 500 })).toBe('haiku');
    expect(defaultClassify({})).toBe('haiku');
  });
});

describe('createModelRouter.select', () => {
  const r = createModelRouter({ tiers });

  it('returns the primary + failover ladder', () => {
    const out = r.select({});
    expect(out.primary).toBe('haiku');
    expect(out.providers.map((p) => p.model)).toEqual([
      'claude-haiku-4-5',
      'claude-sonnet-4-6',
      'claude-opus-4-7',
    ]);
  });

  it('sonnet ladder upgrades to opus only', () => {
    const out = r.select({ requiresReasoning: true });
    expect(out.primary).toBe('sonnet');
    expect(out.providers.map((p) => p.model)).toEqual([
      'claude-sonnet-4-6',
      'claude-opus-4-7',
    ]);
  });

  it('opus ladder is singular', () => {
    const out = r.select({ safetySensitive: true });
    expect(out.primary).toBe('opus');
    expect(out.providers).toHaveLength(1);
  });

  it('accepts a custom classifier', () => {
    const custom = createModelRouter({ tiers, classify: () => 'opus' });
    expect(custom.classify({})).toBe('opus');
  });
});
