/**
 * `hipp0 browser profile <subcommand>` — manage encrypted browser profiles.
 *
 * Subcommands: create · list · delete · status · import (from chrome) ·
 * export · import-bundle.
 *
 * The passphrase source layers: HIPP0_BROWSER_PASSPHRASE env, then
 * interactive TTY prompt, else hard-fail with HIPP0-0503.
 */

import {
  cookieLimitationWarning,
  createProfileManager,
  defaultProfilesDir,
  exportProfile,
  Hipp0BrowserError,
  Hipp0BrowserNonInteractiveError,
  importBundle,
  importFromChrome,
  ProfileManager,
  type Platform,
  type PassphraseProvider,
  type ProfileId,
} from '@openhipp0/browser';

import { Hipp0CliError, type CommandResult } from '../types.js';

export interface BrowserProfileDeps {
  /** Override manager (tests). */
  readonly manager?: ProfileManager;
  /** Passphrase provider override (tests). */
  readonly passphrase?: PassphraseProvider;
  /** Platform override (tests). */
  readonly platform?: Platform;
  /** Env override (tests). */
  readonly env?: NodeJS.ProcessEnv;
  /** Override TTY detection (tests pass `false` to simulate non-interactive). */
  readonly isTty?: boolean;
}

function buildManager(deps: BrowserProfileDeps): ProfileManager {
  if (deps.manager) return deps.manager;
  return createProfileManager({
    root: defaultProfilesDir(deps.env),
    ...(deps.platform ? { platform: deps.platform } : {}),
    ...(deps.env ? { env: deps.env } : {}),
  });
}

function resolvePassphrase(deps: BrowserProfileDeps): PassphraseProvider {
  if (deps.passphrase !== undefined) return deps.passphrase;
  const envPass = (deps.env ?? process.env)['HIPP0_BROWSER_PASSPHRASE'];
  if (envPass && envPass.length > 0) return envPass;
  const tty = deps.isTty ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!tty) throw new Hipp0BrowserNonInteractiveError();
  // Lazy: hard-fail when no env + non-interactive. Interactive prompt lands
  // in G1-a+1 alongside OS-keyring support (BFW-002). Until then, env is
  // required in production — CI/agents use env; operators invoke shell
  // export.
  throw new Hipp0BrowserNonInteractiveError();
}

// ─── create ──────────────────────────────────────────────────────────────────

export interface RunCreateOpts extends BrowserProfileDeps {
  readonly label: string;
  readonly tags?: readonly string[];
  readonly notes?: string;
}

export async function runBrowserProfileCreate(opts: RunCreateOpts): Promise<CommandResult> {
  try {
    const mgr = buildManager(opts);
    const profile = await mgr.create({
      label: opts.label,
      ...(opts.tags ? { tags: [...opts.tags] } : {}),
      ...(opts.notes ? { notes: opts.notes } : {}),
      passphrase: resolvePassphrase(opts),
    });
    return {
      exitCode: 0,
      stdout: [`created profile ${profile.id} ("${profile.label}")`],
      data: { profile },
    };
  } catch (err) {
    return toCommandFailure(err);
  }
}

// ─── list ────────────────────────────────────────────────────────────────────

export async function runBrowserProfileList(opts: BrowserProfileDeps): Promise<CommandResult> {
  try {
    const mgr = buildManager(opts);
    const profiles = await mgr.list();
    if (profiles.length === 0) return { exitCode: 0, stdout: ['no profiles'], data: { profiles: [] } };
    const lines = profiles.map((p) => {
      const lastOpen = p.lastOpenedAt ?? '—';
      return `  ${p.id}  ${p.label.padEnd(24)}  lastOpen=${lastOpen}`;
    });
    return { exitCode: 0, stdout: [`${profiles.length} profile(s):`, ...lines], data: { profiles } };
  } catch (err) {
    return toCommandFailure(err);
  }
}

// ─── delete ──────────────────────────────────────────────────────────────────

export interface RunDeleteOpts extends BrowserProfileDeps {
  readonly id: ProfileId;
}

export async function runBrowserProfileDelete(opts: RunDeleteOpts): Promise<CommandResult> {
  try {
    const mgr = buildManager(opts);
    await mgr.delete(opts.id);
    return { exitCode: 0, stdout: [`deleted profile ${opts.id}`] };
  } catch (err) {
    return toCommandFailure(err);
  }
}

// ─── status ──────────────────────────────────────────────────────────────────

export interface RunStatusOpts extends BrowserProfileDeps {
  readonly id: ProfileId;
}

export async function runBrowserProfileStatus(opts: RunStatusOpts): Promise<CommandResult> {
  try {
    const mgr = buildManager(opts);
    const status = await mgr.status(opts.id);
    const lines: string[] = [];
    if (status.state === 'not_found') {
      lines.push(`profile ${opts.id}: not found`);
    } else if (status.state === 'closed') {
      lines.push(`profile ${opts.id}: closed`);
    } else {
      const d = status.diagnostic;
      lines.push(
        `profile ${opts.id}: OPEN`,
        `  owningPid=${d.owningPid} host=${d.host}`,
        `  startedAt=${d.sessionStartedAt}`,
        `  lockStaleness=${d.lockStaleness}`,
        `  options=${d.resolutionOptions.join(',')}`,
      );
    }
    return { exitCode: 0, stdout: lines, data: { status } };
  } catch (err) {
    return toCommandFailure(err);
  }
}

// ─── import (from chrome) ────────────────────────────────────────────────────

export interface RunImportChromeOpts extends BrowserProfileDeps {
  readonly label: string;
  readonly sourceDir?: string;
  readonly profileName?: string;
  readonly acceptCookieLimitation: boolean;
}

export async function runBrowserProfileImportChrome(
  opts: RunImportChromeOpts,
): Promise<CommandResult> {
  try {
    const mgr = buildManager(opts);
    const platform = opts.platform ?? (process.platform as Platform);
    if (!opts.acceptCookieLimitation) {
      // Surface the explicit warning so operators who invoked without the
      // flag see what they'd be agreeing to.
      return {
        exitCode: 2,
        stderr: [cookieLimitationWarning(platform), 'Re-run with --accept-cookie-limitation to proceed.'],
      };
    }
    const profile = await importFromChrome({
      manager: mgr,
      label: opts.label,
      passphrase: resolvePassphrase(opts),
      acceptCookieLimitation: true,
      ...(opts.sourceDir ? { sourceDir: opts.sourceDir } : {}),
      ...(opts.profileName ? { profileName: opts.profileName } : {}),
      ...(opts.platform ? { platform: opts.platform } : {}),
      ...(opts.env ? { env: opts.env } : {}),
    });
    return {
      exitCode: 0,
      stdout: [`imported profile ${profile.id} ("${profile.label}")`, cookieLimitationWarning(platform)],
      data: { profile },
    };
  } catch (err) {
    return toCommandFailure(err);
  }
}

// ─── export (to bundle) ──────────────────────────────────────────────────────

export interface RunExportOpts extends BrowserProfileDeps {
  readonly id: ProfileId;
  readonly outFile: string;
  readonly recipientPassphrase?: string;
}

export async function runBrowserProfileExport(opts: RunExportOpts): Promise<CommandResult> {
  try {
    const mgr = buildManager(opts);
    const sourcePass = await passphraseToString(resolvePassphrase(opts));
    const result = await exportProfile({
      manager: mgr,
      id: opts.id,
      outFile: opts.outFile,
      sourcePassphrase: sourcePass,
      ...(opts.recipientPassphrase ? { recipientPassphrase: opts.recipientPassphrase } : {}),
    });
    const lines = [`exported ${opts.id} → ${result.outFile}`];
    if (result.generatedPassphrase) {
      lines.push(`generated recipient passphrase: ${result.generatedPassphrase}`);
      lines.push('(share over a secure channel; the recipient needs this to import)');
    }
    return { exitCode: 0, stdout: lines, data: { result } };
  } catch (err) {
    return toCommandFailure(err);
  }
}

// ─── import-bundle ───────────────────────────────────────────────────────────

export interface RunImportBundleOpts extends BrowserProfileDeps {
  readonly inFile: string;
  readonly recipientPassphrase: string;
  readonly label: string;
}

export async function runBrowserProfileImportBundle(
  opts: RunImportBundleOpts,
): Promise<CommandResult> {
  try {
    const mgr = buildManager(opts);
    const localPass = await passphraseToString(resolvePassphrase(opts));
    const profile = await importBundle({
      manager: mgr,
      inFile: opts.inFile,
      recipientPassphrase: opts.recipientPassphrase,
      label: opts.label,
      localPassphrase: localPass,
    });
    return {
      exitCode: 0,
      stdout: [`imported bundle → profile ${profile.id} ("${profile.label}")`],
      data: { profile },
    };
  } catch (err) {
    return toCommandFailure(err);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function passphraseToString(p: PassphraseProvider): Promise<string> {
  return typeof p === 'string' ? p : await p();
}

function toCommandFailure(err: unknown): CommandResult {
  if (err instanceof Hipp0BrowserError) {
    return {
      exitCode: 1,
      stderr: [`${err.externalCode} ${err.code}: ${err.message}`],
      data: { error: { code: err.code, externalCode: err.externalCode } },
    };
  }
  if (err instanceof Hipp0CliError) {
    return { exitCode: err.exitCode, stderr: [err.message] };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { exitCode: 1, stderr: [message] };
}
