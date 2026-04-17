/**
 * Error hierarchy for @openhipp0/browser. Every class carries a stable
 * `code` (matching `packages/core/src/debuggability/error-codes.ts`) and
 * `externalCode` (HIPP0-05xx).
 */

import type { ProfileBusyDiagnostic } from './profiles/types.js';

export class Hipp0BrowserError extends Error {
  readonly code: string;
  readonly externalCode: string;
  constructor(code: string, externalCode: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
    this.code = code;
    this.externalCode = externalCode;
  }
}

export class Hipp0BrowserProfileNotFoundError extends Hipp0BrowserError {
  constructor(id: string) {
    super(
      'HIPP0_BROWSER_PROFILE_NOT_FOUND',
      'HIPP0-0501',
      `No browser profile with id "${id}". Run \`hipp0 browser profile list\` to see valid ids.`,
    );
  }
}

export class Hipp0BrowserProfileBusyError extends Hipp0BrowserError {
  readonly diagnostic: ProfileBusyDiagnostic;
  constructor(diagnostic: ProfileBusyDiagnostic) {
    super(
      'HIPP0_BROWSER_PROFILE_BUSY',
      'HIPP0-0502',
      `Profile is already open by pid ${diagnostic.owningPid} (host ${diagnostic.host}, started ${diagnostic.sessionStartedAt}, lock=${diagnostic.lockStaleness}).`,
    );
    this.diagnostic = diagnostic;
  }
}

export class Hipp0BrowserNonInteractiveError extends Hipp0BrowserError {
  constructor() {
    super(
      'HIPP0_BROWSER_NON_INTERACTIVE',
      'HIPP0-0503',
      'Passphrase required but stdin/stdout is not a TTY. Set HIPP0_BROWSER_PASSPHRASE in the environment.',
    );
  }
}

export class Hipp0BrowserProfileCorruptError extends Hipp0BrowserError {
  constructor(detail: string, options?: { cause?: unknown }) {
    super(
      'HIPP0_BROWSER_PROFILE_CORRUPT',
      'HIPP0-0504',
      `Profile archive failed authentication: ${detail}. Wrong passphrase or the file has been tampered with.`,
      options,
    );
  }
}

export class Hipp0BrowserUncleanShutdownError extends Hipp0BrowserError {
  constructor(detail: string) {
    super('HIPP0_BROWSER_UNCLEAN_SHUTDOWN', 'HIPP0-0505', `Unclean shutdown detected: ${detail}`);
  }
}

export class Hipp0BrowserImportLimitationNotAckedError extends Hipp0BrowserError {
  constructor() {
    super(
      'HIPP0_BROWSER_IMPORT_LIMITATION_NOT_ACKED',
      'HIPP0-0506',
      'Chrome profile import requires acknowledging the OS-keyring cookie limitation. Pass `--accept-cookie-limitation` or confirm interactively. See docs/browser/profile-management.md#known-limitations.',
    );
  }
}
