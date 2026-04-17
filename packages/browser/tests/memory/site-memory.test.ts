import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SiteMemory } from '../../src/memory/site-memory.js';

describe('SiteMemory', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'hipp0-site-mem-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('add + query round-trips a note', async () => {
    const mem = new SiteMemory({ root });
    const note = await mem.add({
      host: 'amazon.com',
      kind: 'step-plan',
      title: 'checkout',
      body: 'step 3 often fails',
    });
    const results = await mem.query({ host: 'amazon.com' });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(note.id);
  });

  it('reinforce increments reinforcements and weaken → 0 removes', async () => {
    const mem = new SiteMemory({ root });
    const n = await mem.add({ host: 'x.com', kind: 'pattern', title: 't', body: 'b' });
    await mem.reinforce('x.com', n.id);
    const q1 = await mem.query({ host: 'x.com' });
    expect(q1[0]!.reinforcements).toBe(1);
    await mem.weaken('x.com', n.id);
    const q2 = await mem.query({ host: 'x.com' });
    expect(q2).toHaveLength(0);
  });

  it('filters by kind + tags + pathPrefix', async () => {
    const mem = new SiteMemory({ root });
    await mem.add({ host: 'h.io', pathPrefix: '/shop', kind: 'pattern', title: 'a', body: 'b', tags: ['flow'] });
    await mem.add({ host: 'h.io', pathPrefix: '/admin', kind: 'known-failure', title: 'c', body: 'd' });
    const shopOnly = await mem.query({ host: 'h.io', pathPrefix: '/shop/cart' });
    expect(shopOnly.map((n) => n.title)).toEqual(['a']);
    const failures = await mem.query({ host: 'h.io', kinds: ['known-failure'] });
    expect(failures).toHaveLength(1);
  });

  it('emits change events', async () => {
    const mem = new SiteMemory({ root });
    const listener = vi.fn();
    mem.on(listener);
    await mem.add({ host: 'h.io', kind: 'note', title: 'n', body: '' });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]![0].kind).toBe('add');
  });
});
