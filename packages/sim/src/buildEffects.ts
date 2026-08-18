/**
 * One walk over everything that declares an effect, so the sim and every
 * instrument read the same numbers from the same place.
 *
 * Effects arrive from four directions -- a part's own catalog fields, its
 * `spatial` spec, the chassis zone it sits in, and its modifiers -- and the
 * first three used to be reduced wherever they happened to be needed. That is
 * how `weaponArcBonusDeg` came to be summed in `placementEffects.ts` and maxed
 * in `combat.ts`, and how the same heat multiplier came to stack three ways.
 *
 * Split by **when a value can change**, not by who declared it:
 *
 *  - static  chassis + partId/origin/rotation. Never changes during a fight,
 *            so it is cached on object identity (see `placementEffects.ts`).
 *  - gated   which instances are still contributing. Changes a handful of times
 *            per fight, so callers should resolve once per tick -- NOT per
 *            weapon per query, which is what made `locationEffectsForPart`
 *            40.7% of sim CPU before it was cached.
 *  - dynamic tempC/speed/tile. Genuinely per-tick, and per *hypothetical*: the
 *            autopilot prices candidate speeds, so it stays in `effectiveMults`
 *            with ctx as a parameter and is deliberately not resolved here.
 */
import type { Build, ChassisSpec, PlacedPart } from './types.js';
import { getPart } from './catalog.js';
import { buildSpatialOccupancy, spatialCellKey, type SpatialOccupancy } from './spatial.js';
import { locationEffectsForPart } from './placementEffects.js';

/**
 * How a placement-scoped knob combines, and over what.
 *
 * Scope is not decoration. A zone effect applies only when a part's *whole*
 * footprint is inside it (`locationEffectsForPart` requires `every`), so zone
 * sources cannot double-count and may safely sum. A support sits under
 * individual cells, so summing would scale the bonus with how many cells a part
 * happens to cover -- a 3-cell laser over two Gimbals would collect twice what
 * a 1-cell gun does. `max` is what stops that, and it is the same "redundancy
 * never stacks" rule `ModBuilder.best` carries.
 */
export type EffectScope = 'whole-footprint' | 'per-cell' | 'mech';
export type EffectBucket = 'mul' | 'sum' | 'max';

export interface PlacementKnobSpec {
  bucket: EffectBucket;
  scope: EffectScope;
  neutral: number;
}

/** The per-cell half of a mixed-scope knob, before it folds into the total. */
export interface PerCellEffects {
  /** Best arc-granting support under any of this part's cells. */
  supportArcBonusDeg: number;
  /** Worst heat penalty from armour covering any of this part's cells. */
  armourHeatMultiplier: number;
}

/** Placement-derived effects for one fitted instance. */
export interface InstanceEffects {
  /** Zone range bonus. Multiplies the whole falloff envelope. */
  weaponRangeMultiplier: number;
  /** Zone arc (whole-footprint, sums) plus support arc (per-cell, maxes). */
  weaponArcBonusDeg: number;
  /** Zone heat (whole-footprint, multiplies) times armour cover (per-cell, maxes). */
  heatMultiplier: number;
  /**
   * The per-cell contributions kept separate as well as folded in, because the
   * workshop inspector shows the player where an arc came from -- "90 + 25
   * location + 25 support". Reconstructing them by subtracting and dividing the
   * totals would work today and break the day a bucket changes, so they are
   * reported rather than inferred.
   */
  perCell: PerCellEffects;
}

/** Aggregates over every currently-contributing part. */
export interface MechEffects {
  /** Best single powered Stride. Copies are redundancy, never speed. */
  speedMultiplier: number;
  /** Product: a second targeting computer compounds, and costs twice as much. */
  fireControlLateralMult: number;
}

/**
 * The rule for each knob, stated once. Checked against the result types, so a
 * knob added to `InstanceEffects` or `MechEffects` without a declared bucket and
 * scope is a compile error -- the same guardrail `EFFECT_KNOBS` gives the
 * modifier substrate.
 */
/**
 * `perCell` is a breakdown of knobs already declared below, not a knob itself,
 * so it is the one field carved out of the exhaustiveness check -- by name, so
 * that a *new* field still fails to compile. Its own members are checked
 * against `PER_CELL_KNOBS` instead, which leaves both halves guarded.
 */
type ScalarInstanceKnob = Exclude<keyof InstanceEffects, 'perCell'>;

export const INSTANCE_KNOBS = {
  weaponRangeMultiplier: { bucket: 'mul', scope: 'whole-footprint', neutral: 1 },
  weaponArcBonusDeg: { bucket: 'sum', scope: 'whole-footprint', neutral: 0 },
  heatMultiplier: { bucket: 'mul', scope: 'whole-footprint', neutral: 1 },
} as const satisfies Record<ScalarInstanceKnob, PlacementKnobSpec>;

export const MECH_KNOBS = {
  speedMultiplier: { bucket: 'max', scope: 'mech', neutral: 1 },
  fireControlLateralMult: { bucket: 'mul', scope: 'mech', neutral: 1 },
} as const satisfies Record<keyof MechEffects, PlacementKnobSpec>;

/**
 * The per-cell half of the two mixed-scope knobs. Both max, for the reason in
 * `EffectScope`: a bonus that came from under one cell must not be collected
 * once per cell.
 */
export const PER_CELL_KNOBS = {
  supportArcBonusDeg: { bucket: 'max', scope: 'per-cell', neutral: 0 },
  armourHeatMultiplier: { bucket: 'max', scope: 'per-cell', neutral: 1 },
} as const satisfies Record<keyof PerCellEffects, PlacementKnobSpec>;

export interface BuildEffects {
  byInstance: Map<string, InstanceEffects>;
  mech: MechEffects;
}

/**
 * Occupancy is static for a fight but is rebuilt by several callers from
 * freshly-allocated `{ parts, routes }` literals. Keying on the build object
 * lets the stable callers (a `Combatant`'s `this.build`, a `Simulation`'s)
 * share one, and costs the literal-passers nothing.
 */
const occupancyCache = new WeakMap<ChassisSpec, WeakMap<object, SpatialOccupancy>>();

export function cachedOccupancy(
  chassis: ChassisSpec,
  build: Pick<Build, 'parts' | 'routes'>,
): SpatialOccupancy {
  let byBuild = occupancyCache.get(chassis);
  if (!byBuild) occupancyCache.set(chassis, (byBuild = new WeakMap()));
  const hit = byBuild.get(build);
  if (hit) return hit;
  const built = buildSpatialOccupancy(chassis, build);
  byBuild.set(build, built);
  return built;
}

const neutralInstance = (): InstanceEffects => ({
  weaponRangeMultiplier: INSTANCE_KNOBS.weaponRangeMultiplier.neutral,
  weaponArcBonusDeg: INSTANCE_KNOBS.weaponArcBonusDeg.neutral,
  heatMultiplier: INSTANCE_KNOBS.heatMultiplier.neutral,
  perCell: {
    supportArcBonusDeg: PER_CELL_KNOBS.supportArcBonusDeg.neutral,
    armourHeatMultiplier: PER_CELL_KNOBS.armourHeatMultiplier.neutral,
  },
});

/**
 * Resolve every declared effect for a build.
 *
 * `isActive` is the caller's gating, because callers legitimately differ: the
 * workshop asks "is it intact", a `Combatant` asks "is it intact AND neither
 * shed nor shut down", and `derivedStats` asks "is it wired up". Passing the
 * predicate keeps that a caller's decision instead of three separate walks.
 */
export function resolveBuildEffects(
  chassis: ChassisSpec,
  build: Pick<Build, 'parts' | 'routes'>,
  isActive: (instanceId: string) => boolean,
): BuildEffects {
  const occupancy = cachedOccupancy(chassis, build);
  const byInstance = new Map<string, InstanceEffects>();

  for (const placed of build.parts) {
    byInstance.set(placed.instanceId, resolveInstance(chassis, occupancy, placed, isActive));
  }

  return {
    byInstance,
    mech: {
      speedMultiplier: resolveSpeedMultiplier(build.parts, isActive),
      fireControlLateralMult: resolveFireControlLateralMult(build.parts, isActive),
    },
  };
}

/**
 * The two mech-scoped knobs are exposed one at a time as well as through
 * `resolveBuildEffects`, because their callers gate them differently and more
 * narrowly than anything else: `activeSpeeds` counts only boosters that are
 * *connected*, and both read shed/shutdown from a `SimSnapshot` rather than from
 * live runtime, so a shared predicate would silently apply one knob's gating to
 * the other. They are O(parts) and need no placement walk, so resolving a whole
 * build to reach one scalar would also be slower than the loop it replaced.
 *
 * The point of the registry survives either way: each rule is still written
 * once, here, and `resolveBuildEffects` calls these rather than repeating them.
 */

/** mech scope, max: a second Stride is insurance, not more speed. */
export function resolveSpeedMultiplier(
  parts: readonly PlacedPart[],
  isActive: (instanceId: string) => boolean,
): number {
  let out: number = MECH_KNOBS.speedMultiplier.neutral;
  for (const placed of parts) {
    if (!isActive(placed.instanceId)) continue;
    out = Math.max(out, getPart(placed.partId).speedMult ?? 1);
  }
  return out;
}

/** mech scope, mul: two targeting computers compound, and cost twice as much. */
export function resolveFireControlLateralMult(
  parts: readonly PlacedPart[],
  isActive: (instanceId: string) => boolean,
): number {
  let out: number = MECH_KNOBS.fireControlLateralMult.neutral;
  for (const placed of parts) {
    if (!isActive(placed.instanceId)) continue;
    out *= getPart(placed.partId).fireControlLateralMult ?? 1;
  }
  return out;
}

function resolveInstance(
  chassis: ChassisSpec,
  occupancy: SpatialOccupancy,
  placed: PlacedPart,
  isActive: (instanceId: string) => boolean,
): InstanceEffects {
  const zone = locationEffectsForPart(chassis, placed);
  const out = neutralInstance();

  // whole-footprint sources: the zone already required the entire footprint,
  // so these combine by their own bucket with no double-counting risk.
  out.weaponRangeMultiplier = zone.weaponRangeMultiplier;
  out.weaponArcBonusDeg = zone.weaponArcBonusDeg;
  out.heatMultiplier = zone.heatMultiplier;

  // per-cell sources: max across every cell, so a wide part collects no more
  // than a narrow one sitting on the same support.
  let supportArc: number = PER_CELL_KNOBS.supportArcBonusDeg.neutral;
  let armourHeat: number = PER_CELL_KNOBS.armourHeatMultiplier.neutral;
  for (const cell of occupancy.cellsByInstance.get(placed.instanceId) ?? []) {
    const stack = occupancy.stacksByCell.get(spatialCellKey(chassis, cell)) ?? [];
    const ownIndex = stack.findIndex((entry) => entry.instanceId === placed.instanceId);
    if (ownIndex < 0) continue;
    for (const entry of stack.slice(0, ownIndex)) {
      if (!isActive(entry.instanceId)) continue;
      supportArc = Math.max(supportArc, getPart(entry.partId).spatial?.weaponArcBonusDeg ?? 0);
    }
    for (const entry of stack.slice(ownIndex + 1)) {
      if (!isActive(entry.instanceId)) continue;
      armourHeat = Math.max(armourHeat, getPart(entry.partId).spatial?.coveredHeatMultiplier ?? 1);
    }
  }

  out.perCell.supportArcBonusDeg = supportArc;
  out.perCell.armourHeatMultiplier = armourHeat;
  out.weaponArcBonusDeg += supportArc;
  out.heatMultiplier *= armourHeat;
  return out;
}
