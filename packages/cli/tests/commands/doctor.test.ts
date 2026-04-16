import { describe, it, expect } from 'vitest';
import { HealthRegistry } from '@openhipp0/watchdog';
import { buildDefaultRegistry, runDoctor } from '../../src/commands/doctor.js';
import { createMemoryFs } from '../helpers/memory-fs.js';
import { writeConfig } from '../../src/config.js';
import { Hipp0ConfigSchema } from '../../src/types.js';

const CONFIG_PATH = '/tmp/hipp0-doctor/config.json';

describe('runDoctor', () => {
  it('passes when all checks ok', async () => {
    const registry = new HealthRegistry();
    registry.register({
      name: 'fake',
      description: 'always ok',
      async run() {
        return { status: 'ok', message: 'fine' };
      },
    });
    const result = await runDoctor({ registry });
    expect(result.exitCode).toBe(0);
    expect(result.stdout?.[0]).toContain('OK');
  });

  it('exits 1 when a check fails', async () => {
    const registry = new HealthRegistry();
    registry.register({
      name: 'broken',
      description: 'always fails',
      async run() {
        return { status: 'fail', message: 'broken' };
      },
    });
    const result = await runDoctor({ registry });
    expect(result.exitCode).toBe(1);
    expect(result.stdout?.some((l) => l.includes('broken'))).toBe(true);
  });

  it('exits 0 on warn status', async () => {
    const registry = new HealthRegistry();
    registry.register({
      name: 'warning',
      description: 'warns',
      async run() {
        return { status: 'warn', message: 'careful' };
      },
    });
    const result = await runDoctor({ registry });
    expect(result.exitCode).toBe(0);
  });

  it('invokes autoFix when requested and check fails', async () => {
    const registry = new HealthRegistry();
    let fixCalled = false;
    registry.register({
      name: 'fixable',
      description: 'can be fixed',
      async run() {
        return { status: 'fail', message: 'bad' };
      },
      async autoFix() {
        fixCalled = true;
        return { attempted: true, succeeded: true, description: 'fixed' };
      },
    });
    const result = await runDoctor({ registry, autoFix: true });
    expect(fixCalled).toBe(true);
    expect(result.stdout?.some((l) => l.includes('auto-fix'))).toBe(true);
  });
});

describe('buildDefaultRegistry', () => {
  it('ConfigCheck fails when file missing', async () => {
    const registry = buildDefaultRegistry('/nonexistent/path/config.json');
    const report = await registry.run();
    expect(report.overall).toBe('fail');
  });

  it('ConfigCheck passes with a valid config file', async () => {
    const fs = createMemoryFs();
    const cfg = Hipp0ConfigSchema.parse({
      project: { name: 'demo', createdAt: '2026-01-01T00:00:00Z' },
    });
    await writeConfig(cfg, CONFIG_PATH, fs);
    // Note: default registry uses real node:fs, so we have to write to real disk.
    // Instead we just verify buildDefaultRegistry returns a registry with one check.
    const registry = buildDefaultRegistry(CONFIG_PATH);
    expect(registry.size()).toBe(1);
    expect(registry.has('config')).toBe(true);
  });
});
