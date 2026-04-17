/**
 * Upload + download contracts. Cloud-storage sources are structural — callers
 * supply the real SDK (S3, Drive, Dropbox) and this package stays
 * dependency-light. G1-a set the pattern for `CredentialVault` + profile
 * stores; we follow it here.
 */

export type UploadSource =
  | { readonly kind: 'local'; readonly path: string }
  | { readonly kind: 'url'; readonly url: string; readonly headers?: Readonly<Record<string, string>> }
  | { readonly kind: 'buffer'; readonly name: string; readonly mimeType?: string; readonly data: Buffer }
  | { readonly kind: 's3'; readonly bucket: string; readonly key: string; readonly region?: string }
  | { readonly kind: 'drive'; readonly fileId: string }
  | { readonly kind: 'dropbox'; readonly pathLower: string };

export interface UploadProgress {
  readonly source: UploadSource;
  readonly bytesSent: number;
  readonly bytesTotal: number | null;
  readonly phase: 'staging' | 'uploading' | 'done' | 'failed';
  readonly error?: string;
}

export type UploadProgressListener = (event: UploadProgress) => void;

export interface UploadOptions {
  /** Input element / file-picker ref (Playwright selector). */
  readonly targetSelector: string;
  /** When set, simulates drag-drop by dispatching DataTransfer events. */
  readonly dropTargetSelector?: string;
  /** Progress hook (best-effort). */
  readonly onProgress?: UploadProgressListener;
  /** Auto-resume on transient failure (default 2 attempts). */
  readonly resumeAttempts?: number;
}

/** Adapter a caller supplies for non-local sources. */
export interface CloudStorageAdapter {
  /** Fetch bytes for an `UploadSource` whose `kind` matches `supports()`. */
  supports(source: UploadSource): boolean;
  fetch(source: UploadSource, onProgress?: UploadProgressListener): Promise<Buffer>;
}

export interface UploadResult {
  readonly source: UploadSource;
  readonly bytesSent: number;
  readonly attempts: number;
  readonly ok: boolean;
  readonly error?: string;
}

// ─── Downloads ──────────────────────────────────────────────────────────────

export interface DownloadStartedEvent {
  readonly id: string;
  readonly suggestedFilename: string;
  readonly url: string;
  readonly startedAt: string; // ISO
}

export interface DownloadCompletedEvent {
  readonly id: string;
  readonly filePath: string;
  readonly bytes: number;
  readonly durationMs: number;
  readonly virusScan?: VirusScanResult;
}

export interface DownloadFailedEvent {
  readonly id: string;
  readonly error: string;
}

export interface VirusScanResult {
  readonly ok: boolean;
  readonly scannedAt: string;
  readonly detector?: string;
  readonly details?: string;
}

export type VirusScanHook = (filePath: string) => Promise<VirusScanResult>;

export interface DownloadManagerOptions {
  /** Where to route completed downloads. Default `~/.hipp0/downloads`. */
  readonly workspaceDir?: string;
  /** Optional scanner hook. Called post-download before the event is fired. */
  readonly virusScan?: VirusScanHook;
  /** Filename override (default: preserve suggestedFilename, prefix with timestamp). */
  readonly filenameOf?: (ev: DownloadStartedEvent) => string;
}

/** Structural playwright-like download handle. */
export interface BrowserDownload {
  suggestedFilename(): string;
  url(): string;
  saveAs(targetPath: string): Promise<void>;
  failure(): Promise<string | null>;
  cancel?(): Promise<void>;
}
