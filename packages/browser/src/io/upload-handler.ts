/**
 * Upload handler. Resolves an `UploadSource` to bytes, then either
 * (a) sets them on the form's file input or (b) simulates drag-drop by
 * dispatching DataTransfer events. Handles progress, retry-on-failure,
 * and cloud-storage sources via adapter injection.
 */

import { promises as fs } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { browser } from '@openhipp0/core';
import type {
  CloudStorageAdapter,
  UploadOptions,
  UploadProgress,
  UploadProgressListener,
  UploadResult,
  UploadSource,
} from './types.js';

export interface PageWithFileInputs extends browser.BrowserPage {
  setInputFiles?(
    selector: string,
    files: Array<{ name: string; mimeType?: string; buffer: Buffer }>,
  ): Promise<void>;
  dispatchDropFiles?(
    selector: string,
    files: Array<{ name: string; mimeType?: string; buffer: Buffer }>,
  ): Promise<void>;
}

export interface UploadHandlerDeps {
  readonly adapters?: readonly CloudStorageAdapter[];
  readonly fetchImpl?: typeof globalThis.fetch;
}

export interface ResolvedSourceFile {
  readonly name: string;
  readonly mimeType?: string;
  readonly buffer: Buffer;
}

export async function resolveUploadSource(
  source: UploadSource,
  deps: UploadHandlerDeps = {},
  onProgress?: UploadProgressListener,
): Promise<ResolvedSourceFile> {
  if (source.kind === 'buffer') {
    return {
      name: source.name,
      ...(source.mimeType ? { mimeType: source.mimeType } : {}),
      buffer: source.data,
    };
  }
  if (source.kind === 'local') {
    const buf = await fs.readFile(source.path);
    return { name: path.basename(source.path), buffer: buf };
  }
  if (source.kind === 'url') {
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    const resp = await fetchImpl(source.url, { headers: source.headers ?? {} });
    if (!resp.ok) throw new Error(`fetch ${source.url} → ${resp.status}`);
    const ab = await resp.arrayBuffer();
    const buf = Buffer.from(ab);
    const name = path.basename(new URL(source.url).pathname) || 'download';
    const mimeType = resp.headers.get('content-type') ?? undefined;
    return mimeType ? { name, mimeType, buffer: buf } : { name, buffer: buf };
  }
  for (const adapter of deps.adapters ?? []) {
    if (adapter.supports(source)) {
      const buf = await adapter.fetch(source, onProgress);
      return { name: deriveNameFromCloud(source), buffer: buf };
    }
  }
  throw new Error(`no CloudStorageAdapter supports source kind=${source.kind}`);
}

function deriveNameFromCloud(source: UploadSource): string {
  if (source.kind === 's3') return path.basename(source.key) || 'object';
  if (source.kind === 'drive') return `drive-${source.fileId}`;
  if (source.kind === 'dropbox') return path.basename(source.pathLower) || 'dropbox';
  return 'upload';
}

export class UploadHandler {
  readonly #deps: UploadHandlerDeps;

  constructor(deps: UploadHandlerDeps = {}) {
    this.#deps = deps;
  }

  async upload(
    page: PageWithFileInputs,
    source: UploadSource,
    opts: UploadOptions,
  ): Promise<UploadResult> {
    const maxAttempts = Math.max(1, opts.resumeAttempts ?? 2);
    let attempt = 0;
    let lastError: string | undefined;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        emit(opts.onProgress, { source, bytesSent: 0, bytesTotal: null, phase: 'staging' });
        const file = await resolveUploadSource(source, this.#deps, opts.onProgress);
        emit(opts.onProgress, {
          source,
          bytesSent: 0,
          bytesTotal: file.buffer.byteLength,
          phase: 'uploading',
        });
        const payload = [
          {
            name: file.name,
            ...(file.mimeType ? { mimeType: file.mimeType } : {}),
            buffer: file.buffer,
          },
        ];
        if (opts.dropTargetSelector && page.dispatchDropFiles) {
          await page.dispatchDropFiles(opts.dropTargetSelector, payload);
        } else if (page.setInputFiles) {
          await page.setInputFiles(opts.targetSelector, payload);
        } else {
          throw new Error('page has neither setInputFiles nor dispatchDropFiles');
        }
        emit(opts.onProgress, {
          source,
          bytesSent: file.buffer.byteLength,
          bytesTotal: file.buffer.byteLength,
          phase: 'done',
        });
        return { source, bytesSent: file.buffer.byteLength, attempts: attempt, ok: true };
      } catch (err) {
        lastError = (err as Error).message;
        emit(opts.onProgress, {
          source,
          bytesSent: 0,
          bytesTotal: null,
          phase: 'failed',
          error: lastError,
        });
      }
    }
    return {
      source,
      bytesSent: 0,
      attempts: attempt,
      ok: false,
      ...(lastError ? { error: lastError } : {}),
    };
  }
}

function emit(listener: UploadProgressListener | undefined, event: UploadProgress): void {
  try {
    listener?.(event);
  } catch {
    /* listener errors never break uploads */
  }
}

/** Stage an UploadSource to a local temp file. Returns caller-owned cleanup. */
export async function stageSourceToDisk(
  source: UploadSource,
  deps: UploadHandlerDeps = {},
): Promise<{ filePath: string; cleanup: () => Promise<void>; bytes: number }> {
  const resolved = await resolveUploadSource(source, deps);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hipp0-upload-'));
  const filePath = path.join(dir, resolved.name);
  await fs.writeFile(filePath, resolved.buffer);
  return {
    filePath,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
    bytes: resolved.buffer.byteLength,
  };
}
