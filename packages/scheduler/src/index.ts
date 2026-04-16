// @openhipp0/scheduler — Heartbeat cron + natural-language triggers + webhook ingress
//
// Phase 6.1 — Heartbeat Scheduler:
//   - 5-field cron parser (parseCron + nextFireTime)
//   - Natural-language → cron converter (naturalToCron)
//   - SchedulerEngine: tick loop, task registration, webhook dispatch

export const packageName = '@openhipp0/scheduler' as const;
export const version = '0.0.0' as const;

export * from './types.js';
export { parseCron, nextFireTime } from './cron.js';
export { naturalToCron } from './natural.js';
export { SchedulerEngine } from './engine.js';
