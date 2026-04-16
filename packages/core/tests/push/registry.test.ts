import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { FilePushRegistry, InMemoryPushRegistry } from '../../src/push/registry.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('InMemoryPushRegistry', () => {
  it('upsert + list + get + remove round-trip', async () => {
    const r = new InMemoryPushRegistry();
    await r.upsert({
      deviceId: 'a',
      pushToken: 'tok',
      platform: 'ios',
      updatedAt: '2026-04-16T00:00:00Z',
    });
    expect(await r.list()).toHaveLength(1);
    expect((await r.get('a'))?.pushToken).toBe('tok');
    await r.remove('a');
    expect(await r.get('a')).toBeUndefined();
  });

  it('upsert replaces by deviceId', async () => {
    const r = new InMemoryPushRegistry();
    await r.upsert({
      deviceId: 'a',
      pushToken: 'old',
      platform: 'ios',
      updatedAt: '2026-04-16T00:00:00Z',
    });
    await r.upsert({
      deviceId: 'a',
      pushToken: 'new',
      platform: 'ios',
      updatedAt: '2026-04-16T01:00:00Z',
    });
    const list = await r.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.pushToken).toBe('new');
  });
});

describe('FilePushRegistry', () => {
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = path.join(os.tmpdir(), `push-registry-${Date.now()}-${Math.random()}.json`);
  });

  afterEach(async () => {
    await fs.rm(tmpFile, { force: true }).catch(() => undefined);
  });

  it('persists to disk and reloads on new instance', async () => {
    const a = new FilePushRegistry({ filePath: tmpFile });
    await a.upsert({
      deviceId: 'd1',
      pushToken: 'tok',
      platform: 'android',
      updatedAt: '2026-04-16T00:00:00Z',
    });

    const b = new FilePushRegistry({ filePath: tmpFile });
    expect((await b.get('d1'))?.pushToken).toBe('tok');
  });

  it('missing file reads as empty', async () => {
    const r = new FilePushRegistry({ filePath: tmpFile });
    expect(await r.list()).toEqual([]);
  });

  it('remove drops the entry from disk', async () => {
    const r = new FilePushRegistry({ filePath: tmpFile });
    await r.upsert({
      deviceId: 'd1',
      pushToken: 'tok',
      platform: 'ios',
      updatedAt: '2026-04-16T00:00:00Z',
    });
    await r.remove('d1');
    const raw = JSON.parse(await fs.readFile(tmpFile, 'utf8')) as Record<string, unknown>;
    expect(raw['d1']).toBeUndefined();
  });
});
