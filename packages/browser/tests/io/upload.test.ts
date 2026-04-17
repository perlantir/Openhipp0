import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveUploadSource, stageSourceToDisk, UploadHandler, type PageWithFileInputs } from '../../src/io/upload-handler.js';
import type { CloudStorageAdapter, UploadSource } from '../../src/io/types.js';

function makePage(): { page: PageWithFileInputs; received: unknown[] } {
  const received: unknown[] = [];
  const page = {
    url: () => '',
    async title() {
      return '';
    },
    async goto() {
      /* noop */
    },
    async click() {
      /* noop */
    },
    async fill() {
      /* noop */
    },
    async type() {
      /* noop */
    },
    async selectOption() {
      /* noop */
    },
    async content() {
      return '';
    },
    async innerText() {
      return '';
    },
    async screenshot() {
      return Buffer.alloc(0);
    },
    async evaluate() {
      return undefined as never;
    },
    mouse: { async wheel() {} },
    async waitForTimeout() {
      /* noop */
    },
    accessibility: { async snapshot() { return null; } },
    async close() {
      /* noop */
    },
    async setInputFiles(selector: string, files: Array<{ name: string; buffer: Buffer }>) {
      received.push({ selector, files });
    },
    async dispatchDropFiles(selector: string, files: Array<{ name: string; buffer: Buffer }>) {
      received.push({ dropSelector: selector, files });
    },
  } as PageWithFileInputs;
  return { page, received };
}

describe('UploadHandler', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'hipp0-upload-test-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('uploads a local file via setInputFiles', async () => {
    const file = path.join(tmp, 'hello.txt');
    await fs.writeFile(file, 'hi');
    const { page, received } = makePage();
    const handler = new UploadHandler();
    const res = await handler.upload(page, { kind: 'local', path: file }, { targetSelector: 'input[type=file]' });
    expect(res.ok).toBe(true);
    expect(res.bytesSent).toBe(2);
    expect(received).toHaveLength(1);
  });

  it('emits progress events through the lifecycle', async () => {
    const { page } = makePage();
    const handler = new UploadHandler();
    const events: string[] = [];
    await handler.upload(
      page,
      { kind: 'buffer', name: 'f.bin', data: Buffer.from('abc') },
      {
        targetSelector: 'input',
        onProgress: (ev) => events.push(ev.phase),
      },
    );
    expect(events).toEqual(['staging', 'uploading', 'done']);
  });

  it('simulates drop when dropTargetSelector is set', async () => {
    const { page, received } = makePage();
    const handler = new UploadHandler();
    const res = await handler.upload(
      page,
      { kind: 'buffer', name: 'f', data: Buffer.from('x') },
      { targetSelector: 'input', dropTargetSelector: '.dropzone' },
    );
    expect(res.ok).toBe(true);
    expect((received[0] as { dropSelector?: string }).dropSelector).toBe('.dropzone');
  });

  it('retries per resumeAttempts on transient failure', async () => {
    const { page } = makePage();
    const flaky = page as PageWithFileInputs & { setInputFiles: ReturnType<typeof vi.fn> };
    let attempts = 0;
    flaky.setInputFiles = vi.fn().mockImplementation(async () => {
      attempts += 1;
      if (attempts < 2) throw new Error('net down');
    });
    const handler = new UploadHandler();
    const res = await handler.upload(
      flaky,
      { kind: 'buffer', name: 'f', data: Buffer.from('x') },
      { targetSelector: 'input', resumeAttempts: 3 },
    );
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(2);
  });

  it('delegates cloud sources to adapters', async () => {
    const adapter: CloudStorageAdapter = {
      supports: (s: UploadSource) => s.kind === 's3',
      async fetch() {
        return Buffer.from('from-s3');
      },
    };
    const { page, received } = makePage();
    const handler = new UploadHandler({ adapters: [adapter] });
    const res = await handler.upload(
      page,
      { kind: 's3', bucket: 'b', key: 'k/file.txt' },
      { targetSelector: 'input' },
    );
    expect(res.ok).toBe(true);
    expect((received[0] as { files: Array<{ name: string }> }).files[0]?.name).toBe('file.txt');
  });

  it('stageSourceToDisk writes the resolved bytes and provides cleanup', async () => {
    const { filePath, cleanup, bytes } = await stageSourceToDisk({
      kind: 'buffer',
      name: 'stg.bin',
      data: Buffer.from('abcd'),
    });
    expect(bytes).toBe(4);
    expect(await fs.readFile(filePath, 'utf8')).toBe('abcd');
    await cleanup();
    await expect(fs.stat(filePath)).rejects.toThrow();
  });

  it('resolveUploadSource pulls from a URL via fetchImpl', async () => {
    const fetchImpl = (async (_url: string) =>
      new Response(Buffer.from('remote'), { headers: { 'content-type': 'text/plain' } })) as unknown as typeof globalThis.fetch;
    const resolved = await resolveUploadSource(
      { kind: 'url', url: 'https://example.com/file.txt' },
      { fetchImpl },
    );
    expect(resolved.buffer.toString('utf8')).toBe('remote');
    expect(resolved.mimeType).toBe('text/plain');
    expect(resolved.name).toBe('file.txt');
  });
});
