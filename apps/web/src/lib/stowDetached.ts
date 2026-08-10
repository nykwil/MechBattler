import type { BenchPart } from '../state/runState.js';

/**
 * Mid-run, a part lifted off the plate is still owned. Clearing the armed state
 * (Stow, Esc, picking something else) must park it on the bench — only a full
 * bench or free play may discard it. Pure so the gate can be tested without the
 * React tree; the loss path was Esc and select-other, which skipped addBench.
 */
export function stowPayloadFromDetached(args: {
  detached: { instanceId: string } | null;
  selectedPartId: string | null;
  placeExtras: Pick<BenchPart, 'integrity' | 'modifiers' | 'variant'>;
  provenance?: BenchPart['provenance'];
  runActive: boolean;
  benchUsed: number;
  benchCap: number;
}): BenchPart | null {
  if (!args.detached || !args.runActive || !args.selectedPartId) return null;
  if (args.benchUsed >= args.benchCap) return null;
  return {
    id: args.detached.instanceId,
    partId: args.selectedPartId,
    integrity: args.placeExtras.integrity,
    modifiers: args.placeExtras.modifiers,
    variant: args.placeExtras.variant,
    provenance: args.provenance,
  };
}
