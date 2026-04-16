import { describe, expect, it } from 'vitest';
import { SchedulerEngine, Hipp0CronParseError, Hipp0SchedulerError } from '../src/index.js';

describe('SchedulerEngine', () => {
  it('fires a task when tick crosses nextFireAt', async () => {
    let now = new Date('2026-04-16T10:00:00Z').getTime();
    const engine = new SchedulerEngine({ tickIntervalMs: 60_000 }, () => now);
    const fired: string[] = [];

    engine.addTask({ id: 'greeting', schedule: '*/5 * * * *', enabled: true }, (t) => {
      fired.push(t.config.id);
    });

    // Advance to 10:05 → should fire.
    now = new Date('2026-04-16T10:05:00Z').getTime();
    await engine.tick();
    expect(fired).toEqual(['greeting']);
    // Next fire should be 10:10.
    expect(engine.getTask('greeting')!.nextFireAt).toBeGreaterThan(now);
  });

  it('skips disabled tasks', async () => {
    let now = new Date('2026-04-16T10:00:00Z').getTime();
    const engine = new SchedulerEngine({}, () => now);
    let fired = false;
    engine.addTask({ id: 'x', schedule: '* * * * *', enabled: false }, () => {
      fired = true;
    });
    now += 120_000;
    await engine.tick();
    expect(fired).toBe(false);
  });

  it('accepts natural-language schedules', () => {
    const engine = new SchedulerEngine();
    const task = engine.addTask({ id: 'nl', schedule: 'every 30 minutes' }, () => {});
    expect(task.cronExpression).toBe('*/30 * * * *');
  });

  it('throws Hipp0CronParseError on invalid schedule', () => {
    const engine = new SchedulerEngine();
    expect(() => engine.addTask({ id: 'bad', schedule: 'not a cron or nl' }, () => {})).toThrow(
      Hipp0CronParseError,
    );
  });

  it('throws on duplicate task id', () => {
    const engine = new SchedulerEngine();
    engine.addTask({ id: 'a', schedule: '* * * * *' }, () => {});
    expect(() => engine.addTask({ id: 'a', schedule: '* * * * *' }, () => {})).toThrow(
      Hipp0SchedulerError,
    );
  });

  it('removeTask + listTasks', () => {
    const engine = new SchedulerEngine();
    engine.addTask({ id: 'a', schedule: '* * * * *' }, () => {});
    engine.addTask({ id: 'b', schedule: '* * * * *' }, () => {});
    expect(engine.listTasks()).toHaveLength(2);
    expect(engine.removeTask('a')).toBe(true);
    expect(engine.listTasks()).toHaveLength(1);
  });

  it('handleWebhook dispatches to matching path', async () => {
    const engine = new SchedulerEngine();
    let payload: unknown;
    engine.addWebhook({
      id: 'deploy',
      path: '/hooks/deploy',
      description: 'Deploy hook',
      handler: (p) => {
        payload = p;
      },
    });
    const matched = await engine.handleWebhook('/hooks/deploy', { sha: 'abc123' });
    expect(matched).toBe(true);
    expect(payload).toEqual({ sha: 'abc123' });

    const missed = await engine.handleWebhook('/hooks/other', {});
    expect(missed).toBe(false);
  });

  it('start/stop is idempotent', () => {
    const engine = new SchedulerEngine({ tickIntervalMs: 60_000 });
    engine.start();
    engine.start();
    engine.stop();
    engine.stop();
  });

  it('emits task_fired on successful fire', async () => {
    let now = new Date('2026-04-16T10:00:00Z').getTime();
    const engine = new SchedulerEngine({}, () => now);
    const events: string[] = [];
    engine.on('task_fired', (e) => events.push(e.id));
    engine.addTask({ id: 't1', schedule: '*/5 * * * *' }, () => {});
    now = new Date('2026-04-16T10:05:00Z').getTime();
    await engine.tick();
    expect(events).toEqual(['t1']);
  });

  it('emits error on handler throw without crashing', async () => {
    let now = new Date('2026-04-16T10:00:00Z').getTime();
    const engine = new SchedulerEngine({}, () => now);
    const errors: unknown[] = [];
    engine.on('error', (e) => errors.push(e));
    engine.addTask({ id: 't', schedule: '*/5 * * * *' }, () => {
      throw new Error('boom');
    });
    now = new Date('2026-04-16T10:05:00Z').getTime();
    await engine.tick();
    expect(errors.length).toBe(1);
  });
});
