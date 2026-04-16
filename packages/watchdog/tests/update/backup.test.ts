import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hipp0BackupError, createBackup, openBackup } from '../../src/index.js';

describe('createBackup + restore', () => {
  let workdir: string;
  let sourcesDir: string;
  let destDir: string;

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'hipp0-backup-'));
    sourcesDir = path.join(workdir, 'sources');
    destDir = path.join(workdir, 'backups');
    await fs.mkdir(sourcesDir, { recursive: true });
    await fs.mkdir(destDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workdir, { recursive: true, force: true });
  });

  it('backs up a single file then restores it', async () => {
    const file = path.join(sourcesDir, 'data.db');
    await fs.writeFile(file, 'original', 'utf8');
    const handle = await createBackup({ sources: [file], destDir, label: 'v1' });
    expect(handle.artifact.label).toBe('v1');
    expect(handle.artifact.bytes).toBeGreaterThan(0);

    await fs.writeFile(file, 'modified', 'utf8');
    expect(await fs.readFile(file, 'utf8')).toBe('modified');

    await handle.restore();
    expect(await fs.readFile(file, 'utf8')).toBe('original');
  });

  it('backs up a directory recursively and restores it', async () => {
    const dir = path.join(sourcesDir, 'cfg');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'a.json'), '{"a":1}', 'utf8');
    await fs.writeFile(path.join(dir, 'b.json'), '{"b":2}', 'utf8');

    const handle = await createBackup({ sources: [dir], destDir });
    await fs.rm(dir, { recursive: true, force: true });
    await handle.restore();
    expect(await fs.readFile(path.join(dir, 'a.json'), 'utf8')).toBe('{"a":1}');
    expect(await fs.readFile(path.join(dir, 'b.json'), 'utf8')).toBe('{"b":2}');
  });

  it('handles two sources with the same basename without overwriting', async () => {
    const a = path.join(sourcesDir, 'a', 'foo.db');
    const b = path.join(sourcesDir, 'b', 'foo.db');
    await fs.mkdir(path.dirname(a), { recursive: true });
    await fs.mkdir(path.dirname(b), { recursive: true });
    await fs.writeFile(a, 'A', 'utf8');
    await fs.writeFile(b, 'B', 'utf8');

    const handle = await createBackup({ sources: [a, b], destDir });
    await fs.writeFile(a, 'A2', 'utf8');
    await fs.writeFile(b, 'B2', 'utf8');
    await handle.restore();
    expect(await fs.readFile(a, 'utf8')).toBe('A');
    expect(await fs.readFile(b, 'utf8')).toBe('B');
  });

  it('throws Hipp0BackupError on empty sources', async () => {
    await expect(createBackup({ sources: [], destDir })).rejects.toBeInstanceOf(Hipp0BackupError);
  });

  it('cleans up partial backup directory when a copy fails', async () => {
    const present = path.join(sourcesDir, 'present.db');
    await fs.writeFile(present, 'x', 'utf8');
    const missing = path.join(sourcesDir, 'missing.db');
    await expect(createBackup({ sources: [present, missing], destDir })).rejects.toBeInstanceOf(
      Hipp0BackupError,
    );
    // No leftover dirs in destDir.
    expect(await fs.readdir(destDir)).toEqual([]);
  });

  it('openBackup re-hydrates a handle from disk', async () => {
    const file = path.join(sourcesDir, 'cfg.json');
    await fs.writeFile(file, '"hi"', 'utf8');
    const handle = await createBackup({ sources: [file], destDir, label: 'snap' });

    const reopened = await openBackup(handle.artifact.path);
    await fs.writeFile(file, '"changed"', 'utf8');
    await reopened.restore();
    expect(await fs.readFile(file, 'utf8')).toBe('"hi"');
  });

  it('discard removes the backup directory', async () => {
    const file = path.join(sourcesDir, 'a');
    await fs.writeFile(file, 'x', 'utf8');
    const handle = await createBackup({ sources: [file], destDir });
    await handle.discard();
    expect(await fs.readdir(destDir)).toEqual([]);
  });
});
