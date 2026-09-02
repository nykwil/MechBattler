import type { PlacedPart } from '@mechbattler/sim';
import type { PartProvenance } from '@mechbattler/game';
import type { BenchPart } from '../state/runState.js';

/**
 * What detaching a part does to the run's part list.
 *
 * Two part lists exist and they are different kinds of thing. Outside a run the
 * list is the *garage*: unlocked part types, effectively infinite copies, so
 * lifting one off the plate costs nothing and stores nothing. Inside a run you
 * own *instances* — this Judge, at 62%, with cold-bore, off node 2's wreck — so
 * a part lifted off the plate has to go somewhere, and the only somewhere is the
 * run's part list.
 *
 * Detach used to hold the instance in a volatile editor cursor instead, which is
 * how an engine could be lifted off and then cease to exist: three separate taps
 * (Bus, Heat pipe, and a reload) cleared that cursor without stowing anything.
 * Moving it into the list at the moment of detach means there is no window in
 * which the part is owned by nothing.
 */
export type DetachPlan =
  /** Mid-run: the instance moves into the part list and lands at `index`. */
  | { kind: 'move'; entry: BenchPart; index: number }
  /** Nowhere to put it. Refusing is the only non-destructive answer. */
  | { kind: 'refused'; reason: 'list-full' }
  /** Outside a run there is no list and nothing to preserve. */
  | { kind: 'free' };

export function planDetach({
  placed, provenance, runActive, listUsed, listCap,
}: {
  placed: PlacedPart;
  provenance?: PartProvenance;
  runActive: boolean;
  /** Entries already in the run's part list. */
  listUsed: number;
  listCap: number;
}): DetachPlan {
  if (!runActive) return { kind: 'free' };
  if (listUsed >= listCap) return { kind: 'refused', reason: 'list-full' };
  return {
    kind: 'move',
    // Appended, so the arming index is the length before the append.
    index: listUsed,
    entry: {
      id: placed.instanceId,
      partId: placed.partId,
      integrity: placed.integrity,
      modifiers: placed.modifiers,
      variant: placed.variant,
      provenance,
    },
  };
}
