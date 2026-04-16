import { describe, expect, it } from 'vitest';
import { DiskCheck } from '../../../src/index.js';

const probeFixed = (free: number, total: number) => async () => ({ free, total });

describe('DiskCheck', () => {
  it('returns ok when free fraction is above warn threshold', async () => {
    const result = await new DiskCheck({ probe: probeFixed(800, 1000) }).run();
    expect(result.status).toBe('ok');
    expect(result.details?.['freeFraction']).toBeCloseTo(0.8);
  });

  it('returns warn when below warn threshold but above fail', async () => {
    const result = await new DiskCheck({
      warnFraction: 0.2,
      failFraction: 0.05,
      probe: probeFixed(150, 1000),
    }).run();
    expect(result.status).toBe('warn');
  });

  it('returns fail when below fail threshold', async () => {
    const result = await new DiskCheck({
      warnFraction: 0.2,
      failFraction: 0.05,
      probe: probeFixed(40, 1000),
    }).run();
    expect(result.status).toBe('fail');
  });

  it('rejects invalid threshold ordering', () => {
    expect(() => new DiskCheck({ warnFraction: 0.05, failFraction: 0.2 })).toThrow(RangeError);
    expect(() => new DiskCheck({ warnFraction: 1.5 })).toThrow(RangeError);
  });

  it('reports details including path, freeBytes, totalBytes', async () => {
    const result = await new DiskCheck({ path: '/data', probe: probeFixed(500, 1000) }).run();
    expect(result.details?.['path']).toBe('/data');
    expect(result.details?.['freeBytes']).toBe(500);
    expect(result.details?.['totalBytes']).toBe(1000);
  });
});
