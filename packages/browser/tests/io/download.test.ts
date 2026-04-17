import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DownloadManager } from '../../src/io/download-manager.js';
import type { BrowserDownload } from '../../src/io/types.js';

function makeDownload(name: string, url: string, body: Buffer): BrowserDownload {
  return {
    suggestedFilename: () => name,
    url: () => url,
    async saveAs(target: string) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, body);
    },
    async failure() {
      return null;
    },
  };
}

describe('DownloadManager', () => {
  let workspace: string;
  beforeEach(() => {
    workspace = mkdtempSync(path.join(os.tmpdir(), 'hipp0-dl-'));
  });
  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('routes a successful download to workspace + emits started/completed', async () => {
    const mgr = new DownloadManager({ workspaceDir: workspace });
    const startedFn = vi.fn();
    const completedFn = vi.fn();
    mgr.on('started', startedFn);
    mgr.on('completed', completedFn);
    const dl = makeDownload('report.csv', 'https://x/report.csv', Buffer.from('a,b,c'));
    const result = await mgr.handle(dl);
    if ('error' in result) throw new Error(`unexpected failure: ${result.error}`);
    expect(startedFn).toHaveBeenCalledOnce();
    expect(completedFn).toHaveBeenCalledOnce();
    expect(result.bytes).toBe(5);
    expect(result.filePath).toMatch(/report\.csv$/);
  });

  it('runs the virus-scan hook before emitting completed', async () => {
    const scan = vi.fn().mockResolvedValue({ ok: true, scannedAt: new Date().toISOString(), detector: 'fake' });
    const mgr = new DownloadManager({ workspaceDir: workspace, virusScan: scan });
    const dl = makeDownload('x.bin', 'u', Buffer.from([1, 2, 3]));
    const result = await mgr.handle(dl);
    if ('error' in result) throw new Error('unexpected failure');
    expect(scan).toHaveBeenCalledOnce();
    expect(result.virusScan?.detector).toBe('fake');
  });

  it('emits failed when saveAs throws', async () => {
    const mgr = new DownloadManager({ workspaceDir: workspace });
    const failedFn = vi.fn();
    mgr.on('failed', failedFn);
    const broken: BrowserDownload = {
      suggestedFilename: () => 'x',
      url: () => 'u',
      async saveAs() {
        throw new Error('disk full');
      },
      async failure() {
        return null;
      },
    };
    const result = await mgr.handle(broken);
    expect('error' in result && result.error).toContain('disk full');
    expect(failedFn).toHaveBeenCalledOnce();
  });

  it('honors a custom filenameOf', async () => {
    const mgr = new DownloadManager({
      workspaceDir: workspace,
      filenameOf: () => 'fixed.bin',
    });
    const dl = makeDownload('orig.bin', 'u', Buffer.from('y'));
    const result = await mgr.handle(dl);
    if ('error' in result) throw new Error('unexpected failure');
    expect(path.basename(result.filePath)).toBe('fixed.bin');
  });
});
