// @openhipp0/watchdog — Self-healing engine: process watchdog, health checks,
// safe updates, predictive issue detection.
//
// Phase 4a — Process Watchdog (this commit):
//   - HeapMonitor:        V8 heap usage sampler with warn/critical/fatal levels
//   - GcThrashDetector:   GC time / window-time fraction monitor
//   - CrashLoopDetector:  uncaught exception/rejection sliding-window counter
//   - StateSnapshotStore: atomic, public-schema snapshot for restart continuity
//   - Watchdog:           composer wiring all of the above into one event bus
//
// Later sub-phases (4b/4c/4d/4e) ship health system, safe updates, predictive
// detection, and integration wiring.

export const packageName = '@openhipp0/watchdog' as const;
export const version = '0.0.0' as const;

export * from './types.js';
export { HeapMonitor, defaultHeapSource } from './heap-monitor.js';
export { GcThrashDetector } from './gc-thrash.js';
export { CrashLoopDetector } from './crash-loop.js';
export { StateSnapshotStore } from './state-snapshot.js';
export type { SnapshotInput } from './state-snapshot.js';
export { Watchdog } from './watchdog.js';
export type { SnapshotProvider, WatchdogDeps } from './watchdog.js';
