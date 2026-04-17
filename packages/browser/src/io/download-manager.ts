/**
 * Download manager — wraps a structural Playwright-like `download` event,
 * routes the file to a workspace dir, runs an optional virus-scan hook,
 * tracks state per in-flight download, and emits start/complete/failed.
 */

import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { homedir } from 'node:os';

import type {
  BrowserDownload,
  DownloadCompletedEvent,
  DownloadFailedEvent,
  DownloadManagerOptions,
  DownloadStartedEvent,
  VirusScanHook,
} from './types.js';

export interface DownloadEvents {
  started: [DownloadStartedEvent];
  completed: [DownloadCompletedEvent];
  failed: [DownloadFailedEvent];
}

export type DownloadManagerListener<K extends keyof DownloadEvents> = (
  ...args: DownloadEvents[K]
) => void;

function defaultWorkspace(): string {
  return path.join(process.env['HIPP0_HOME'] ?? path.join(homedir(), '.hipp0'), 'downloads');
}

function defaultFilename(ev: DownloadStartedEvent): string {
  // Prefix with a timestamp + short uuid to prevent collisions.
  const ts = ev.startedAt.replace(/[:.]/g, '-');
  const short = ev.id.slice(0, 6);
  return `${ts}-${short}-${ev.suggestedFilename}`;
}

export class DownloadManager {
  readonly #workspace: string;
  readonly #scan: VirusScanHook | undefined;
  readonly #filenameOf: (ev: DownloadStartedEvent) => string;
  readonly #emitter = new EventEmitter();

  constructor(opts: DownloadManagerOptions = {}) {
    this.#workspace = opts.workspaceDir ?? defaultWorkspace();
    this.#scan = opts.virusScan;
    this.#filenameOf = opts.filenameOf ?? defaultFilename;
  }

  on<K extends keyof DownloadEvents>(event: K, listener: DownloadManagerListener<K>): this {
    this.#emitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof DownloadEvents>(event: K, listener: DownloadManagerListener<K>): this {
    this.#emitter.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Handle a download event. Moves the download to the workspace, optionally
   * scans, and emits started → completed | failed.
   */
  async handle(download: BrowserDownload): Promise<DownloadCompletedEvent | DownloadFailedEvent> {
    const id = randomUUID();
    const startedEvent: DownloadStartedEvent = {
      id,
      suggestedFilename: download.suggestedFilename(),
      url: download.url(),
      startedAt: new Date().toISOString(),
    };
    this.#emitter.emit('started', startedEvent);
    const target = path.join(this.#workspace, this.#filenameOf(startedEvent));
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const t0 = Date.now();
    try {
      await download.saveAs(target);
      const failure = await download.failure();
      if (failure) {
        const failed: DownloadFailedEvent = { id, error: failure };
        this.#emitter.emit('failed', failed);
        return failed;
      }
      const stat = await fs.stat(target);
      let scan;
      if (this.#scan) scan = await this.#scan(target);
      const completed: DownloadCompletedEvent = {
        id,
        filePath: target,
        bytes: stat.size,
        durationMs: Date.now() - t0,
        ...(scan ? { virusScan: scan } : {}),
      };
      this.#emitter.emit('completed', completed);
      return completed;
    } catch (err) {
      const failed: DownloadFailedEvent = { id, error: (err as Error).message };
      this.#emitter.emit('failed', failed);
      return failed;
    }
  }
}
