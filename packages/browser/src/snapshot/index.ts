// @openhipp0/browser/snapshot — page snapshot engine.

export { capturePageSnapshot } from './capture.js';
export { compareSnapshots } from './diff.js';
export { replaySnapshot, replayTrail } from './replay.js';
export { SnapshotStore, type SnapshotStoreOptions } from './store.js';
export {
  DEFAULT_RETENTION,
  SNAPSHOT_SCHEMA_VERSION,
  type CapturePageInput,
  type ConsoleEntry,
  type CookieEntry,
  type DiffEntry,
  type DiffKind,
  type DomPayload,
  type NetworkEntry,
  type ReplayOptions,
  type ReplayResult,
  type ReplayTarget,
  type RetentionPolicy,
  type ScreenshotPayload,
  type SessionId,
  type Snapshot,
  type SnapshotDiff,
  type SnapshotId,
} from './types.js';
