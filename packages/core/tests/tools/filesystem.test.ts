import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileListTool, fileReadTool, fileWriteTool } from '../../src/tools/built-in/filesystem.js';
import { Hipp0PathDeniedError } from '../../src/tools/types.js';
import type { ExecutionContext } from '../../src/tools/types.js';

let sandbox: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hipp0-fs-'));
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

function ctx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    sandbox: 'native',
    timeoutMs: 5_000,
    allowedPaths: [sandbox],
    allowedDomains: [],
    grantedPermissions: ['fs.read', 'fs.write', 'fs.list'],
    agent: { id: 'a1', name: 'lead', role: 'lead' },
    projectId: 'p1',
    ...overrides,
  };
}

describe('fileWriteTool', () => {
  it('writes a file inside allowedPaths', async () => {
    const target = join(sandbox, 'hello.txt');
    const res = await fileWriteTool.execute(
      {
        path: target,
        content: 'hello world',
        encoding: 'utf8',
        createDirs: false,
        overwrite: true,
      },
      ctx(),
    );
    expect(res.ok).toBe(true);
    expect(await readFile(target, 'utf8')).toBe('hello world');
  });

  it('rejects writes outside allowedPaths', async () => {
    await expect(
      fileWriteTool.execute(
        {
          path: '/etc/evil',
          content: 'no',
          encoding: 'utf8',
          createDirs: false,
          overwrite: true,
        },
        ctx(),
      ),
    ).rejects.toBeInstanceOf(Hipp0PathDeniedError);
  });

  it('rejects writes to ~/.ssh even if ~ is allowed', async () => {
    await expect(
      fileWriteTool.execute(
        {
          path: '~/.ssh/evil',
          content: 'no',
          encoding: 'utf8',
          createDirs: false,
          overwrite: true,
        },
        ctx({ allowedPaths: ['~'] }),
      ),
    ).rejects.toBeInstanceOf(Hipp0PathDeniedError);
  });

  it('refuses to overwrite when overwrite=false', async () => {
    const target = join(sandbox, 'exists.txt');
    await fileWriteTool.execute(
      { path: target, content: 'first', encoding: 'utf8', createDirs: false, overwrite: true },
      ctx(),
    );
    const res = await fileWriteTool.execute(
      { path: target, content: 'second', encoding: 'utf8', createDirs: false, overwrite: false },
      ctx(),
    );
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('HIPP0_FILE_EXISTS');
  });

  it('createDirs creates parent directories', async () => {
    const target = join(sandbox, 'a', 'b', 'c.txt');
    const res = await fileWriteTool.execute(
      { path: target, content: 'x', encoding: 'utf8', createDirs: true, overwrite: true },
      ctx(),
    );
    expect(res.ok).toBe(true);
    expect(await readFile(target, 'utf8')).toBe('x');
  });
});

describe('fileReadTool', () => {
  it('reads a file inside allowedPaths', async () => {
    const target = join(sandbox, 'read.txt');
    await fileWriteTool.execute(
      { path: target, content: 'data', encoding: 'utf8', createDirs: false, overwrite: true },
      ctx(),
    );

    const res = await fileReadTool.execute(
      { path: target, encoding: 'utf8', maxBytes: 1_000_000 },
      ctx(),
    );
    expect(res.ok).toBe(true);
    expect(res.output).toBe('data');
  });

  it('rejects reads outside allowedPaths', async () => {
    await expect(
      fileReadTool.execute({ path: '/etc/passwd', encoding: 'utf8', maxBytes: 100 }, ctx()),
    ).rejects.toBeInstanceOf(Hipp0PathDeniedError);
  });

  it('reports HIPP0_FILE_TOO_LARGE when file exceeds maxBytes', async () => {
    const target = join(sandbox, 'big.txt');
    await fileWriteTool.execute(
      {
        path: target,
        content: 'X'.repeat(100),
        encoding: 'utf8',
        createDirs: false,
        overwrite: true,
      },
      ctx(),
    );
    const res = await fileReadTool.execute({ path: target, encoding: 'utf8', maxBytes: 10 }, ctx());
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('HIPP0_FILE_TOO_LARGE');
  });
});

describe('fileListTool', () => {
  it('lists directory entries', async () => {
    await fileWriteTool.execute(
      {
        path: join(sandbox, 'a.txt'),
        content: 'x',
        encoding: 'utf8',
        createDirs: false,
        overwrite: true,
      },
      ctx(),
    );
    await fileWriteTool.execute(
      {
        path: join(sandbox, 'sub', 'b.txt'),
        content: 'y',
        encoding: 'utf8',
        createDirs: true,
        overwrite: true,
      },
      ctx(),
    );

    const res = await fileListTool.execute({ path: sandbox, maxEntries: 500 }, ctx());
    expect(res.ok).toBe(true);
    expect(res.output).toContain('a.txt');
    expect(res.output).toContain('sub/');
    expect(res.metadata?.count).toBe(2);
  });
});
