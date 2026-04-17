/**
 * Quarantine helpers — given a list of tagged items (recall results,
 * connector items, memory entries), decide which are safe to feed into
 * prompts as-is, which must be spotlighted, and which must be dropped
 * entirely before they could influence the agent.
 *
 * Pairs with:
 *   - `spotlight.ts` for the spotlighting wrapping applied to quarantined
 *     items that are still retained.
 *   - `detector.ts` for advisory scanning; quarantined items with
 *     detections are logged but still rendered.
 */

import { isQuarantinedTrust, type TaggedFragment, type TrustLevel } from './types.js';

export interface QuarantineDecision<T> {
  readonly item: T;
  readonly keep: boolean;
  /** True when the item must be spotlighted; usually == quarantined. */
  readonly spotlight: boolean;
  readonly reason?: string;
}

export interface QuarantineOptions {
  /** Hide items at or below this trust. Default: drop nothing. */
  readonly dropAtOrBelow?: TrustLevel;
}

const TRUST_ORDER: Record<TrustLevel, number> = {
  untrusted: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export function quarantineItems<T extends { trust: TrustLevel }>(
  items: readonly T[],
  opts: QuarantineOptions = {},
): readonly QuarantineDecision<T>[] {
  const drop = opts.dropAtOrBelow ? TRUST_ORDER[opts.dropAtOrBelow] : -1;
  return items.map((item) => {
    const level = TRUST_ORDER[item.trust];
    if (level <= drop) {
      return {
        item,
        keep: false,
        spotlight: false,
        reason: `trust '${item.trust}' <= dropAtOrBelow '${opts.dropAtOrBelow}'`,
      };
    }
    return {
      item,
      keep: true,
      spotlight: isQuarantinedTrust(item.trust),
    };
  });
}

/**
 * Partition tagged fragments into "system-safe" (high/medium, fed inline
 * into system/user sections) and "quarantined" (low/untrusted, must be
 * spotlighted if retained). Drop-criteria are caller-controlled.
 */
export function partitionFragments(
  fragments: readonly TaggedFragment[],
  opts: QuarantineOptions = {},
): { readonly safe: readonly TaggedFragment[]; readonly quarantined: readonly TaggedFragment[] } {
  const drop = opts.dropAtOrBelow ? TRUST_ORDER[opts.dropAtOrBelow] : -1;
  const safe: TaggedFragment[] = [];
  const quarantined: TaggedFragment[] = [];
  for (const f of fragments) {
    const level = TRUST_ORDER[f.tag.trust];
    if (level <= drop) continue;
    if (isQuarantinedTrust(f.tag.trust)) quarantined.push(f);
    else safe.push(f);
  }
  return { safe, quarantined };
}
