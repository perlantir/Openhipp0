import { describe, expect, it } from 'vitest';
import { naturalToCron } from '../src/index.js';

describe('naturalToCron', () => {
  it('every 30 minutes', () => {
    expect(naturalToCron('every 30 minutes')).toBe('*/30 * * * *');
  });

  it('every minute', () => {
    expect(naturalToCron('every minute')).toBe('* * * * *');
  });

  it('every hour', () => {
    expect(naturalToCron('every hour')).toBe('0 * * * *');
  });

  it('every 2 hours', () => {
    expect(naturalToCron('every 2 hours')).toBe('0 */2 * * *');
  });

  it('every day at 9:00', () => {
    expect(naturalToCron('every day at 9:00')).toBe('0 9 * * *');
  });

  it('every day at 14:30', () => {
    expect(naturalToCron('every day at 14:30')).toBe('30 14 * * *');
  });

  it('every monday at 10:00', () => {
    expect(naturalToCron('every monday at 10:00')).toBe('0 10 * * 1');
  });

  it('every weekday at 8:00', () => {
    expect(naturalToCron('every weekday at 8:00')).toBe('0 8 * * 1-5');
  });

  it('every weekend at 10:00', () => {
    expect(naturalToCron('every weekend at 10:00')).toBe('0 10 * * 0,6');
  });

  it('returns null for unrecognized phrases', () => {
    expect(naturalToCron('when the moon is full')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(naturalToCron('Every 5 Minutes')).toBe('*/5 * * * *');
  });
});
