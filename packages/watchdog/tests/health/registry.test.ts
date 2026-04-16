import { describe, expect, it } from 'vitest';
import {
  type AutoFixResult,
  type HealthCheck,
  type HealthCheckOutput,
  HealthRegistry,
  Hipp0DuplicateCheckError,
} from '../../src/index.js';

/** Tiny helper: build a check that returns a fixed output. */
const fixed = (
  name: string,
  output: HealthCheckOutput,
  extras: Partial<HealthCheck> = {},
): HealthCheck => ({
  name,
  description: `${name} check`,
  ...extras,
  run: async () => output,
});

describe('HealthRegistry — registration', () => {
  it('register / has / list / size / unregister cycle works', () => {
    const reg = new HealthRegistry();
    const a = fixed('a', { status: 'ok' });
    expect(reg.size()).toBe(0);
    reg.register(a);
    expect(reg.size()).toBe(1);
    expect(reg.has('a')).toBe(true);
    expect(reg.list()).toEqual([a]);
    expect(reg.unregister('a')).toBe(true);
    expect(reg.unregister('a')).toBe(false);
    expect(reg.has('a')).toBe(false);
  });

  it('rejects duplicate names', () => {
    const reg = new HealthRegistry();
    reg.register(fixed('dup', { status: 'ok' }));
    expect(() => reg.register(fixed('dup', { status: 'ok' }))).toThrow(Hipp0DuplicateCheckError);
  });
});

describe('HealthRegistry — run aggregation', () => {
  it('returns an empty-but-valid report when no checks are registered', async () => {
    const report = await new HealthRegistry().run();
    expect(report.results).toEqual([]);
    expect(report.summary).toEqual({ ok: 0, warn: 0, fail: 0, skipped: 0 });
    expect(report.overall).toBe('ok');
    expect(report.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('aggregates statuses: any fail → fail; any warn (no fail) → warn; else ok', async () => {
    const reg = new HealthRegistry();
    reg.register(fixed('a', { status: 'ok' }));
    reg.register(fixed('b', { status: 'warn' }));
    reg.register(fixed('c', { status: 'fail' }));
    reg.register(fixed('d', { status: 'skipped' }));

    const r = await reg.run();
    expect(r.summary).toEqual({ ok: 1, warn: 1, fail: 1, skipped: 1 });
    expect(r.overall).toBe('fail');
    expect(r.results).toHaveLength(4);
    expect(r.results.map((x) => x.name).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it("overall is 'warn' when no fail but at least one warn", async () => {
    const reg = new HealthRegistry();
    reg.register(fixed('a', { status: 'ok' }));
    reg.register(fixed('b', { status: 'warn' }));
    expect((await reg.run()).overall).toBe('warn');
  });

  it('forwards check.category onto each result', async () => {
    const reg = new HealthRegistry();
    reg.register(fixed('a', { status: 'ok' }, { category: 'connectivity' }));
    const r = await reg.run();
    expect(r.results[0]!.category).toBe('connectivity');
  });

  it('coerces a thrown check into status=fail with the message preserved', async () => {
    const reg = new HealthRegistry();
    reg.register({
      name: 'boom',
      description: 'always throws',
      run: async () => {
        throw new Error('kaboom');
      },
    });
    const r = await reg.run();
    expect(r.results[0]!.status).toBe('fail');
    expect(r.results[0]!.message).toBe('kaboom');
    expect(r.overall).toBe('fail');
  });

  it('coerces non-Error throws into status=fail with stringified message', async () => {
    const reg = new HealthRegistry();
    reg.register({
      name: 'string-throw',
      description: '',
      run: async () => {
        throw 'bare string';
      },
    });
    const r = await reg.run();
    expect(r.results[0]!.status).toBe('fail');
    expect(r.results[0]!.message).toBe('bare string');
  });
});

describe('HealthRegistry — filtering', () => {
  it('only: restricts to listed names', async () => {
    const reg = new HealthRegistry();
    reg.register(fixed('a', { status: 'ok' }));
    reg.register(fixed('b', { status: 'fail' }));
    const r = await reg.run({ only: ['a'] });
    expect(r.results.map((x) => x.name)).toEqual(['a']);
    expect(r.overall).toBe('ok');
  });

  it('skip: excludes listed names', async () => {
    const reg = new HealthRegistry();
    reg.register(fixed('a', { status: 'ok' }));
    reg.register(fixed('b', { status: 'fail' }));
    const r = await reg.run({ skip: ['b'] });
    expect(r.results.map((x) => x.name)).toEqual(['a']);
  });
});

describe('HealthRegistry — timeout', () => {
  it('reports a slow check as fail with a timeout message', async () => {
    const reg = new HealthRegistry({ defaultTimeoutMs: 20 });
    reg.register({
      name: 'slow',
      description: '',
      run: () => new Promise((resolve) => setTimeout(() => resolve({ status: 'ok' }), 200)),
    });
    const r = await reg.run();
    expect(r.results[0]!.status).toBe('fail');
    expect(r.results[0]!.message).toMatch(/timed out after 20ms/);
  });

  it('per-check timeoutMs overrides the registry default', async () => {
    const reg = new HealthRegistry({ defaultTimeoutMs: 5 });
    reg.register({
      name: 'slow',
      description: '',
      timeoutMs: 200,
      run: () => new Promise((resolve) => setTimeout(() => resolve({ status: 'ok' }), 30)),
    });
    const r = await reg.run();
    expect(r.results[0]!.status).toBe('ok');
  });
});

describe('HealthRegistry — autoFix', () => {
  it('does not call autoFix when run returned ok', async () => {
    const reg = new HealthRegistry();
    let called = false;
    reg.register({
      name: 'a',
      description: '',
      run: async () => ({ status: 'ok' }),
      autoFix: async () => {
        called = true;
        return { attempted: true, succeeded: true, description: 'noop' };
      },
    });
    await reg.run({ autoFix: true });
    expect(called).toBe(false);
  });

  it('does not call autoFix when the option is omitted', async () => {
    const reg = new HealthRegistry();
    let called = false;
    reg.register({
      name: 'a',
      description: '',
      run: async () => ({ status: 'fail' }),
      autoFix: async () => {
        called = true;
        return { attempted: true, succeeded: true, description: 'noop' };
      },
    });
    await reg.run(); // autoFix defaults to false
    expect(called).toBe(false);
  });

  it('calls autoFix on non-ok checks and attaches the AutoFixResult', async () => {
    const reg = new HealthRegistry();
    const fixResult: AutoFixResult = {
      attempted: true,
      succeeded: true,
      description: 'reconnected',
    };
    reg.register({
      name: 'flaky',
      description: '',
      run: async () => ({ status: 'fail', message: 'down' }),
      autoFix: async (last) => {
        expect(last.status).toBe('fail');
        return fixResult;
      },
    });
    const r = await reg.run({ autoFix: true });
    expect(r.results[0]!.autoFix).toEqual(fixResult);
  });

  it('captures autoFix throws as a failed AutoFixResult instead of bubbling', async () => {
    const reg = new HealthRegistry();
    reg.register({
      name: 'flaky',
      description: '',
      run: async () => ({ status: 'fail' }),
      autoFix: async () => {
        throw new Error('fix-failed');
      },
    });
    const r = await reg.run({ autoFix: true });
    expect(r.results[0]!.autoFix?.attempted).toBe(true);
    expect(r.results[0]!.autoFix?.succeeded).toBe(false);
    expect(r.results[0]!.autoFix?.description).toMatch(/fix-failed/);
  });

  it('skips autoFix for checks that did not register one', async () => {
    const reg = new HealthRegistry();
    reg.register(fixed('a', { status: 'fail' }));
    const r = await reg.run({ autoFix: true });
    expect(r.results[0]!.autoFix).toBeUndefined();
  });
});

describe('HealthRegistry — concurrency', () => {
  it('runs checks in parallel, not sequentially', async () => {
    const reg = new HealthRegistry();
    const delay = 60;
    for (const n of ['a', 'b', 'c']) {
      reg.register({
        name: n,
        description: '',
        run: () => new Promise((resolve) => setTimeout(() => resolve({ status: 'ok' }), delay)),
      });
    }
    const start = Date.now();
    await reg.run();
    const elapsed = Date.now() - start;
    // Sequential would be ~180ms; parallel should be ~60ms (+ scheduling slop).
    expect(elapsed).toBeLessThan(150);
  });
});
