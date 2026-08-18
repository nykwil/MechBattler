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
import type { Build, ChassisSpec, PartDef, PlacedPart } from './types.js';
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

/** Placement-derived effects for one fitted instance. */
export interface InstanceEffects {
  /** Zone range bonus. Multiplies the whole falloff envelope. */
  weaponRangeMultiplier: number;
  /** Zone arc (whole-footprint, sums) plus support arc (per-cell, maxes). */
  weaponArcBonusDeg: number;
  /** Zone heat (whole-footprint, multiplies) times armour cover (per-cell, maxes). */
  heatMultiplier: number;
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
export const INSTANCE_KNOBS = {
  weaponRangeMultiplier: { bucket: 'mul', scope: 'whole-footprint', neutral: 1 },
  weaponArcBonusDeg: { bucket: 'sum', scope: 'whole-footprint', neutral: 0 },
  heatMultiplier: { bucket: 'mul', scope: 'whole-footprint', neutral: 1 },
} as const satisfies Record<keyof InstanceEffects, PlacementKnobSpec>;

export const MECH_KNOBS = {
  speedMultiplier: { bucket: 'max', scope: 'mech', neutral: 1 },
  fireControlLateralMult: { bucket: 'mul', scope: 'mech', neutral: 1 },
} as const satisfies Record<keyof MechEffects, PlacementKnobSpec>;

/**
 * The per-cell half of the two mixed-scope knobs. Both max, for the reason in
 * `EffectScope`: a bonus that came from under one cell must not be collected
 * once per cell.
 */
const PER_CELL_KNOBS = {
  supportArcBonusDeg: { bucket: 'max', scope: 'per-cell', neutral: 0 },
  armourHeatMultiplier: { bucket: 'max', scope: 'per-cell', neutral: 1 },
} as const satisfies Record<string, PlacementKnobSpec>;

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

  let speedMultiplier: number = MECH_KNOBS.speedMultiplier.neutral;
  let fireControlLateralMult: number = MECH_KNOBS.fireControlLateralMult.neutral;

  for (const placed of build.parts) {
    const def: PartDef = getPart(placed.partId);
    byInstance.set(placed.instanceId, resolveInstance(chassis, occupancy, placed, isActive));

    if (!isActive(placed.instanceId)) continue;
    // mech scope, max: a second Stride is insurance, not more speed.
    speedMultiplier = Math.max(speedMultiplier, def.speedMult ?? 1);
    // mech scope, mul: two targeting computers compound, and cost twice as much.
    fireControlLateralMult *= def.fireControlLateralMult ?? 1;
  }

  return { byInstance, mech: { speedMultiplier, fireControlLateralMult } };
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

  out.weaponArcBonusDeg += supportArc;
  out.heatMultiplier *= armourHeat;
  return out;
}
