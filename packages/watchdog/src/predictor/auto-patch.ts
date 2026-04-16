/**
 * AutoPatchRegistry — registry of (signature, fix) pairs for known issues.
 *
 * The watchdog feeds error/event signatures here; if any registered patch
 * matches, the patch's `apply()` runs. Patches are caller-supplied; this
 * package owns no domain knowledge of what to patch.
 *
 * Idempotency contract: each patch runs at most once per (signature, value)
 * tuple unless `cooldownMs` has elapsed since the last apply. This keeps a
 * recurring symptom from triggering the same patch in a tight loop.
 */

import { EventEmitter } from 'node:events';

export interface PatchDefinition {
  /** Stable identifier. */
  id: string;
  /** Human-readable description for logs / dashboards. */
  description: string;
  /** Returns true if `signal` matches this patch. */
  matches: (signal: PatchSignal) => boolean;
  /** Apply the fix. May throw — the registry captures the failure. */
  apply: (signal: PatchSignal) => Promise<void>;
  /** Per-patch cooldown in ms. Default 60_000. */
  cooldownMs?: number;
}

export interface PatchSignal {
  /** Origin tag for the signal (e.g. 'llm:anthropic', 'bridge:discord'). */
  source: string;
  /** Free-form payload — patch matchers inspect what they care about. */
  payload: unknown;
  /** Wall-clock when the signal was raised. Default: Date.now(). */
  at?: number;
}

export interface PatchApplyEvent {
  patchId: string;
  source: string;
  appliedAt: number;
  ok: boolean;
  error?: unknown;
}

const DEFAULT_COOLDOWN_MS = 60_000;

export class AutoPatchRegistry extends EventEmitter {
  private readonly patches: PatchDefinition[] = [];
  private readonly lastAppliedAt = new Map<string, number>();

  register(patch: PatchDefinition): void {
    if (this.patches.some((p) => p.id === patch.id)) {
      throw new Error(`Patch already registered: ${patch.id}`);
    }
    this.patches.push(patch);
  }

  unregister(id: string): boolean {
    const idx = this.patches.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    this.patches.splice(idx, 1);
    return true;
  }

  list(): readonly PatchDefinition[] {
    return [...this.patches];
  }

  /**
   * Test the signal against every registered patch. Each matching patch is
   * invoked (sequentially); cooldowns are respected per-patch. Returns the
   * apply events for the patches that ran (or were skipped due to cooldown).
   */
  async handle(signal: PatchSignal): Promise<readonly PatchApplyEvent[]> {
    const at = signal.at ?? Date.now();
    const events: PatchApplyEvent[] = [];
    for (const patch of this.patches) {
      if (!patch.matches(signal)) continue;
      const cooldownMs = patch.cooldownMs ?? DEFAULT_COOLDOWN_MS;
      const last = this.lastAppliedAt.get(patch.id);
      if (last !== undefined && at - last < cooldownMs) continue;
      this.lastAppliedAt.set(patch.id, at);
      let event: PatchApplyEvent;
      try {
        await patch.apply(signal);
        event = { patchId: patch.id, source: signal.source, appliedAt: at, ok: true };
      } catch (err) {
        event = {
          patchId: patch.id,
          source: signal.source,
          appliedAt: at,
          ok: false,
          error: err,
        };
      }
      events.push(event);
      this.emit('patch_applied', event);
    }
    return events;
  }

  /** Forget the cooldown history (e.g. after manual recovery). */
  reset(): void {
    this.lastAppliedAt.clear();
  }
}
