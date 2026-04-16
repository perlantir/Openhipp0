/**
 * Natural-language → cron converter. Handles common patterns:
 *
 *   "every 30 minutes"       → * /30 * * * *   (no space before /30)
 *   "every hour"             → 0 * * * *
 *   "every 2 hours"          → 0 * /2 * * *
 *   "every day at 9:00"      → 0 9 * * *
 *   "every day at 14:30"     → 30 14 * * *
 *   "every monday at 10:00"  → 0 10 * * 1
 *   "every weekday at 8:00"  → 0 8 * * 1-5
 *
 * Returns null if no pattern matches (caller should try treating the string
 * as a raw cron expression).
 */

const DAY_MAP: Record<string, string> = {
  sunday: '0',
  monday: '1',
  tuesday: '2',
  wednesday: '3',
  thursday: '4',
  friday: '5',
  saturday: '6',
  weekday: '1-5',
  weekend: '0,6',
};

export function naturalToCron(input: string): string | null {
  const s = input.toLowerCase().trim();

  // "every N minutes"
  const minMatch = s.match(/^every\s+(\d+)\s+minutes?$/);
  if (minMatch) return `*/${minMatch[1]} * * * *`;

  // "every minute"
  if (/^every\s+minute$/.test(s)) return '* * * * *';

  // "every hour"
  if (/^every\s+hour$/.test(s)) return '0 * * * *';

  // "every N hours"
  const hourMatch = s.match(/^every\s+(\d+)\s+hours?$/);
  if (hourMatch) return `0 */${hourMatch[1]} * * *`;

  // "every day at HH:MM"
  const dailyMatch = s.match(/^every\s+day\s+at\s+(\d{1,2}):(\d{2})$/);
  if (dailyMatch) return `${parseInt(dailyMatch[2]!, 10)} ${parseInt(dailyMatch[1]!, 10)} * * *`;

  // "every <dayname> at HH:MM"
  const dayNameMatch = s.match(
    /^every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|weekday|weekend)\s+at\s+(\d{1,2}):(\d{2})$/,
  );
  if (dayNameMatch) {
    const dow = DAY_MAP[dayNameMatch[1]!]!;
    const h = parseInt(dayNameMatch[2]!, 10);
    const m = parseInt(dayNameMatch[3]!, 10);
    return `${m} ${h} * * ${dow}`;
  }

  return null;
}
