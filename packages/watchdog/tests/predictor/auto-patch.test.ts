import { describe, expect, it } from 'vitest';
import { AutoPatchRegistry, type PatchSignal } from '../../src/index.js';

describe('AutoPatchRegistry', () => {
  it('register / list / unregister', () => {
    const reg = new AutoPatchRegistry();
    reg.register({
      id: 'p1',
      description: 'first',
      matches: () => true,
      apply: async () => {},
    });
    expect(reg.list()).toHaveLength(1);
    expect(reg.unregister('p1')).toBe(true);
    expect(reg.list()).toEqual([]);
  });

  it('rejects duplicate ids', () => {
    const reg = new AutoPatchRegistry();
    reg.register({ id: 'p', description: '', matches: () => true, apply: async () => {} });
    expect(() =>
      reg.register({ id: 'p', description: '', matches: () => true, apply: async () => {} }),
    ).toThrow();
  });

  it('applies all matching patches in registration order', async () => {
    const reg = new AutoPatchRegistry();
    const calls: string[] = [];
    reg.register({
      id: 'a',
      description: '',
      matches: () => true,
      apply: async () => {
        calls.push('a');
      },
    });
    reg.register({
      id: 'b',
      description: '',
      matches: () => true,
      apply: async () => {
        calls.push('b');
      },
    });
    const events = await reg.handle({ source: 's', payload: null });
    expect(calls).toEqual(['a', 'b']);
    expect(events.map((e) => e.patchId)).toEqual(['a', 'b']);
    expect(events.every((e) => e.ok)).toBe(true);
  });

  it('skips non-matching patches', async () => {
    const reg = new AutoPatchRegistry();
    let called = false;
    reg.register({
      id: 'p',
      description: '',
      matches: (s) => (s.payload as { tag: string }).tag === 'wanted',
      apply: async () => {
        called = true;
      },
    });
    await reg.handle({ source: 's', payload: { tag: 'other' } });
    expect(called).toBe(false);
    await reg.handle({ source: 's', payload: { tag: 'wanted' } });
    expect(called).toBe(true);
  });

  it('respects per-patch cooldown', async () => {
    const reg = new AutoPatchRegistry();
    let count = 0;
    reg.register({
      id: 'p',
      description: '',
      cooldownMs: 1000,
      matches: () => true,
      apply: async () => {
        count++;
      },
    });
    let now = 0;
    const sig = (): PatchSignal => ({ source: 's', payload: null, at: now });
    await reg.handle(sig());
    await reg.handle(sig());
    expect(count).toBe(1);
    now = 1500;
    await reg.handle(sig());
    expect(count).toBe(2);
  });

  it('captures apply throws as ok=false events without bubbling', async () => {
    const reg = new AutoPatchRegistry();
    reg.register({
      id: 'p',
      description: '',
      matches: () => true,
      apply: async () => {
        throw new Error('fix-blew-up');
      },
    });
    const events = await reg.handle({ source: 's', payload: null });
    expect(events[0]!.ok).toBe(false);
    expect((events[0]!.error as Error).message).toBe('fix-blew-up');
  });

  it('emits patch_applied for each apply (success and failure)', async () => {
    const reg = new AutoPatchRegistry();
    const seen: { id: string; ok: boolean }[] = [];
    reg.on('patch_applied', (e) => seen.push({ id: e.patchId, ok: e.ok }));
    reg.register({ id: 'a', description: '', matches: () => true, apply: async () => {} });
    reg.register({
      id: 'b',
      description: '',
      matches: () => true,
      apply: async () => {
        throw new Error('x');
      },
    });
    await reg.handle({ source: 's', payload: null });
    expect(seen).toEqual([
      { id: 'a', ok: true },
      { id: 'b', ok: false },
    ]);
  });

  it('reset() drops cooldown history', async () => {
    const reg = new AutoPatchRegistry();
    let count = 0;
    reg.register({
      id: 'p',
      description: '',
      cooldownMs: 1_000_000,
      matches: () => true,
      apply: async () => {
        count++;
      },
    });
    const now = 0;
    await reg.handle({ source: 's', payload: null, at: now });
    await reg.handle({ source: 's', payload: null, at: now });
    expect(count).toBe(1);
    reg.reset();
    await reg.handle({ source: 's', payload: null, at: now });
    expect(count).toBe(2);
  });
});
