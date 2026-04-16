/**
 * SchedulerEngine — ticks every `tickIntervalMs`, checks each registered task
 * against the current time, fires handlers for any that are due.
 *
 * Each tick computes the next fire time for every task. If `nextFireAt <=
 * now()`, the handler is invoked (fire-and-forget) and `nextFireAt` is
 * advanced. Missed windows (e.g. after a restart) are caught up at most once.
 *
 * The engine owns no LLM / agent runtime / bridge dependency. Callers
 * construct task handlers that spin up agent sessions, write to channels, etc.
 */

import { EventEmitter } from 'node:events';
import { nextFireTime, parseCron } from './cron.js';
import { naturalToCron } from './natural.js';
import type { CronTask, CronTaskConfig, SchedulerConfig, WebhookTrigger } from './types.js';
import { Hipp0CronParseError, Hipp0SchedulerError } from './types.js';

export class SchedulerEngine extends EventEmitter {
  private readonly tasks = new Map<string, CronTask>();
  private readonly webhooks = new Map<string, WebhookTrigger>();
  private readonly tickIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly now: () => number;

  constructor(config: SchedulerConfig = {}, now: () => number = Date.now) {
    super();
    this.tickIntervalMs = config.tickIntervalMs ?? 60_000;
    this.now = now;
  }

  /** Register a cron task. Parses NL or cron, computes first fire time. */
  addTask(config: CronTaskConfig, handler: CronTask['handler']): CronTask {
    if (this.tasks.has(config.id)) {
      throw new Hipp0SchedulerError(`Task already registered: ${config.id}`);
    }
    const cronExpression = naturalToCron(config.schedule) ?? config.schedule;
    // Validate the expression by parsing.
    try {
      parseCron(cronExpression);
    } catch {
      throw new Hipp0CronParseError(config.schedule);
    }
    const task: CronTask = { config, cronExpression, handler };
    this.computeNext(task);
    this.tasks.set(config.id, task);
    return task;
  }

  removeTask(id: string): boolean {
    return this.tasks.delete(id);
  }

  getTask(id: string): CronTask | undefined {
    return this.tasks.get(id);
  }

  listTasks(): readonly CronTask[] {
    return [...this.tasks.values()];
  }

  addWebhook(trigger: WebhookTrigger): void {
    if (this.webhooks.has(trigger.id)) {
      throw new Hipp0SchedulerError(`Webhook already registered: ${trigger.id}`);
    }
    this.webhooks.set(trigger.id, trigger);
  }

  removeWebhook(id: string): boolean {
    return this.webhooks.delete(id);
  }

  /** Called by an HTTP server on incoming webhook POST. */
  async handleWebhook(path: string, payload: unknown): Promise<boolean> {
    for (const wh of this.webhooks.values()) {
      if (wh.path === path) {
        try {
          await wh.handler(payload);
        } catch (err) {
          this.emit('error', { webhookId: wh.id, error: err });
        }
        return true;
      }
    }
    return false;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickIntervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Public so callers can drive manually / in tests. */
  async tick(): Promise<void> {
    const now = this.now();
    for (const task of this.tasks.values()) {
      if (task.config.enabled === false) continue;
      if (task.nextFireAt !== undefined && task.nextFireAt <= now) {
        this.emit('task_fired', { id: task.config.id, firedAt: now });
        try {
          await task.handler(task);
        } catch (err) {
          this.emit('error', { taskId: task.config.id, error: err });
        }
        this.computeNext(task);
      }
    }
  }

  private computeNext(task: CronTask): void {
    const parsed = parseCron(task.cronExpression);
    const next = nextFireTime(parsed, new Date(this.now()));
    task.nextFireAt = next?.getTime();
  }
}
