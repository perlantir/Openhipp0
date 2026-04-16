/**
 * End-to-end integration: wire the Phase 4 components into the shape a real
 * deployment would use, then exercise the failure modes.
 *
 *   Watchdog (heap + GC + crash-loop) → HealthDaemon (registry of checks) →
 *   BreakerRegistry → ErrorSpikeDetector → AutoPatchRegistry
 *
 * The point of this test is not exhaustive coverage of each component (that's
 * in the unit tests); it's verifying the components compose cleanly without
 * surprising coupling.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AutoPatchRegistry,
  BreakerRegistry,
  CircuitBreaker,
  ConfigCheck,
  DatabaseCheck,
  ErrorSpikeDetector,
  HealthDaemon,
  HealthRegistry,
  OomTrendPredictor,
  Watchdog,
  type HeapSample,
} from '../../src/index.js';

const fixedSample = (fraction: number, takenAt = 0): HeapSample => ({
  usedBytes: Math.round(fraction * 1_000_000),
  limitBytes: 1_000_000,
  fraction,
  takenAt,
});

describe('Phase 4 end-to-end wiring', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hipp0-e2e-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('Watchdog forwards heap pressure → HealthDaemon picks up DB check change → AutoPatch runs reconnect', async () => {
    // 1) Watchdog
    const wd = new Watchdog(
      { snapshotPath: path.join(dir, 'snap.json'), heap: { intervalMs: 60_000 } },
      { heapSource: () => fixedSample(0.72) },
    );
    const memoryEvents: string[] = [];
    wd.on('memory_pressure', (e) => memoryEvents.push(e.level));
    wd.heap.tick();
    expect(memoryEvents).toEqual(['warn']);

    // 2) Health registry + daemon — DB ping starts failing.
    let dbHealthy = true;
    const reg = new HealthRegistry();
    reg.register(
      new ConfigCheck({
        configPath: await writeConfig(path.join(dir, 'cfg.json'), { name: 'x' }),
      }),
    );
    reg.register(
      new DatabaseCheck({
        ping: async () => {
          if (!dbHealthy) throw new Error('connection refused');
        },
      }),
    );
    const daemon = new HealthDaemon(reg);
    const checkChanges: { name: string; to: string }[] = [];
    daemon.on('check_change', (e) => checkChanges.push({ name: e.name, to: e.to }));

    await daemon.tick();
    expect(checkChanges).toEqual([
      { name: 'config', to: 'ok' },
      { name: 'database', to: 'ok' },
    ]);

    // 3) Force the DB ping to fail; daemon picks up the change.
    dbHealthy = false;
    await daemon.tick();
    expect(checkChanges).toContainEqual({ name: 'database', to: 'fail' });

    // 4) AutoPatch hooked to "database failed" signal — the patch reconnects.
    const patches = new AutoPatchRegistry();
    patches.register({
      id: 'reconnect-db',
      description: 'Heal DB connection',
      matches: (s) => s.source === 'health.database' && s.payload === 'fail',
      apply: async () => {
        dbHealthy = true;
      },
    });
    const events = await patches.handle({ source: 'health.database', payload: 'fail' });
    expect(events.length).toBe(1);
    expect(events[0]!.ok).toBe(true);

    await daemon.tick();
    expect(checkChanges.at(-1)).toEqual({ name: 'database', to: 'ok' });
  });

  it('BreakerRegistry + ErrorSpikeDetector + OomTrendPredictor compose cleanly', () => {
    let now = 0;
    const breakers = new BreakerRegistry();
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeMs: 1000 }, () => now);
    breakers.register({ name: 'anthropic', subsystem: 'llm', breaker });

    const spike = new ErrorSpikeDetector(
      { windowMs: 1000, minRecords: 4, threshold: 0.75 },
      () => now,
    );
    const oom = new OomTrendPredictor(
      { windowMs: 1_000_000, horizonMs: 1_000_000, minSamples: 3 },
      () => now,
    );

    const opened: string[] = [];
    const spikes: number[] = [];
    const ooms: number[] = [];
    breakers.on('opened', (e) => opened.push(e.name));
    spike.on('error_spike', (e) => spikes.push(e.fraction));
    oom.on('oom_predicted', (e) => ooms.push(e.inMs));

    // Five LLM calls — all fail. Breaker opens; spike detector trips.
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
      spike.record(false);
    }
    breakers.poll(() => now);
    expect(opened).toEqual(['anthropic']);
    expect(spikes.length).toBeGreaterThanOrEqual(1);

    // Heap climbing — predictor fires.
    for (let i = 0; i < 4; i++) {
      now = i * 100;
      oom.feed(fixedSample(0.5 + i * 0.1, now));
    }
    expect(ooms.length).toBeGreaterThanOrEqual(1);
  });
});

async function writeConfig(pth: string, body: object): Promise<string> {
  await fs.mkdir(path.dirname(pth), { recursive: true });
  await fs.writeFile(pth, JSON.stringify(body), 'utf8');
  return pth;
}
