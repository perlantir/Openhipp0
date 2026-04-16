/**
 * PushRegistry implementations — in-memory for tests, JSON-file backed for
 * the single-node server default.
 *
 * The file registry writes to `~/.hipp0/push-registry.json` (mode 0600) and
 * is a thin mirror of the map the CLI's `buildPushRoutes` already persists
 * — we share the same on-disk format so the CLI route and the sender can
 * both operate on the same device list without a running database.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { PushDeviceRecord, PushRegistry } from './types.js';

export class InMemoryPushRegistry implements PushRegistry {
  private readonly records = new Map<string, PushDeviceRecord>();

  async list(): Promise<readonly PushDeviceRecord[]> {
    return Array.from(this.records.values());
  }
  async get(deviceId: string): Promise<PushDeviceRecord | undefined> {
    return this.records.get(deviceId);
  }
  async upsert(record: PushDeviceRecord): Promise<void> {
    this.records.set(record.deviceId, record);
  }
  async remove(deviceId: string): Promise<void> {
    this.records.delete(deviceId);
  }
}

export interface FilePushRegistryOptions {
  /** Defaults to `${HIPP0_HOME|~/.hipp0}/push-registry.json`. */
  filePath?: string;
}

interface FileFormat {
  [deviceId: string]: {
    pushToken: string;
    platform: 'ios' | 'android';
    updatedAt: string;
  };
}

export class FilePushRegistry implements PushRegistry {
  private readonly filePath: string;

  constructor(opts: FilePushRegistryOptions = {}) {
    this.filePath =
      opts.filePath ??
      path.join(process.env['HIPP0_HOME'] ?? path.join(os.homedir(), '.hipp0'), 'push-registry.json');
  }

  private async read(): Promise<FileFormat> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(raw) as FileFormat;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
  }

  private async write(data: FileFormat): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  async list(): Promise<readonly PushDeviceRecord[]> {
    const data = await this.read();
    return Object.entries(data).map(([deviceId, v]) => ({ deviceId, ...v }));
  }

  async get(deviceId: string): Promise<PushDeviceRecord | undefined> {
    const data = await this.read();
    const entry = data[deviceId];
    return entry ? { deviceId, ...entry } : undefined;
  }

  async upsert(record: PushDeviceRecord): Promise<void> {
    const data = await this.read();
    data[record.deviceId] = {
      pushToken: record.pushToken,
      platform: record.platform,
      updatedAt: record.updatedAt,
    };
    await this.write(data);
  }

  async remove(deviceId: string): Promise<void> {
    const data = await this.read();
    delete data[deviceId];
    await this.write(data);
  }
}
