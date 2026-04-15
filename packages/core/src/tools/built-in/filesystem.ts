/**
 * Built-in filesystem tools: file_read, file_write, file_list.
 *
 * Every path is passed through assertPathAllowed() — which checks the blocked
 * list (always) and the context's allowedPaths. Writes that would land outside
 * the allow-list fail with Hipp0PathDeniedError.
 */

import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { assertPathAllowed } from '../path-guard.js';
import type { ExecutionContext, Tool } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────

const fileReadParams = z.object({
  path: z.string().min(1),
  encoding: z.enum(['utf8', 'base64']).default('utf8'),
  maxBytes: z.number().int().positive().max(10_000_000).default(1_000_000),
});

export const fileReadTool: Tool<z.infer<typeof fileReadParams>> = {
  name: 'file_read',
  description: 'Read a UTF-8 or base64-encoded file from disk (inside allowedPaths).',
  permissions: ['fs.read'],
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'Absolute or ~-prefixed path.' },
      encoding: { type: 'string', enum: ['utf8', 'base64'], default: 'utf8' },
      maxBytes: { type: 'integer', minimum: 1, maximum: 10_000_000, default: 1_000_000 },
    },
  },
  validator: fileReadParams,
  async execute(params, ctx) {
    const canonical = assertPathAllowed(params.path, {
      allowedRoots: ctx.allowedPaths,
      tool: this.name,
    });
    const s = await stat(canonical);
    if (!s.isFile()) {
      return { ok: false, output: 'Path is not a regular file', errorCode: 'HIPP0_NOT_A_FILE' };
    }
    if (s.size > params.maxBytes) {
      return {
        ok: false,
        output: `File too large: ${s.size} bytes > maxBytes ${params.maxBytes}`,
        errorCode: 'HIPP0_FILE_TOO_LARGE',
        metadata: { size: s.size, maxBytes: params.maxBytes },
      };
    }
    const raw = await readFile(canonical);
    const output = params.encoding === 'base64' ? raw.toString('base64') : raw.toString('utf8');
    return { ok: true, output, metadata: { size: s.size, path: canonical } };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

const fileWriteParams = z.object({
  path: z.string().min(1),
  content: z.string(),
  encoding: z.enum(['utf8', 'base64']).default('utf8'),
  createDirs: z.boolean().default(false),
  overwrite: z.boolean().default(true),
});

export const fileWriteTool: Tool<z.infer<typeof fileWriteParams>> = {
  name: 'file_write',
  description: 'Write content to a file. Path must be inside allowedPaths.',
  permissions: ['fs.write'],
  inputSchema: {
    type: 'object',
    required: ['path', 'content'],
    properties: {
      path: { type: 'string', description: 'Absolute or ~-prefixed path.' },
      content: { type: 'string', description: 'File contents (utf8 text or base64).' },
      encoding: { type: 'string', enum: ['utf8', 'base64'], default: 'utf8' },
      createDirs: { type: 'boolean', default: false },
      overwrite: { type: 'boolean', default: true },
    },
  },
  validator: fileWriteParams,
  async execute(params, ctx) {
    const canonical = assertPathAllowed(params.path, {
      allowedRoots: ctx.allowedPaths,
      tool: this.name,
    });

    if (!params.overwrite) {
      try {
        await stat(canonical);
        return {
          ok: false,
          output: 'File exists and overwrite=false',
          errorCode: 'HIPP0_FILE_EXISTS',
        };
      } catch {
        // File doesn't exist — proceed.
      }
    }

    if (params.createDirs) {
      await mkdir(dirname(canonical), { recursive: true });
    }
    const buf =
      params.encoding === 'base64'
        ? Buffer.from(params.content, 'base64')
        : Buffer.from(params.content, 'utf8');
    await writeFile(canonical, buf);
    return {
      ok: true,
      output: `Wrote ${buf.length} bytes to ${canonical}`,
      metadata: { path: canonical, bytes: buf.length },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

const fileListParams = z.object({
  path: z.string().min(1),
  maxEntries: z.number().int().positive().max(10_000).default(500),
});

export const fileListTool: Tool<z.infer<typeof fileListParams>> = {
  name: 'file_list',
  description: 'List entries in a directory. Path must be inside allowedPaths.',
  permissions: ['fs.list'],
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string' },
      maxEntries: { type: 'integer', minimum: 1, maximum: 10_000, default: 500 },
    },
  },
  validator: fileListParams,
  async execute(params, ctx: ExecutionContext) {
    const canonical = assertPathAllowed(params.path, {
      allowedRoots: ctx.allowedPaths,
      tool: this.name,
    });
    const s = await stat(canonical);
    if (!s.isDirectory()) {
      return { ok: false, output: 'Path is not a directory', errorCode: 'HIPP0_NOT_A_DIRECTORY' };
    }
    const entries = await readdir(canonical, { withFileTypes: true });
    const truncated = entries.length > params.maxEntries;
    const take = truncated ? entries.slice(0, params.maxEntries) : entries;
    const lines = take.map((e) =>
      e.isDirectory() ? `${e.name}/` : e.isSymbolicLink() ? `${e.name}@` : e.name,
    );
    const output =
      lines.join('\n') + (truncated ? `\n... (${entries.length - take.length} more)` : '');
    return { ok: true, output, metadata: { count: entries.length, truncated } };
  },
};

export const FILESYSTEM_TOOLS = [fileReadTool, fileWriteTool, fileListTool] as const;
