import {
  resolvePlacementEffects,
  type Build, type ChassisSpec, type PlacedPart, type Rotation,
} from '@mechbattler/sim';

/** The instance id the preview part is fitted under; never persisted. */
const PREVIEW_INSTANCE_ID = '__placement-preview__';

/**
 * The facts line shown under a legal ghost: what this cell would actually give the
 * part, read from the sim's own placement resolution rather than restated here.
 *
 * Pure so the formatting can be tested without a ghost, a selection and a React
 * tree. It fits a preview copy of the part into the build and asks
 * `resolvePlacementEffects` -- the same call the part inspector makes for a fitted
 * part, so the preview cannot describe placement differently from the real thing.
 */
export function describePlacement(args: {
  chassis: ChassisSpec;
  build: Build;
  partId: string;
  origin: { x: number; y: number };
  rotation: Rotation;
  extras: Pick<PlacedPart, 'integrity' | 'modifiers' | 'variant'>;
}): string | null {
  const preview: PlacedPart = {
    instanceId: PREVIEW_INSTANCE_ID,
    partId: args.partId,
    origin: { ...args.origin },
    rotation: args.rotation,
    integrity: args.extras.integrity,
    modifiers: args.extras.modifiers,
    variant: args.extras.variant,
  };
  const previewBuild = { ...args.build, parts: [...args.build.parts, preview] };
  const effects = resolvePlacementEffects(args.chassis, previewBuild, PREVIEW_INSTANCE_ID);
  if (!effects) return null;

  const facts = [effects.regionNames.join(', ')];
  if (effects.location.weaponArcBonusDeg > 0) {
    facts.push(`+${effects.location.weaponArcBonusDeg}° location arc`);
  }
  if (effects.supportArcBonusDeg > 0) facts.push(`+${effects.supportArcBonusDeg}° support arc`);
  if (effects.passiveCoolingCellCount > 0) {
    facts.push(`${effects.passiveCoolingCellCount} exterior cooling ${effects.passiveCoolingCellCount === 1 ? 'cell' : 'cells'}`);
  }
  if (effects.effectiveHeatMultiplier > 1) facts.push(`heat ×${effects.effectiveHeatMultiplier.toFixed(2)}`);
  if (effects.portCellCount > 0) facts.push(`${effects.portCellCount} port ${effects.portCellCount === 1 ? 'socket' : 'sockets'}`);
  if (effects.stackAboveInstanceIds.length + effects.stackBelowInstanceIds.length > 0) facts.push('joins stack');
  return facts.filter(Boolean).join(' · ');
}
