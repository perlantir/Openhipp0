// @openhipp0/browser — higher-level browser automation.
//
// G1-a ships profile management. Snapshots, workflows, multi-tab,
// site memory, network inspector land in G1-b…G1-e.

export {
  Hipp0BrowserError,
  Hipp0BrowserImportLimitationNotAckedError,
  Hipp0BrowserNonInteractiveError,
  Hipp0BrowserProfileBusyError,
  Hipp0BrowserProfileCorruptError,
  Hipp0BrowserProfileNotFoundError,
  Hipp0BrowserUncleanShutdownError,
} from './errors.js';

export {
  MIGRATIONS,
  PROFILE_EXPORT_ENVELOPE_VERSION,
  PROFILE_MANIFEST_VERSION,
  type AesGcmCipher,
  type LockStaleness,
  type ManifestMigration,
  type OpenedProfile,
  type OrphanReport,
  type Profile,
  type ProfileBusyDiagnostic,
  type ProfileExportEnvelope,
  type ProfileId,
  type ProfileLockFile,
  type ProfileManifest,
  type ProfileStatus,
  type ScrubReport,
  type ScryptKdfParams,
} from './profiles/types.js';

export { packDir, unpackDir, type PackedArchive, type PackedFile } from './profiles/archive.js';

export {
  DEFAULT_SCRYPT_N,
  DEFAULT_SCRYPT_P,
  DEFAULT_SCRYPT_R,
  decryptBlob,
  defaultKdfParams,
  deriveKey,
  encryptBlob,
  newIv,
  newSalt,
} from './profiles/crypto.js';

export {
  defaultProfilesDir,
  systemChromeUserDataDir,
  tmpfsCandidate,
  type Platform,
} from './profiles/paths.js';

export {
  newManifest,
  ProfileStore,
  type OpenHandle,
  type ProfileStoreOptions,
} from './profiles/profile-store.js';

export {
  closeSession,
  launchForProfile,
  type LauncherOptions,
  type LaunchedSession,
} from './profiles/profile-launcher.js';

export {
  createProfileManager,
  ProfileManager,
  type CreateOptions,
  type OpenedProfileHandle,
  type PassphraseProvider,
  type ProfileManagerOptions,
} from './profiles/profile-manager.js';

export {
  asProfileId,
  cookieLimitationWarning,
  importFromChrome,
  type ImportOptions,
} from './profiles/profile-import.js';

export {
  envelopeSanity,
  exportProfile,
  importBundle,
  type ExportOptions,
  type ExportResult,
  type ImportBundleOptions,
} from './profiles/profile-export.js';

// G1-c: I/O + forms
export {
  DownloadManager,
  resolveUploadSource,
  stageSourceToDisk,
  UploadHandler,
  type BrowserDownload,
  type CloudStorageAdapter,
  type DownloadCompletedEvent,
  type DownloadEvents,
  type DownloadFailedEvent,
  type DownloadManagerListener,
  type DownloadManagerOptions,
  type DownloadStartedEvent,
  type PageWithFileInputs,
  type ResolvedSourceFile,
  type UploadHandlerDeps,
  type UploadOptions,
  type UploadProgress,
  type UploadProgressListener,
  type UploadResult,
  type UploadSource,
  type VirusScanHook,
  type VirusScanResult,
} from './io/index.js';

export {
  applyKindOverrides,
  classifyValidationMessage,
  collectValidationErrors,
  detectForms,
  DraftStore,
  inferFieldKind,
  PatternStore,
  type AxNode as FormAxNode,
  type DetectOptions,
  type DomAccessor,
  type DraftStoreOptions,
  type FormDraft,
  type FormPattern,
  type InferenceInput,
  type InferenceResult,
  type InferredField,
  type InferredFieldKind,
  type InferredForm,
  type InferredFormStep,
  type PatternStoreOptions,
  type SuggestionContext,
  type ValidationError,
  type ValidationProbe,
} from './forms/index.js';

// G1-e: stealth + vision + site memory + devtools
export {
  buildInitScript,
  DEFAULT_CHROME_LINUX,
  DEFAULT_CHROME_MAC,
  DEFAULT_CHROME_WIN,
  estimateEntropy,
  humanMouseCurve,
  humanScrollProfile,
  createStealthChromium,
  ProxyRotator,
  readingPauseMs,
  seedOf,
  stealthDoctor,
  type FingerprintDescriptor,
  type FingerprintEntropyEstimate,
  type MouseCurvePoint,
  type NextContext,
  type ProxyEntry,
  type ProxyRotationStrategy,
  type ProxyRotatorState,
  type ReadingPauseInput,
  type StealthContext,
  type StealthLaunchOptions,
  type StealthModuleDeps,
} from './stealth/index.js';

export {
  ElementLocator,
  ScreenReasoner,
  type LocateOptions,
  type LocateResult,
  type VisionClient,
} from './vision/index.js';

export {
  SiteMemory,
  type SiteMemoryEvent,
  type SiteMemoryListener,
  type SiteMemoryOptions,
  type SiteMemoryQuery,
  type SiteNote,
} from './memory/index.js';

export {
  createPageStorageInspector,
  NetworkInspector,
  type ApiEndpoint,
  type InspectedRequest,
  type NetworkRequest,
  type NetworkResponse,
  type StorageInspector,
  type StorageSnapshot,
} from './devtools/index.js';

// G1-f: streaming narrator (interface; G2 wires transport)
export {
  BufferSink,
  EmitterSink,
  Narrator,
  type NarrationEvent,
  type NarrationEventKind,
  type NarratorSink,
} from './streaming/index.js';

// G1-d: workflows + multi-tab
export {
  playWorkflow,
  Recorder,
  substituteParameters,
  WORKFLOW_SCHEMA_VERSION,
  WorkflowStore,
  type HealingContext,
  type ParameterValues,
  type PlayOptions,
  type PlayResult,
  type RecordedStep,
  type RecorderOptions,
  type SelectorHealer,
  type StepKind,
  type Workflow,
  type WorkflowParameter,
  type WorkflowStoreOptions,
} from './workflow/index.js';

export {
  CrossTabState,
  MultiTabOrchestrator,
  type OrchestratorOptions,
  type OrchestratorResult,
  type StateValue,
  type StateWatcher,
  type TabResult,
  type TabSpec,
} from './multi-tab/index.js';

// G1-b: snapshots
export {
  capturePageSnapshot,
  compareSnapshots,
  DEFAULT_RETENTION,
  replaySnapshot,
  replayTrail,
  SNAPSHOT_SCHEMA_VERSION,
  SnapshotStore,
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
  type SnapshotStoreOptions,
} from './snapshot/index.js';
