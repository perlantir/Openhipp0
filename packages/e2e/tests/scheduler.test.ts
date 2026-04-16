/**
 * End-to-end scenario: a scheduled task fires and drives the same
 * AgentRuntime the gateway uses. Proves the scheduler → agent →
 * memory wiring works when no bridge is involved.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SchedulerEngine } from '@openhipp0/scheduler';
import { db as memoryDb } from '@openhipp0/memory';
import { createFullStack, type FullStack } from '../src/index.js';

let stack: FullStack | undefined;

afterEach(async () => {
  await stack?.teardown();
  stack = undefined;
});

describe('E2E — scheduler fires → agent → session persisted', () => {
  it('a scheduled task that reaches its fire time invokes the runtime', async () => {
    // The stack's scripted LLM will reply once the scheduled task fires.
    stack = await createFullStack({ script: [{ text: 'scheduled ping handled' }] });

    // Fake clock so the cron "triggers now".
    let now = new Date('2030-01-01T00:00:00Z').getTime();
    const engine = new SchedulerEngine({ tickIntervalMs: 60_000 }, () => now);

    let fired = 0;
    engine.addTask({ id: 'heartbeat', schedule: '* * * * *' }, async () => {
      fired++;
      await stack!.runtime.handleMessage({ message: 'heartbeat' });
    });

    // Advance one minute and tick manually (no real timer needed).
    now += 60_000;
    await engine.tick();

    expect(fired).toBe(1);
    const rows = stack.db.select().from(memoryDb.sessionHistory).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.toolCallsCount).toBe(0);
  });
});
