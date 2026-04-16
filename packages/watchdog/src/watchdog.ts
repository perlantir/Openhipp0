/**
 * Top-level Watchdog — composes HeapMonitor, GcThrashDetector, CrashLoopDetector,
 * and StateSnapshotStore into one event bus.
 *
 * Phase 4 design: in-process. Watchdog NEVER calls process.exit. On a safe-mode
 * trip it persists a snapshot and emits 'pre_shutdown' so an outer manager
 * (Phase 7+ CLI / systemd / Docker) can decide whether to actually restart.
 *
 * Safe mode trips on:
 *   - heap fatal pressure (≥ thresholds.fatal)
 *   - crash loop (≥ threshold uncaught events in window)
 *   - explicit tripSafeMode() call
 *
 * Subevents are forwarded as-is on the watchdog bus so consumers can subscribe
 * once instead of wiring three sources.
 */

import { EventEmitter } from 'node:events';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { CrashLoopDetector } from './crash-loop.js';
import { GcThrashDetector } from './gc-thrash.js';
import { HeapMonitor } from './heap-monitor.js';
import { StateSnapshotStore, type SnapshotInput } from './state-snapshot.js';
import type { HeapSource, WatchdogConfig, WatchdogEvents } from './types.js';

export interface WatchdogDeps {
  /** Heap source for the embedded HeapMonitor. */
  heapSource?: HeapSource;
  /** Clock for the embedded GcThrashDetector + CrashLoopDetector. */
  now?: () => number;
}

/**
 * Provider invoked at safe-mode trip to gather state to persist. Kept as a
 * callback (not constructor data) because callers typically want to capture
 * live state (active session count, recent decision ids, etc.) at the moment
 * of trip — not whatever was true at watchdog construction.
 */
export type SnapshotProvider = () => SnapshotInput;

const DEFAULT_SNAPSHOT_PATH = nodePath.join(os.homedir(), '.hipp0', 'watchdog', 'snapshot.json');

export class Watchdog extends EventEmitter {
  readonly heap: HeapMonitor;
  readonly gc: GcThrashDetector;
  readonly crashLoop: CrashLoopDetector;
  readonly snapshots: StateSnapshotStore;

  private readonly snapshotProvider: SnapshotProvider;
  private safeMode = false;
  private started = false;

  constructor(
    config: WatchdogConfig = {},
    deps: WatchdogDeps = {},
    snapshotProvider: SnapshotProvider = () => ({}),
  ) {
    super();
    this.heap = new HeapMonitor(config.heap, deps.heapSource);
    this.gc = new GcThrashDetector(config.gc, deps.now);
    this.crashLoop = new CrashLoopDetector(config.crashLoop, deps.now);
    this.snapshots = new StateSnapshotStore(config.snapshotPath ?? DEFAULT_SNAPSHOT_PATH);
    this.snapshotProvider = snapshotProvider;
    this.wireSubevents();
  }

  start(): void {
    if (this.started) return;
    this.heap.start();
    this.gc.start();
    this.crashLoop.start();
    this.started = true;
  }

  stop(): void {
    if (!this.started) return;
    this.heap.stop();
    this.gc.stop();
    this.crashLoop.stop();
    this.started = false;
  }

  isInSafeMode(): boolean {
    return this.safeMode;
  }

  /**
   * Trip safe mode. Idempotent. Persists a snapshot then emits 'pre_shutdown'.
   * Callers may await this to ensure the snapshot has been written.
   */
  async tripSafeMode(reason: string): Promise<void> {
    if (this.safeMode) return;
    this.safeMode = true;
    const at = Date.now();
    this.emit('safe_mode_entered', { reason, at });
    const snapshotPath = this.snapshots.path;
    try {
      const provided = this.snapshotProvider();
      await this.snapshots.save({
        ...provided,
        lastSafeModeAt: new Date(at).toISOString(),
      });
      this.emit('snapshot_saved', { path: snapshotPath, at: Date.now() });
    } catch (err) {
      this.emit('snapshot_save_failed', { path: snapshotPath, error: err });
    }
    this.emit('pre_shutdown', { reason, at: Date.now() });
  }

  /** Reset safe mode + crash-loop history (e.g. after manual recovery). */
  resetSafeMode(): void {
    this.safeMode = false;
    this.crashLoop.reset();
  }

  private wireSubevents(): void {
    this.heap.on('memory_pressure', (payload: WatchdogEvents['memory_pressure']) => {
      this.emit('memory_pressure', payload);
      if (payload.level === 'fatal' && !this.safeMode) {
        void this.tripSafeMode('heap_fatal');
      }
    });
    this.gc.on('gc_thrashing', (payload: WatchdogEvents['gc_thrashing']) => {
      this.emit('gc_thrashing', payload);
    });
    this.crashLoop.on('uncaught_exception', (payload: WatchdogEvents['uncaught_exception']) => {
      this.emit('uncaught_exception', payload);
    });
    this.crashLoop.on('crash_loop', (payload: WatchdogEvents['crash_loop']) => {
      this.emit('crash_loop', payload);
      if (!this.safeMode) {
        void this.tripSafeMode('crash_loop');
      }
    });
  }
}
