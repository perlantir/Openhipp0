import { describe, expect, it } from 'vitest';
import { PortsCheck, type PortProbe } from '../../../src/index.js';

const stubProbe =
  (boundSet: Set<number>): PortProbe =>
  async (port) =>
    boundSet.has(port);

describe('PortsCheck', () => {
  it('skipped when no ports configured', async () => {
    const r = await new PortsCheck({ ports: [], probe: async () => false }).run();
    expect(r.status).toBe('skipped');
  });

  it('ok when all expectations match', async () => {
    const probe = stubProbe(new Set([3000]));
    const r = await new PortsCheck({
      ports: [
        { port: 3000, expect: 'bound', label: 'dashboard' },
        { port: 9999, expect: 'free' },
      ],
      probe,
    }).run();
    expect(r.status).toBe('ok');
  });

  it('warn when partial mismatch', async () => {
    const probe = stubProbe(new Set([3000]));
    const r = await new PortsCheck({
      ports: [
        { port: 3000, expect: 'bound' },
        { port: 4000, expect: 'bound' }, // expected bound but free
      ],
      probe,
    }).run();
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/1\/2/);
  });

  it('fail when all expectations violated', async () => {
    const probe = stubProbe(new Set());
    const r = await new PortsCheck({
      ports: [
        { port: 3000, expect: 'bound' },
        { port: 4000, expect: 'bound' },
      ],
      probe,
    }).run();
    expect(r.status).toBe('fail');
  });

  it('reports per-port detail with expect/actual', async () => {
    const probe = stubProbe(new Set([3000]));
    const r = await new PortsCheck({
      ports: [{ port: 3000, expect: 'bound' }],
      probe,
    }).run();
    const ports = r.details?.['ports'] as Array<{ expect: string; actual: string; ok: boolean }>;
    expect(ports[0]).toEqual(
      expect.objectContaining({ expect: 'bound', actual: 'bound', ok: true }),
    );
  });

  it('uses 127.0.0.1 as default host', async () => {
    let seenHost = '';
    const probe: PortProbe = async (_p, host) => {
      seenHost = host;
      return false;
    };
    await new PortsCheck({ ports: [{ port: 1234, expect: 'free' }], probe }).run();
    expect(seenHost).toBe('127.0.0.1');
  });
});
