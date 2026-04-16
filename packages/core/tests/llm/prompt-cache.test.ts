import { describe, expect, it } from 'vitest';
import {
  cacheBoundaryIndex,
  tagSystemAsCacheable,
  tagToolsAsCacheable,
} from '../../src/llm/prompt-cache.js';
import type { ToolDef } from '../../src/llm/types.js';

describe('tagSystemAsCacheable', () => {
  it('returns the original text with cacheControl flag', () => {
    const out = tagSystemAsCacheable('You are helpful.');
    expect(out.text).toBe('You are helpful.');
    expect(out.cacheControl).toBe(true);
  });
});

describe('tagToolsAsCacheable', () => {
  it('marks every tool', () => {
    const tools: ToolDef[] = [
      { name: 'a', description: 'd', inputSchema: { type: 'object' } },
      { name: 'b', description: 'd', inputSchema: { type: 'object' } },
    ];
    const out = tagToolsAsCacheable(tools) as Array<ToolDef & { __cache?: boolean }>;
    expect(out[0]?.__cache).toBe(true);
    expect(out[1]?.__cache).toBe(true);
  });
});

describe('cacheBoundaryIndex', () => {
  const msgs = Array.from({ length: 5 }, () => ({ role: 'user' as const, content: 'x' }));
  it('returns -1 when firstN is undefined or 0', () => {
    expect(cacheBoundaryIndex(msgs, undefined)).toBe(-1);
    expect(cacheBoundaryIndex(msgs, 0)).toBe(-1);
  });
  it('caps at messages.length - 1', () => {
    expect(cacheBoundaryIndex(msgs, 100)).toBe(4);
  });
  it('returns firstN - 1', () => {
    expect(cacheBoundaryIndex(msgs, 2)).toBe(1);
  });
});
