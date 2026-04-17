import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PatternStore } from '../../src/forms/pattern-store.js';

describe('PatternStore', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'hipp0-patterns-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('records a new pattern with timesConfirmed=1 and increments on re-record', async () => {
    const store = new PatternStore({ root });
    const base = {
      signature: 'sig',
      host: 'example.com',
      pathPrefix: '/signup',
      stepCount: 2,
      kindOverrides: { 'name:Email': 'email' as const },
    };
    const first = await store.recordSuccess(base);
    expect(first.timesConfirmed).toBe(1);
    const second = await store.recordSuccess(base);
    expect(second.timesConfirmed).toBe(2);
  });

  it('finds by exact signature preferentially, else by longest host+prefix', async () => {
    const store = new PatternStore({ root });
    await store.recordSuccess({
      signature: 'sig-a',
      host: 'example.com',
      pathPrefix: '/shop',
      stepCount: 1,
      kindOverrides: {},
    });
    await store.recordSuccess({
      signature: 'sig-b',
      host: 'example.com',
      pathPrefix: '/shop/checkout',
      stepCount: 3,
      kindOverrides: {},
    });
    const bySig = await store.find('example.com', '/shop/checkout/step-2', 'sig-a');
    expect(bySig?.signature).toBe('sig-a');
    const byPrefix = await store.find('example.com', '/shop/checkout/step-2', 'nonexistent');
    expect(byPrefix?.signature).toBe('sig-b');
  });

  it('forget removes the pattern', async () => {
    const store = new PatternStore({ root });
    await store.recordSuccess({ signature: 's', host: 'h', pathPrefix: '/', stepCount: 1, kindOverrides: {} });
    expect((await store.list())).toHaveLength(1);
    await store.forget('s');
    expect((await store.list())).toHaveLength(0);
  });
});
