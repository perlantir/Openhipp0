import { describe, expect, it } from 'vitest';
import { BridgesCheck, type BridgeProbe } from '../../../src/index.js';

const probe = (name: string, connected: boolean): BridgeProbe => ({
  name,
  isConnected: () => connected,
});

describe('BridgesCheck', () => {
  it('warns when no bridges are configured (default)', async () => {
    const result = await new BridgesCheck({ bridges: [] }).run();
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/No bridges/);
  });

  it("returns 'skipped' when no bridges are configured and treatEmptyAsSkipped is true", async () => {
    const result = await new BridgesCheck({
      bridges: [],
      treatEmptyAsSkipped: true,
    }).run();
    expect(result.status).toBe('skipped');
  });

  it('returns ok when all bridges are connected', async () => {
    const result = await new BridgesCheck({
      bridges: [probe('discord', true), probe('telegram', true)],
    }).run();
    expect(result.status).toBe('ok');
    const bridges = result.details?.['bridges'] as Array<{ name: string; connected: boolean }>;
    expect(bridges.every((b) => b.connected)).toBe(true);
  });

  it('warns when at least one (but not all) bridges are disconnected', async () => {
    const result = await new BridgesCheck({
      bridges: [probe('discord', true), probe('telegram', false)],
    }).run();
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/1\/2/);
  });

  it('fails when ALL bridges are disconnected', async () => {
    const result = await new BridgesCheck({
      bridges: [probe('discord', false), probe('slack', false)],
    }).run();
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/2\/2/);
  });

  it('honors a custom name', () => {
    expect(new BridgesCheck({ bridges: [], name: 'platform-bridges' }).name).toBe(
      'platform-bridges',
    );
  });

  it('reports each bridge state in details', async () => {
    const result = await new BridgesCheck({
      bridges: [probe('a', true), probe('b', false)],
    }).run();
    expect(result.details?.['bridges']).toEqual([
      { name: 'a', connected: true },
      { name: 'b', connected: false },
    ]);
  });
});
