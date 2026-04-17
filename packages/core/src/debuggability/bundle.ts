/**
 * `hipp0 debug` bundle — collects environment + recent logs + config into
 * a redacted JSON payload suitable for pasting into a GitHub issue.
 *
 * The bundle contents are caller-supplied via a `BundleSource` — the CLI
 * wires real log readers + config + DB stats; tests pass stubs. The core
 * module only owns composition + redaction.
 *
 * No upload endpoint. Paste the output into an issue; the project hosts
 * no ingest infrastructure.
 */

import { redactJson, redactSecrets, type RedactionOptions } from './redactor.js';

export interface BundleSection {
  readonly name: string;
  /** Plain-text content (logs, stderr, system info). Redacted before emit. */
  readonly text?: string;
  /** Structured JSON (config, DB stats). redactJson walks keys + values. */
  readonly json?: unknown;
}

export interface BundleSource {
  sections(): Promise<readonly BundleSection[]>;
}

export interface BundleOptions {
  readonly source: BundleSource;
  readonly redaction?: RedactionOptions;
  readonly includeProcessInfo?: boolean;
  /** Override for tests. */
  readonly now?: () => string;
}

export interface DebugBundle {
  readonly createdAt: string;
  readonly processInfo?: {
    readonly nodeVersion: string;
    readonly platform: string;
    readonly arch: string;
  };
  readonly sections: readonly {
    readonly name: string;
    readonly text?: string;
    readonly json?: unknown;
  }[];
}

export async function buildDebugBundle(opts: BundleOptions): Promise<DebugBundle> {
  const now = opts.now ?? (() => new Date().toISOString());
  const redaction = opts.redaction ?? {};
  const raw = await opts.source.sections();
  const sections = raw.map((s) => {
    const out: { name: string; text?: string; json?: unknown } = { name: s.name };
    if (s.text !== undefined) out.text = redactSecrets(s.text, redaction);
    if (s.json !== undefined) out.json = redactJson(s.json, redaction);
    return out;
  });
  const bundle: DebugBundle = {
    createdAt: now(),
    sections,
  };
  if (opts.includeProcessInfo !== false) {
    return {
      ...bundle,
      processInfo: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    };
  }
  return bundle;
}

/** Serialize a bundle for paste into a GitHub issue. */
export function formatBundle(bundle: DebugBundle): string {
  return `<!-- hipp0 debug bundle ${bundle.createdAt} -->\n\n\`\`\`json\n${JSON.stringify(bundle, null, 2)}\n\`\`\`\n`;
}
