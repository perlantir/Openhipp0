import { describe, expect, it } from 'vitest';
import { DatabaseCheck } from '../../../src/index.js';

describe('DatabaseCheck', () => {
  it('returns ok when the ping resolves and reports a latency', async () => {
    const check = new DatabaseCheck({ ping: async () => {} });
    const result = await check.run();
    expect(result.status).toBe('ok');
    expect(typeof result.details?.['latencyMs']).toBe('number');
  });

  it('accepts a synchronous ping function', async () => {
    const check = new DatabaseCheck({ ping: () => undefined });
    expect((await check.run()).status).toBe('ok');
  });

  it('returns fail when the ping throws (async)', async () => {
    const check = new DatabaseCheck({
      ping: async () => {
        throw new Error('connection refused');
      },
    });
    const result = await check.run();
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/connection refused/);
    expect(typeof result.details?.['latencyMs']).toBe('number');
  });

  it('returns fail when the ping throws (sync)', async () => {
    const check = new DatabaseCheck({
      ping: () => {
        throw new Error('sync fail');
      },
    });
    expect((await check.run()).status).toBe('fail');
  });

  it('coerces a non-Error throw to a string message', async () => {
    const check = new DatabaseCheck({
      ping: async () => {
        throw 'string-error';
      },
    });
    expect((await check.run()).message).toMatch(/string-error/);
  });

  it('honors a custom name and description', () => {
    const check = new DatabaseCheck({
      ping: async () => {},
      name: 'pg',
      description: 'Postgres reachable',
    });
    expect(check.name).toBe('pg');
    expect(check.description).toBe('Postgres reachable');
  });

  it('reports latencyMs as a non-negative integer-ish number', async () => {
    const check = new DatabaseCheck({
      ping: () => new Promise((resolve) => setTimeout(resolve, 5)),
    });
    const result = await check.run();
    expect(result.details?.['latencyMs']).toBeGreaterThanOrEqual(0);
  });
});
