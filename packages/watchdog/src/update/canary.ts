/**
 * CanaryUpdater — runs the AtomicUpdater pipeline and then *holds* in a
 * monitored observation window before committing. During the window, a
 * caller-supplied `observe()` callback is polled at a configurable cadence;
 * if it ever throws, we rollback.
 *
 * For local-first single-process Hipp0 there's no traffic split — "canary"
 * here means "extended smoke + monitored observation before flipping the
 * version pointer", which is what the spec wants from the operator's view.
 */

import { AtomicUpdater, type AtomicUpdateOptions } from './atomic.js';
import type { UpdatePlanStage, UpdateResult } from './types.js';

export interface CanaryUpdateOptions extends AtomicUpdateOptions {
  /** Total observation window in ms after smoke succeeds. Default 60_000. */
  observeWindowMs?: number;
  /** Poll interval in ms. Default 10_000. */
  observeIntervalMs?: number;
  /** Probe; throws on failure. Default no-op. */
  observe?: () => Promise<void>;
}

export class CanaryUpdater {
  async run(opts: CanaryUpdateOptions): Promise<UpdateResult> {
    const observeWindowMs = opts.observeWindowMs ?? 60_000;
    const observeIntervalMs = opts.observeIntervalMs ?? 10_000;
    const observe = opts.observe ?? (async () => {});

    // Wrap commit so the observation window runs BEFORE the user's commit.
    const wrapped: AtomicUpdateOptions = {
      ...opts,
      commit: async () => {
        await runObservation(observe, observeWindowMs, observeIntervalMs);
        if (opts.commit) await opts.commit();
      },
    };

    const result = await new AtomicUpdater().run(wrapped);
    // Annotate the commit stage as 'observe' for clearer reporting.
    const commitStage = result.stages.find((s) => s.name === 'commit');
    if (commitStage) {
      const observeStage: UpdatePlanStage = {
        ...commitStage,
        name: 'observe',
      };
      result.stages.splice(result.stages.indexOf(commitStage), 0, observeStage);
    }
    return result;
  }
}

async function runObservation(
  observe: () => Promise<void>,
  windowMs: number,
  intervalMs: number,
): Promise<void> {
  const deadline = Date.now() + windowMs;
  // Always probe at least once (even if the window is shorter than the interval).
  await observe();
  while (Date.now() + intervalMs <= deadline) {
    await sleep(intervalMs);
    await observe();
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
