/**
 * MCP marketplace installer — mirrors the skills-marketplace shape for
 * pin / rollback / uninstall against a structural file system.
 *
 * Safety guardrails (per the hardening risk pass):
 *   - Every install passes through hash verification.
 *   - `requireSignature` policy forces publisher signature — default true.
 *   - `maxInstalledPerProject` (default 10) stops flood installs.
 *   - Tool-namespace collision detection prevents two servers exposing the
 *     same logical tool name from shadowing one another.
 *   - Every install / update / rollback / uninstall records a ledger entry
 *     + calls the optional `onAudit` hook.
 */

import { assertHashMatches, verifyBundleSignature } from './hash.js';
import { diffPostures } from './diff.js';
import type {
  InstalledMcpRecord,
  MarketplaceLedger,
  McpServerBundle,
  PostureDiff,
} from './types.js';

const LEDGER_FILENAME = 'installed.json';
const DEFAULT_MAX_INSTALLED = 10;

export interface InstallerFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string, opts: { recursive: boolean }): Promise<void>;
  rm(path: string, opts: { recursive?: boolean; force?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface InstallerAuditEvent {
  readonly kind: 'install' | 'update' | 'pin' | 'unpin' | 'rollback' | 'uninstall';
  readonly name: string;
  readonly version: string;
  readonly contentHash: string;
  readonly diff?: PostureDiff;
  readonly signer?: string;
  readonly at: string;
}

export interface InstallerOptions {
  readonly fs: InstallerFs;
  readonly rootDir: string;
  readonly requireSignature?: boolean;
  readonly maxInstalledPerProject?: number;
  readonly onAudit?: (evt: InstallerAuditEvent) => void | Promise<void>;
}

export class McpMarketplaceInstaller {
  constructor(private readonly opts: InstallerOptions) {}

  async list(): Promise<MarketplaceLedger> {
    const path = this.ledgerPath();
    if (!(await this.opts.fs.exists(path))) return { installed: [] };
    const raw = await this.opts.fs.readFile(path);
    try {
      return JSON.parse(raw) as MarketplaceLedger;
    } catch {
      return { installed: [] };
    }
  }

  async get(name: string): Promise<InstalledMcpRecord | undefined> {
    const ledger = await this.list();
    return ledger.installed.find((r) => r.name === name);
  }

  async getBundle(name: string): Promise<McpServerBundle | undefined> {
    const p = this.bundlePath(name);
    if (!(await this.opts.fs.exists(p))) return undefined;
    const raw = await this.opts.fs.readFile(p);
    try {
      return JSON.parse(raw) as McpServerBundle;
    } catch {
      return undefined;
    }
  }

  async previewInstall(bundle: McpServerBundle): Promise<{
    diff: PostureDiff;
    existing: InstalledMcpRecord | undefined;
  }> {
    assertHashMatches(bundle);
    const existing = await this.get(bundle.name);
    let existingBundle: McpServerBundle | undefined;
    if (existing) existingBundle = await this.getBundle(bundle.name);
    return { diff: diffPostures(existingBundle, bundle), existing };
  }

  async install(bundle: McpServerBundle): Promise<InstalledMcpRecord> {
    assertHashMatches(bundle);

    // Signature policy.
    if (this.opts.requireSignature ?? true) {
      const verdict = verifyBundleSignature(bundle);
      if (!verdict.ok) {
        throw new Error(`MCP install blocked: signature invalid (${verdict.reason})`);
      }
    }

    // Install cap.
    const ledger = await this.list();
    const existingIdx = ledger.installed.findIndex((r) => r.name === bundle.name);
    if (existingIdx < 0) {
      const cap = this.opts.maxInstalledPerProject ?? DEFAULT_MAX_INSTALLED;
      if (ledger.installed.length >= cap) {
        throw new Error(
          `MCP install cap reached (${ledger.installed.length}/${cap}); uninstall before adding more`,
        );
      }
    }

    // Tool-namespace collision detection (excluding the bundle itself on update).
    await this.assertNoToolCollision(bundle, ledger, existingIdx);

    // Persist the bundle + ledger entry.
    const dir = this.bundleDir(bundle.name);
    await this.opts.fs.mkdir(dir, { recursive: true });
    await this.opts.fs.writeFile(this.bundlePath(bundle.name), JSON.stringify(bundle, null, 2));

    const existingRec = existingIdx >= 0 ? ledger.installed[existingIdx] : undefined;
    const now = new Date().toISOString();
    const record: InstalledMcpRecord = {
      name: bundle.name,
      version: bundle.version,
      contentHash: bundle.contentHash,
      ...(existingRec && { previousContentHash: existingRec.contentHash }),
      installedAt: existingRec?.installedAt ?? now,
      updatedAt: now,
      pinned: existingRec?.pinned ?? false,
      enabled: existingRec?.enabled ?? true,
      ...(bundle.signature?.signer && { signer: bundle.signature.signer }),
    };
    const updated: InstalledMcpRecord[] = [...ledger.installed];
    if (existingIdx >= 0) updated[existingIdx] = record;
    else updated.push(record);
    await this.writeLedger({ installed: updated });

    const { diff } = await this.previewInstall(bundle);
    await this.audit({
      kind: existingIdx >= 0 ? 'update' : 'install',
      name: bundle.name,
      version: bundle.version,
      contentHash: bundle.contentHash,
      diff,
      ...(bundle.signature?.signer && { signer: bundle.signature.signer }),
      at: now,
    });

    return record;
  }

  async pin(name: string): Promise<InstalledMcpRecord | undefined> {
    return this.patchRecord(name, (r) => ({ ...r, pinned: true }), 'pin');
  }

  async unpin(name: string): Promise<InstalledMcpRecord | undefined> {
    return this.patchRecord(name, (r) => ({ ...r, pinned: false }), 'unpin');
  }

  async setEnabled(name: string, enabled: boolean): Promise<InstalledMcpRecord | undefined> {
    return this.patchRecord(name, (r) => ({ ...r, enabled }), 'update');
  }

  /**
   * Rollback requires the caller to supply the PREVIOUS bundle (same as
   * skills-marketplace). Verifies that its hash matches the ledger's
   * previousContentHash before installing.
   */
  async rollback(
    name: string,
    previousBundle: McpServerBundle,
  ): Promise<InstalledMcpRecord | undefined> {
    const ledger = await this.list();
    const current = ledger.installed.find((r) => r.name === name);
    if (!current) return undefined;
    if (!current.previousContentHash) {
      throw new Error(`no previous version recorded for ${name}`);
    }
    assertHashMatches(previousBundle);
    if (previousBundle.contentHash !== current.previousContentHash) {
      throw new Error(
        `rollback bundle hash mismatch: expected=${current.previousContentHash} got=${previousBundle.contentHash}`,
      );
    }
    return this.install(previousBundle);
  }

  async uninstall(name: string): Promise<boolean> {
    const ledger = await this.list();
    const idx = ledger.installed.findIndex((r) => r.name === name);
    if (idx < 0) return false;
    const record = ledger.installed[idx]!;
    const dir = this.bundleDir(name);
    if (await this.opts.fs.exists(dir)) {
      await this.opts.fs.rm(dir, { recursive: true, force: true });
    }
    const updated = ledger.installed.slice();
    updated.splice(idx, 1);
    await this.writeLedger({ installed: updated });
    await this.audit({
      kind: 'uninstall',
      name: record.name,
      version: record.version,
      contentHash: record.contentHash,
      at: new Date().toISOString(),
    });
    return true;
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private ledgerPath(): string {
    return `${this.opts.rootDir}/${LEDGER_FILENAME}`;
  }

  private bundleDir(name: string): string {
    return `${this.opts.rootDir}/${name}`;
  }

  private bundlePath(name: string): string {
    return `${this.bundleDir(name)}/bundle.json`;
  }

  private async writeLedger(ledger: MarketplaceLedger): Promise<void> {
    await this.opts.fs.mkdir(this.opts.rootDir, { recursive: true });
    await this.opts.fs.writeFile(this.ledgerPath(), JSON.stringify(ledger, null, 2));
  }

  private async assertNoToolCollision(
    bundle: McpServerBundle,
    ledger: MarketplaceLedger,
    skipIndex: number,
  ): Promise<void> {
    const claimed = new Set(bundle.posture.tools);
    for (let i = 0; i < ledger.installed.length; i++) {
      if (i === skipIndex) continue;
      const other = ledger.installed[i]!;
      const otherBundle = await this.getBundle(other.name);
      if (!otherBundle || !other.enabled) continue;
      for (const tool of otherBundle.posture.tools) {
        if (claimed.has(tool)) {
          throw new Error(
            `tool name "${tool}" already claimed by installed server "${other.name}"`,
          );
        }
      }
    }
  }

  private async patchRecord(
    name: string,
    patch: (r: InstalledMcpRecord) => InstalledMcpRecord,
    kind: InstallerAuditEvent['kind'],
  ): Promise<InstalledMcpRecord | undefined> {
    const ledger = await this.list();
    const idx = ledger.installed.findIndex((r) => r.name === name);
    if (idx < 0) return undefined;
    const updated = ledger.installed.slice();
    updated[idx] = patch(ledger.installed[idx]!);
    await this.writeLedger({ installed: updated });
    await this.audit({
      kind,
      name: updated[idx]!.name,
      version: updated[idx]!.version,
      contentHash: updated[idx]!.contentHash,
      at: new Date().toISOString(),
    });
    return updated[idx];
  }

  private async audit(evt: InstallerAuditEvent): Promise<void> {
    if (!this.opts.onAudit) return;
    try {
      await this.opts.onAudit(evt);
    } catch {
      /* audit must never block install */
    }
  }
}
