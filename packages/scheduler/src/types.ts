/**
 * Scheduler public types.
 *
 * A CronTask runs on a 5-field cron schedule (minute, hour, dayOfMonth,
 * month, dayOfWeek). Natural-language triggers (e.g. "every 30 minutes")
 * are parsed into cron at registration time.
 *
 * WebhookTrigger fires on an incoming HTTP POST to a configured path.
 * Both types share the same execution contract: fire the provided handler.
 */

import { z } from 'zod';

export const CronExpressionSchema = z.string().min(1);

export const CronTaskSchema = z.object({
  id: z.string().min(1),
  /** 5-field cron expression or natural-language string (parsed on registration). */
  schedule: z.string().min(1),
  description: z.string().default(''),
  /** Whether the task is active. Default true. */
  enabled: z.boolean().default(true),
  /** Project scope. */
  projectId: z.string().optional(),
  /** Channel to deliver results to. */
  channelId: z.string().optional(),
});

export type CronTaskConfig = z.infer<typeof CronTaskSchema>;

export interface CronTask {
  config: CronTaskConfig;
  /** Parsed 5-field cron expression (may differ from config.schedule if NL was used). */
  cronExpression: string;
  /** Handler invoked on trigger. Must be fast; the engine does NOT await it. */
  handler: (task: CronTask) => void | Promise<void>;
  /** Next scheduled fire time (ms epoch). undefined = not scheduled. */
  nextFireAt?: number;
}

export interface WebhookTrigger {
  id: string;
  /** URL path to match (e.g. '/hooks/deploy'). */
  path: string;
  description: string;
  handler: (payload: unknown) => void | Promise<void>;
}

export interface SchedulerConfig {
  /** Tick interval for checking cron tasks. Default 60_000 (1 minute). */
  tickIntervalMs?: number;
}

export class Hipp0SchedulerError extends Error {
  readonly code: string;
  constructor(message: string, code = 'HIPP0_SCHEDULER_ERROR') {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class Hipp0CronParseError extends Hipp0SchedulerError {
  constructor(expression: string) {
    super(`Invalid cron expression: "${expression}"`, 'HIPP0_CRON_PARSE');
  }
}
