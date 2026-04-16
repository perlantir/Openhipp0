import { describe, expect, it } from 'vitest';
import { Hipp0CronParseError, nextFireTime, parseCron } from '../src/index.js';

describe('parseCron', () => {
  it('parses a simple "every minute" expression', () => {
    const p = parseCron('* * * * *');
    expect(p.minutes.size).toBe(60);
    expect(p.hours.size).toBe(24);
    expect(p.daysOfMonth.size).toBe(31);
    expect(p.months.size).toBe(12);
    expect(p.daysOfWeek.size).toBe(7);
  });

  it('parses fixed values', () => {
    const p = parseCron('30 14 1 6 3');
    expect([...p.minutes]).toEqual([30]);
    expect([...p.hours]).toEqual([14]);
    expect([...p.daysOfMonth]).toEqual([1]);
    expect([...p.months]).toEqual([6]);
    expect([...p.daysOfWeek]).toEqual([3]);
  });

  it('parses ranges', () => {
    const p = parseCron('0-5 * * * *');
    expect([...p.minutes].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('parses comma lists', () => {
    const p = parseCron('0,15,30,45 * * * *');
    expect([...p.minutes].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
  });

  it('parses step values', () => {
    const p = parseCron('*/15 * * * *');
    expect([...p.minutes].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
  });

  it('normalizes day-of-week 7 to 0 (both mean Sunday)', () => {
    const p = parseCron('0 0 * * 7');
    expect(p.daysOfWeek.has(0)).toBe(true);
    expect(p.daysOfWeek.has(7)).toBe(false);
  });

  it('throws Hipp0CronParseError on invalid expressions', () => {
    expect(() => parseCron('not valid')).toThrow(Hipp0CronParseError);
    expect(() => parseCron('* * * *')).toThrow(Hipp0CronParseError); // only 4 fields
    expect(() => parseCron('99 * * * *')).toThrow(Hipp0CronParseError); // out of range
  });
});

describe('nextFireTime', () => {
  it('returns the next matching minute for */5', () => {
    const p = parseCron('*/5 * * * *');
    const after = new Date('2026-04-16T10:03:00Z');
    const next = nextFireTime(p, after);
    expect(next).not.toBeNull();
    expect(next!.getUTCHours()).toBe(10);
    expect(next!.getUTCMinutes()).toBe(5);
  });

  it('wraps to the next day for a time that already passed', () => {
    const p = parseCron('0 9 * * *');
    const after = new Date('2026-04-16T10:00:00Z');
    const next = nextFireTime(p, after);
    expect(next).not.toBeNull();
    expect(next!.getUTCDate()).toBe(17);
    expect(next!.getUTCHours()).toBe(9);
  });

  it('never fires at the exact `after` time (always strictly >) ', () => {
    const p = parseCron('0 9 * * *');
    const after = new Date('2026-04-16T09:00:00Z');
    const next = nextFireTime(p, after);
    expect(next!.getTime()).toBeGreaterThan(after.getTime());
  });
});
