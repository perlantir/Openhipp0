import { describe, expect, it } from 'vitest';
import {
  partitionFragments,
  quarantineItems,
} from '../../../src/security/injection/quarantine.js';
import type {
  TaggedFragment,
  TrustLevel,
} from '../../../src/security/injection/types.js';

describe('quarantineItems', () => {
  const items: Array<{ id: string; trust: TrustLevel }> = [
    { id: 'h', trust: 'high' },
    { id: 'm', trust: 'medium' },
    { id: 'l', trust: 'low' },
    { id: 'u', trust: 'untrusted' },
  ];

  it('keeps everything by default, spotlights low + untrusted', () => {
    const out = quarantineItems(items);
    expect(out.map((d) => [d.item.id, d.keep, d.spotlight])).toEqual([
      ['h', true, false],
      ['m', true, false],
      ['l', true, true],
      ['u', true, true],
    ]);
  });

  it('drops at-or-below threshold', () => {
    const out = quarantineItems(items, { dropAtOrBelow: 'low' });
    expect(out.find((d) => d.item.id === 'u')?.keep).toBe(false);
    expect(out.find((d) => d.item.id === 'l')?.keep).toBe(false);
    expect(out.find((d) => d.item.id === 'm')?.keep).toBe(true);
  });

  it('drop at untrusted keeps everything else', () => {
    const out = quarantineItems(items, { dropAtOrBelow: 'untrusted' });
    expect(out.find((d) => d.item.id === 'u')?.keep).toBe(false);
    expect(out.find((d) => d.item.id === 'l')?.keep).toBe(true);
  });
});

describe('partitionFragments', () => {
  const frags: TaggedFragment[] = [
    { tag: { origin: 'system', trust: 'high' }, text: 'trusted' },
    { tag: { origin: 'connector', trust: 'low' }, text: 'quarantined-low' },
    { tag: { origin: 'external', trust: 'untrusted' }, text: 'quarantined-u' },
  ];

  it('splits by trust', () => {
    const { safe, quarantined } = partitionFragments(frags);
    expect(safe.map((f) => f.text)).toEqual(['trusted']);
    expect(quarantined.map((f) => f.text)).toEqual(['quarantined-low', 'quarantined-u']);
  });

  it('drops when dropAtOrBelow is set', () => {
    const { safe, quarantined } = partitionFragments(frags, { dropAtOrBelow: 'low' });
    expect(safe.length).toBe(1);
    expect(quarantined.length).toBe(0);
  });
});
