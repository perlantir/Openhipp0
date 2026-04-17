/**
 * Backup backends — local filesystem + S3-compatible.
 *
 * The S3 adapter takes an injected client so tests don't need a real
 * AWS / MinIO endpoint and production can pick any compatible SDK
 * (AWS SDK v3, minio, @aws-sdk/client-s3, or a thin-wrapper).
 */

import * as nodeFs from 'node:fs/promises';
import * as path from 'node:path';
import type { BackupArtifact, BackupBackend } from './types.js';

export interface LocalBackendOptions {
  readonly root: string;
  readonly fs?: {
    readFile(p: string, enc: 'utf8'): Promise<string>;
    writeFile(p: string, data: string, enc: 'utf8'): Promise<void>;
    mkdir(p: string, o: { recursive: true }): Promise<void>;
    rm(p: string, o: { force: true }): Promise<void>;
    readdir(p: string): Promise<string[]>;
  };
}

export function createLocalBackend(opts: LocalBackendOptions): BackupBackend {
  const fs = opts.fs ?? {
    readFile: (p, e) => nodeFs.readFile(p, e),
    writeFile: (p, d, e) => nodeFs.writeFile(p, d, e),
    mkdir: (p, o) => nodeFs.mkdir(p, o).then(() => undefined),
    rm: (p, o) => nodeFs.rm(p, o),
    readdir: (p) => nodeFs.readdir(p),
  };

  return {
    async put(key, artifact) {
      const file = path.join(opts.root, key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(artifact), 'utf8');
    },
    async get(key) {
      const file = path.join(opts.root, key);
      try {
        const raw = await fs.readFile(file, 'utf8');
        return JSON.parse(raw) as BackupArtifact;
      } catch {
        return null;
      }
    },
    async list(prefix) {
      try {
        const entries = await fs.readdir(opts.root);
        return prefix ? entries.filter((e) => e.startsWith(prefix)) : entries;
      } catch {
        return [];
      }
    },
    async delete(key) {
      const file = path.join(opts.root, key);
      await fs.rm(file, { force: true });
    },
  };
}

// ─── S3-compatible ────────────────────────────────────────────────────────

export interface S3Client {
  putObject(input: { Bucket: string; Key: string; Body: string }): Promise<void>;
  getObject(input: { Bucket: string; Key: string }): Promise<{ Body: string } | null>;
  listObjects(input: { Bucket: string; Prefix?: string }): Promise<{ Keys: readonly string[] }>;
  deleteObject(input: { Bucket: string; Key: string }): Promise<void>;
}

export interface S3BackendOptions {
  readonly bucket: string;
  readonly client: S3Client;
  /** Optional key prefix inside the bucket. */
  readonly prefix?: string;
}

export function createS3Backend(opts: S3BackendOptions): BackupBackend {
  const prefixed = (key: string): string => (opts.prefix ? `${opts.prefix}/${key}` : key);
  return {
    async put(key, artifact) {
      await opts.client.putObject({
        Bucket: opts.bucket,
        Key: prefixed(key),
        Body: JSON.stringify(artifact),
      });
    },
    async get(key) {
      const resp = await opts.client.getObject({ Bucket: opts.bucket, Key: prefixed(key) });
      if (!resp) return null;
      return JSON.parse(resp.Body) as BackupArtifact;
    },
    async list(prefix) {
      const resp = await opts.client.listObjects({
        Bucket: opts.bucket,
        ...(opts.prefix || prefix
          ? { Prefix: [opts.prefix, prefix].filter(Boolean).join('/') }
          : {}),
      });
      return resp.Keys;
    },
    async delete(key) {
      await opts.client.deleteObject({ Bucket: opts.bucket, Key: prefixed(key) });
    },
  };
}
