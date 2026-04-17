/**
 * Replay a snapshot against a live page. Best-effort — the true rendered
 * DOM can't be recreated, but we can navigate, restore cookies, and wait
 * for structural readiness (by asserting the same `<title>` appears, or
 * that a specific a11y node is present).
 *
 * Time-travel trail: `replayTrail` steps through a chronological list,
 * applying each snapshot in turn.
 */

import type { ReplayOptions, ReplayResult, ReplayTarget, Snapshot } from './types.js';

const DEFAULT_WAIT = 10_000;

export async function replaySnapshot(
  snap: Snapshot,
  target: ReplayTarget,
  opts: ReplayOptions = {},
): Promise<ReplayResult> {
  const actions: string[] = [];
  const warnings: string[] = [];
  const navigate = opts.navigate ?? true;
  const restoreCookies = opts.restoreCookies ?? true;
  const waitTimeoutMs = opts.waitTimeoutMs ?? DEFAULT_WAIT;

  if (restoreCookies && snap.cookies.length > 0) {
    const cookies: Record<string, unknown>[] = snap.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      ...(c.expires !== undefined ? { expires: c.expires } : {}),
      ...(c.httpOnly !== undefined ? { httpOnly: c.httpOnly } : {}),
      ...(c.secure !== undefined ? { secure: c.secure } : {}),
      ...(c.sameSite !== undefined ? { sameSite: c.sameSite } : {}),
    }));
    try {
      await target.context.addCookies(cookies);
      actions.push(`addCookies(${cookies.length})`);
    } catch (err) {
      warnings.push(`addCookies failed: ${(err as Error).message}`);
    }
  }

  if (navigate) {
    try {
      await target.page.goto(snap.url, { timeout: waitTimeoutMs });
      actions.push(`goto(${snap.url})`);
    } catch (err) {
      warnings.push(`goto failed: ${(err as Error).message}`);
    }
  }

  // Structural readiness — wait until title matches, up to the timeout.
  // This is a soft assertion; we don't throw on mismatch, just warn.
  try {
    const startedAt = Date.now();
    let title = '';
    while (Date.now() - startedAt < waitTimeoutMs) {
      title = await target.page.title();
      if (title === snap.title) break;
      await target.page.waitForTimeout(100);
    }
    if (title !== snap.title) {
      warnings.push(`title mismatch after ${waitTimeoutMs}ms: "${title}" vs "${snap.title}"`);
    } else {
      actions.push(`title-matched`);
    }
  } catch (err) {
    warnings.push(`title check failed: ${(err as Error).message}`);
  }

  return { ok: warnings.length === 0, actions, warnings };
}

export async function replayTrail(
  snaps: readonly Snapshot[],
  target: ReplayTarget,
  opts: ReplayOptions = {},
): Promise<readonly ReplayResult[]> {
  const out: ReplayResult[] = [];
  for (const s of snaps) out.push(await replaySnapshot(s, target, opts));
  return out;
}
