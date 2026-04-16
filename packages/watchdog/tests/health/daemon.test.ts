import { describe, expect, it } from 'vitest';
import {
  HealthDaemon,
  HealthRegistry,
  type HealthCheck,
  type HealthCheckOutput,
} from '../../src/index.js';

const stubCheck = (name: string, get: () => HealthCheckOutput): HealthCheck => ({
  name,
  description: '',
  run: async () => get(),
});

describe('HealthDaemon', () => {
  it('emits a report on each tick', async () => {
    const reg = new HealthRegistry();
    reg.register(stubCheck('a', () => ({ status: 'ok' })));
    const daemon = new HealthDaemon(reg, { intervalMs: 10_000 });

    const reports: number[] = [];
    daemon.on('report', () => reports.push(1));

    await daemon.tick();
    await daemon.tick();
    expect(reports.length).toBe(2);
  });

  it("emits 'change' only when overall status flips", async () => {
    const reg = new HealthRegistry();
    let status: HealthCheckOutput['status'] = 'ok';
    reg.register(stubCheck('a', () => ({ status })));
    const daemon = new HealthDaemon(reg);

    const changes: { from: unknown; to: unknown }[] = [];
    daemon.on('change', (e) => changes.push({ from: e.from, to: e.to }));

    await daemon.tick(); // null → ok
    await daemon.tick(); // ok → ok (no emit)
    status = 'fail';
    await daemon.tick(); // ok → fail
    status = 'fail';
    await daemon.tick(); // fail → fail (no emit)

    expect(changes).toEqual([
      { from: null, to: 'ok' },
      { from: 'ok', to: 'fail' },
    ]);
  });

  it('emits per-check change events', async () => {
    const reg = new HealthRegistry();
    let aStatus: HealthCheckOutput['status'] = 'ok';
    reg.register(stubCheck('a', () => ({ status: aStatus })));
    reg.register(stubCheck('b', () => ({ status: 'ok' })));
    const daemon = new HealthDaemon(reg);

    const events: { name: string; to: unknown }[] = [];
    daemon.on('check_change', (e) => events.push({ name: e.name, to: e.to }));

    await daemon.tick(); // both new
    aStatus = 'warn';
    await daemon.tick(); // only a flips
    expect(events).toEqual([
      { name: 'a', to: 'ok' },
      { name: 'b', to: 'ok' },
      { name: 'a', to: 'warn' },
    ]);
  });

  it('serializes ticks (does not run in parallel)', async () => {
    const reg = new HealthRegistry();
    let inflight = 0;
    let maxInflight = 0;
    reg.register({
      name: 'slow',
      description: '',
      run: async () => {
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise((r) => setTimeout(r, 30));
        inflight--;
        return { status: 'ok' };
      },
    });
    const daemon = new HealthDaemon(reg);
    await Promise.all([daemon.tick(), daemon.tick(), daemon.tick()]);
    expect(maxInflight).toBe(1);
  });

  it("emits 'error' when the registry throws", async () => {
    const reg = new HealthRegistry();
    // Force registry.run to throw by overriding it.
    (reg as unknown as { run: () => Promise<never> }).run = async () => {
      throw new Error('registry exploded');
    };
    const daemon = new HealthDaemon(reg);
    const errors: unknown[] = [];
    daemon.on('error', (e) => errors.push(e));
    await daemon.tick();
    expect(errors.length).toBe(1);
  });

  it('start/stop is idempotent', () => {
    const daemon = new HealthDaemon(new HealthRegistry(), { intervalMs: 60_000 });
    daemon.start();
    daemon.start();
    daemon.stop();
    daemon.stop();
  });

  it('rejects intervalMs <= 0', () => {
    expect(() => new HealthDaemon(new HealthRegistry(), { intervalMs: 0 })).toThrow(RangeError);
  });

  it('reset() forgets prior state so the next tick re-emits all changes', async () => {
    const reg = new HealthRegistry();
    reg.register(stubCheck('a', () => ({ status: 'ok' })));
    const daemon = new HealthDaemon(reg);
    const events: unknown[] = [];
    daemon.on('check_change', (e) => events.push(e));
    await daemon.tick(); // 1 emit
    daemon.reset();
    await daemon.tick(); // 1 more (re-baseline)
    expect(events.length).toBe(2);
  });
});
