/**
 * `hipp0 debug` — emit a redacted bundle for pasting into a GitHub issue.
 *
 * The CLI wires a real BundleSource that reads:
 *   - package.json version
 *   - ~/.hipp0/config.json (redacted)
 *   - DB row counts (via memory package)
 *   - last N stderr lines (from the supplied log file)
 *
 * The core library handles composition + redaction. This CLI wrapper is
 * the injection point.
 */

import { debuggability } from '@openhipp0/core';
import { Hipp0CliError, type CommandResult } from '../types.js';

const { buildDebugBundle, formatBundle, listErrorCodes, formatErrorLine, describeError } = debuggability;

export interface DebugOptions {
  readonly source: debuggability.BundleSource;
  readonly now?: () => string;
}

export async function runDebugBundle(opts: DebugOptions): Promise<CommandResult> {
  const bundle = await buildDebugBundle({
    source: opts.source,
    ...(opts.now && { now: opts.now }),
  });
  return {
    exitCode: 0,
    stdout: [formatBundle(bundle)],
    data: { bundle },
  };
}

export async function runDebugErrorCodes(): Promise<CommandResult> {
  const codes = listErrorCodes();
  const lines = [`${codes.length} error code${codes.length === 1 ? '' : 's'} in registry:`];
  for (const meta of codes) {
    lines.push(`  ${meta.externalCode} [${meta.category}] ${meta.code}`);
    lines.push(`    cause: ${meta.cause}`);
    lines.push(`    fix:   ${meta.fix}`);
    lines.push(`    docs:  ${meta.docsUrl}`);
  }
  return { exitCode: 0, stdout: lines, data: { codes } };
}

export async function runDebugExplain(codeOrExternal: string): Promise<CommandResult> {
  const meta = describeError(codeOrExternal);
  if (!meta) {
    throw new Hipp0CliError(
      `No registry entry for "${codeOrExternal}". Run 'hipp0 debug codes' to list all.`,
      'HIPP0_CLI_DEBUG_UNKNOWN_CODE',
      1,
    );
  }
  return {
    exitCode: 0,
    stdout: [formatErrorLine(codeOrExternal)],
    data: { meta },
  };
}
