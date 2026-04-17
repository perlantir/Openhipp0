import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DraftStore } from '../../src/forms/draft-store.js';

describe('DraftStore', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'hipp0-drafts-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('saves, loads, and clears a draft', async () => {
    const store = new DraftStore({ root });
    await store.save('sig123', 'https://x/form', { email: 'a@b.com' });
    const draft = await store.load('sig123');
    expect(draft?.url).toBe('https://x/form');
    expect(draft?.values['email']).toBe('a@b.com');
    await store.clear('sig123');
    expect(await store.load('sig123')).toBeNull();
  });

  it('lists saved drafts', async () => {
    const store = new DraftStore({ root });
    await store.save('a', 'u', {});
    await store.save('b', 'u', {});
    const list = await store.list();
    expect(new Set(list)).toEqual(new Set(['a', 'b']));
  });

  it('honors encrypt/decrypt hooks', async () => {
    const store = new DraftStore({
      root,
      encrypt: (s) => Buffer.from(s).toString('base64'),
      decrypt: (s) => Buffer.from(s, 'base64').toString('utf8'),
    });
    await store.save('enc', 'u', { f: 'v' });
    const draft = await store.load('enc');
    expect(draft?.values['f']).toBe('v');
  });
});
