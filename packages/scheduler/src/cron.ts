/**
 * Minimal 5-field cron parser.
 *
 * Fields: minute (0-59) hour (0-23) day-of-month (1-31) month (1-12) day-of-week (0-7, 0=7=Sun)
 * Supports: single values, ranges (1-5), steps (star/N), commas (1,3,5), star.
 * Does NOT support: L, W, #, year field, string month/day names.
 *
 * nextFireTime() returns the next fire time >= `after` by brute-force minute
 * scan (cap at 2 years). This is simple, correct, and fast enough for the
 * heartbeat scheduler where tasks fire at most once per minute.
 */

import { Hipp0CronParseError } from './types.js';

interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

export function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Hipp0CronParseError(expr);
  const minutes = parseField(parts[0]!, 0, 59);
  const hours = parseField(parts[1]!, 0, 23);
  const daysOfMonth = parseField(parts[2]!, 1, 31);
  const months = parseField(parts[3]!, 1, 12);
  const daysOfWeek = normalizeDow(parseField(parts[4]!, 0, 7));
  return { minutes, hours, daysOfMonth, months, daysOfWeek };
}

export function nextFireTime(parsed: ParsedCron, after: Date): Date | null {
  const d = new Date(after);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // never fire at the exact `after` time

  const twoYearsLater = after.getTime() + 2 * 365 * 24 * 60 * 60 * 1000;
  while (d.getTime() < twoYearsLater) {
    if (
      parsed.months.has(d.getMonth() + 1) &&
      parsed.daysOfMonth.has(d.getDate()) &&
      parsed.daysOfWeek.has(d.getDay()) &&
      parsed.hours.has(d.getHours()) &&
      parsed.minutes.has(d.getMinutes())
    ) {
      return d;
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const result = new Set<number>();
  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const step = stepMatch ? parseInt(stepMatch[2]!, 10) : 1;
    const range = stepMatch ? stepMatch[1]! : part;

    if (range === '*') {
      for (let i = min; i <= max; i += step) result.add(i);
    } else if (range.includes('-')) {
      const [lo, hi] = range.split('-').map(Number);
      if (lo === undefined || hi === undefined || isNaN(lo) || isNaN(hi)) {
        throw new Hipp0CronParseError(field);
      }
      if (lo < min || hi > max || lo > hi) throw new Hipp0CronParseError(field);
      for (let i = lo; i <= hi; i += step) result.add(i);
    } else {
      const n = parseInt(range, 10);
      if (isNaN(n) || n < min || n > max) throw new Hipp0CronParseError(field);
      result.add(n);
    }
  }
  return result;
}

/** Normalize day-of-week: both 0 and 7 mean Sunday (JS Date.getDay() uses 0). */
function normalizeDow(s: Set<number>): Set<number> {
  if (s.has(7)) {
    s.add(0);
    s.delete(7);
  }
  return s;
}
