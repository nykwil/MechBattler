import { buildTierBudget, getPart, type Build } from '@mechbattler/sim';
import { START_BUDGET } from '../state/runState.js';

/**
 * Whether a part may be placed, and what placing it costs.
 *
 * These are the economy gates, and they are the reason the catalog cannot be used as
 * a scrap printer: once a run launches the catalog is reference-only, and new
 * equipment comes from owned bench salvage or a seeded scrapyard offer (docs/04 §1).
 *
 * Pure, so each gate can be tested. They were previously inline in a callback and
 * exercised only by placing parts through the UI in the right run phase.
 */
export type PlacementPermission =
  /** Free placement: sandbox, or wiring during prep. */
  | { kind: 'allow' }
  /** A bench part is one-of: it consumes its slot and disarms after placing. */
  | { kind: 'allow-from-bench'; benchIndex: number }
  | { kind: 'deny'; reason: 'over-tier-budget' | 'run-is-reference-only' };

export function placementPermission({
  partId, build, phase, pendingBench,
}: {
  partId: string;
  build: Build;
  phase: 'none' | 'prep' | 'active' | 'over';
  /** Bench part currently armed, if any. */
  pendingBench: { index: number; partId: string } | null;
}): PlacementPermission {
  // A bench part is owned salvage, so it is placeable in any phase.
  if (pendingBench && pendingBench.partId === partId) {
    return { kind: 'allow-from-bench', benchIndex: pendingBench.index };
  }

  if (phase === 'prep') {
    // Custom-frame outfitting (docs/04 §7): unlocked parts only, free but capped by
    // the tier budget. Wiring is exempt, as it is on the enemy ladder.
    const def = getPart(partId);
    if (def.isConduit || def.isHeatPipe) return { kind: 'allow' };
    return buildTierBudget(build) + def.tier > START_BUDGET
      ? { kind: 'deny', reason: 'over-tier-budget' }
      : { kind: 'allow' };
  }

  if (phase === 'active') return { kind: 'deny', reason: 'run-is-reference-only' };

  return { kind: 'allow' };
}
