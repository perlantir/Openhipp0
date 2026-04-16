import { describe, expect, it } from 'vitest';
import { MemoryCheck } from '../../../src/index.js';

const probeFixed = (free: number, total: number) => () => ({ free, total });

describe('MemoryCheck', () => {
  it('ok when free fraction above warn threshold', async () => {
    const r = await new MemoryCheck({ probe: probeFixed(800, 1000) }).run();
    expect(r.status).toBe('ok');
  });

  it('warn between fail and warn thresholds', async () => {
    const r = await new MemoryCheck({
      warnFraction: 0.15,
      failFraction: 0.05,
      probe: probeFixed(80, 1000),
    }).run();
    expect(r.status).toBe('warn');
  });

  it('fail below fail threshold', async () => {
    const r = await new MemoryCheck({
      warnFraction: 0.15,
      failFraction: 0.05,
      probe: probeFixed(30, 1000),
    }).run();
    expect(r.status).toBe('fail');
  });

  it('rejects invalid thresholds', () => {
    expect(() => new MemoryCheck({ warnFraction: 0.05, failFraction: 0.2 })).toThrow(RangeError);
  });

  it('default probe samples real os', async () => {
    const r = await new MemoryCheck({}).run();
    expect(typeof r.details?.['freeBytes']).toBe('number');
    expect(typeof r.details?.['totalBytes']).toBe('number');
  });
});
