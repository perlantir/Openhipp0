import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Watchdog, type HeapSample } from '../src/index.js';

const fixedSample = (fraction: number): HeapSample => ({
  usedBytes: Math.round(fraction * 1_000_000),
  limitBytes: 1_000_000,
  fraction,
  takenAt: 0,
});

/**
 * Resolves on the next `pre_shutdown` event — emitted by the watchdog at the
 * tail of an async tripSafeMode (after the snapshot save has settled). Tests
 * that drive auto-trips (heap fatal / crash loop) await this so the temp-dir
 * cleanup doesn't race the in-flight snapshot write.
 */
const nextPreShutdown = (wd: Watchdog): Promise<void> =>
  new Promise((resolve) => wd.once('pre_shutdown', () => resolve()));

describe('Watchdog', () => {
  let dir: string;
  let snapshotPath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hipp0-watchdog-'));
    snapshotPath = path.join(dir, 'snapshot.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('forwards memory_pressure and trips safe mode synchronously on heap fatal', async () => {
    const wd = new Watchdog(
      { snapshotPath, heap: { intervalMs: 60_000 } },
      { heapSource: () => fixedSample(0.97) },
    );
    const events: string[] = [];
    wd.on('memory_pressure', (e) => events.push(`mem:${e.level}`));
    wd.on('safe_mode_entered', (e) => events.push(`safe:${e.reason}`));
    const settled = nextPreShutdown(wd);

    wd.heap.tick();
    expect(events).toEqual(['mem:fatal', 'safe:heap_fatal']);
    expect(wd.isInSafeMode()).toBe(true);
    await settled;
  });

  it('persists the snapshot provider output and emits pre_shutdown on tripSafeMode', async () => {
    const wd = new Watchdog({ snapshotPath }, {}, () => ({
      sessionsActive: 7,
      recentDecisionIds: ['d-42'],
      custom: { source: 'test' },
    }));
    const events: string[] = [];
    wd.on('snapshot_saved', () => events.push('saved'));
    wd.on('pre_shutdown', (e) => events.push(`shutdown:${e.reason}`));

    await wd.tripSafeMode('manual');

    expect(events).toEqual(['saved', 'shutdown:manual']);

    const raw = await fs.readFile(snapshotPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.sessionsActive).toBe(7);
    expect(parsed.recentDecisionIds).toEqual(['d-42']);
    expect(parsed.custom).toEqual({ source: 'test' });
    expect(typeof parsed.lastSafeModeAt).toBe('string');
  });

  it('forwards crash_loop and trips safe mode', async () => {
    const wd = new Watchdog({ snapshotPath, crashLoop: { threshold: 2, windowMs: 1000 } }, {});
    const reasons: string[] = [];
    wd.on('safe_mode_entered', (e) => reasons.push(e.reason));
    const settled = nextPreShutdown(wd);

    wd.crashLoop.record('exception', new Error('x'));
    wd.crashLoop.record('exception', new Error('y'));
    expect(reasons).toEqual(['crash_loop']);
    await settled;
  });

  it('emits snapshot_save_failed when the snapshot path is unwritable', async () => {
    const badPath = path.join(dir, 'snap.json', 'inside-a-file', 'snap.json');
    await fs.writeFile(path.join(dir, 'snap.json'), 'block', 'utf8');
    const wd = new Watchdog({ snapshotPath: badPath });
    const failures: unknown[] = [];
    wd.on('snapshot_save_failed', (e) => failures.push(e));

    await wd.tripSafeMode('test');

    expect(failures.length).toBe(1);
    expect(wd.isInSafeMode()).toBe(true);
  });

  it('tripSafeMode is idempotent', async () => {
    const wd = new Watchdog({ snapshotPath });
    let trips = 0;
    wd.on('safe_mode_entered', () => trips++);

    await wd.tripSafeMode('first');
    await wd.tripSafeMode('second');
    expect(trips).toBe(1);
  });

  it('resetSafeMode clears state and re-arms the crash-loop detector', async () => {
    const wd = new Watchdog({ snapshotPath, crashLoop: { threshold: 2, windowMs: 1000 } }, {});
    let trips = 0;
    wd.on('safe_mode_entered', () => trips++);

    let settled = nextPreShutdown(wd);
    wd.crashLoop.record('exception', new Error('a'));
    wd.crashLoop.record('exception', new Error('b'));
    expect(trips).toBe(1);
    await settled;

    wd.resetSafeMode();
    expect(wd.isInSafeMode()).toBe(false);

    settled = nextPreShutdown(wd);
    wd.crashLoop.record('exception', new Error('c'));
    wd.crashLoop.record('exception', new Error('d'));
    expect(trips).toBe(2);
    await settled;
  });

  it('start/stop are idempotent and clean up process listeners', () => {
    const before = process.listenerCount('uncaughtException');
    const wd = new Watchdog({ snapshotPath, heap: { intervalMs: 60_000 } });
    wd.start();
    wd.start();
    expect(process.listenerCount('uncaughtException')).toBe(before + 1);
    wd.stop();
    wd.stop();
    expect(process.listenerCount('uncaughtException')).toBe(before);
  });
});
