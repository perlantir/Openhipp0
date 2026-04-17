export {
  resolveUploadSource,
  stageSourceToDisk,
  UploadHandler,
  type PageWithFileInputs,
  type ResolvedSourceFile,
  type UploadHandlerDeps,
} from './upload-handler.js';

export { DownloadManager, type DownloadEvents, type DownloadManagerListener } from './download-manager.js';

export type {
  BrowserDownload,
  CloudStorageAdapter,
  DownloadCompletedEvent,
  DownloadFailedEvent,
  DownloadManagerOptions,
  DownloadStartedEvent,
  UploadOptions,
  UploadProgress,
  UploadProgressListener,
  UploadResult,
  UploadSource,
  VirusScanHook,
  VirusScanResult,
} from './types.js';
