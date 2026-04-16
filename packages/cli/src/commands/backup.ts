/**
 * `hipp0 backup ...` — create + restore + list encrypted backups.
 *
 *   create --backend {local|s3} [--key KEY]
 *   restore --backend {local|s3} --key KEY
 *   list   --backend {local|s3}
 *
 * Password is taken from HIPP0_BACKUP_PASSWORD (operators are expected to
 * source it from the system keychain before invoking). The CLI never logs
 * the password and never persists it.
 *
 * DataSource + DataSink are injected so the CLI stays agnostic about which
 * tables it's backing up; callers wire a source/sink that reads the
 * memory DB.
 */

import { backup as backupModule } from '@openhipp0/core';
import { Hipp0CliError, type CommandResult } from '../types.js';

const { createBackup, restoreBackup, createLocalBackend, createS3Backend } = backupModule;

export interface BackupCliOptions {
  readonly backend: backupModule.BackupBackend;
  readonly password: string;
  /** Required for create; optional for restore (restored from --key). */
  readonly source?: backupModule.DataSource;
  readonly sink?: backupModule.DataSink;
  readonly key?: string;
  readonly now?: () => string;
}

export async function runBackupCreate(opts: BackupCliOptions): Promise<CommandResult> {
  if (!opts.source) {
    throw new Hipp0CliError(
      'backup create requires a DataSource. Wire one in the CLI entrypoint.',
      'HIPP0_CLI_BACKUP_NO_SOURCE',
      1,
    );
  }
  const result = await createBackup({
    source: opts.source,
    password: opts.password,
    backend: opts.backend,
    ...(opts.key && { key: opts.key }),
    ...(opts.now && { now: opts.now }),
  });
  return {
    exitCode: 0,
    stdout: [
      `✓ Backup written: ${result.key}`,
      `  ${result.manifest.tables.length} table${result.manifest.tables.length === 1 ? '' : 's'}, created at ${result.manifest.createdAt}`,
      `  overallChecksum: ${result.manifest.overallChecksum.slice(0, 16)}…`,
    ],
    data: { key: result.key, manifest: result.manifest },
  };
}

export async function runBackupRestore(opts: BackupCliOptions): Promise<CommandResult> {
  if (!opts.sink) {
    throw new Hipp0CliError(
      'backup restore requires a DataSink.',
      'HIPP0_CLI_BACKUP_NO_SINK',
      1,
    );
  }
  if (!opts.key) {
    throw new Hipp0CliError(
      'backup restore requires --key KEY.',
      'HIPP0_CLI_BACKUP_NO_KEY',
      1,
    );
  }
  const manifest = await restoreBackup({
    sink: opts.sink,
    password: opts.password,
    backend: opts.backend,
    key: opts.key,
  });
  return {
    exitCode: 0,
    stdout: [
      `✓ Restored ${opts.key}`,
      `  ${manifest.tables.length} table${manifest.tables.length === 1 ? '' : 's'} applied`,
    ],
    data: { manifest },
  };
}

export async function runBackupList(
  opts: Pick<BackupCliOptions, 'backend'>,
): Promise<CommandResult> {
  const keys = await opts.backend.list();
  if (keys.length === 0) {
    return { exitCode: 0, stdout: ['No backups.'], data: { keys: [] } };
  }
  return {
    exitCode: 0,
    stdout: [`Found ${keys.length} backup${keys.length === 1 ? '' : 's'}:`, ...keys.map((k) => `  ${k}`)],
    data: { keys },
  };
}

// ─── Backend helpers so callers don't need to import from core ──────────

export function localBackend(root: string): backupModule.BackupBackend {
  return createLocalBackend({ root });
}

export function s3Backend(opts: {
  bucket: string;
  client: backupModule.S3Client;
  prefix?: string;
}): backupModule.BackupBackend {
  return createS3Backend(opts);
}
