/**
 * Effective placement facts shared by combat, thermal simulation, and the
 * workshop inspector. UI code must report this result rather than recreating
 * spatial rules from catalog data.
 */
import { getPart } from './catalog.js';
import { getOccupiedCells } from './grid.js';
import {
  EXTERIOR_PASSIVE_K,
  buildSpatialOccupancy,
  exposedEquipmentTickets,
  isExteriorCell,
  isPortCell,
  spatialCellKey,
  type AttackDirection,
} from './spatial.js';
import type {
  Build,
  CellRef,
  ChassisLocationEffectSpec,
  ChassisSpec,
  PlacedPart,
} from './types.js';

export const ATTACK_DIRECTIONS: AttackDirection[] = ['front', 'rear', 'left', 'right'];

export interface AppliedLocationEffect extends ChassisLocationEffectSpec {
  zoneId: string;
}

export interface LocationEffectTotals {
  effects: AppliedLocationEffect[];
  weaponArcBonusDeg: number;
  weaponRangeMultiplier: number;
  heatMultiplier: number;
}

/**
 * Zone membership is a pure function of the chassis and where the part sits on
 * it — `partId`, `origin`, `rotation`, none of which is ever reassigned in place
 * (the workshop rebuilds `PlacedPart`s instead). A battle therefore recomputes
 * one unchanging answer for every weapon, on every frame, for the whole fight.
 *
 * It measured 40.7% of total CPU in `scripts/tank-vs-sniper.ts` under
 * `--cpu-prof` — the single largest cost in the sim, ahead of `Simulation.step`
 * at 5.9% — because `Combatant.weaponRangeMultiplier` and `weaponArcDeg` call it
 * per weapon per frame, and `estimateExpectedDps` calls it again for every option
 * the autopilot prices. Rebuilding a `Set` per zone per call is most of that.
 *
 * Two caches, both keyed on object identity so they invalidate exactly when the
 * workshop hands over new objects: the per-chassis zone cell sets (shared by
 * every part) and the per-part result. `integrity` is mutated in place during a
 * fight, but nothing here reads it, so the entry stays correct.
 */
const zoneCellCache = new WeakMap<ChassisSpec, { zoneId: string; effect: ChassisLocationEffectSpec; cells: Set<string> }[]>();
const resultCache = new WeakMap<ChassisSpec, WeakMap<PlacedPart, LocationEffectTotals>>();

function zonesFor(chassis: ChassisSpec) {
  let zones = zoneCellCache.get(chassis);
  if (!zones) {
    zones = (chassis.locationZones ?? []).map((zone) => ({
      zoneId: zone.id,
      effect: zone.effect,
      cells: new Set(zone.cells.map((cell) => spatialCellKey(chassis, cell))),
    }));
    zoneCellCache.set(chassis, zones);
  }
  return zones;
}

/**
 * Authored zones require the whole footprint. A large gun cannot touch one
 * articulated cell and claim that cell's bonus for the entire weapon.
 */
export function locationEffectsForPart(
  chassis: ChassisSpec,
  placed: PlacedPart,
): LocationEffectTotals {
  let byPart = resultCache.get(chassis);
  if (!byPart) resultCache.set(chassis, (byPart = new WeakMap()));
  const hit = byPart.get(placed);
  if (hit) return hit;

  const zones = zonesFor(chassis);
  const effects: AppliedLocationEffect[] = [];
  if (zones.length > 0) {
    const def = getPart(placed.partId);
    const occupied = getOccupiedCells(placed, def).map((cell) => spatialCellKey(chassis, cell));
    for (const zone of zones) {
      if (occupied.length > 0 && occupied.every((cell) => zone.cells.has(cell))) {
        effects.push({ ...zone.effect, zoneId: zone.zoneId });
      }
    }
  }
  const totals: LocationEffectTotals = {
    effects,
    weaponArcBonusDeg: effects.reduce((sum, effect) => sum + (effect.weaponArcBonusDeg ?? 0), 0),
    weaponRangeMultiplier: effects.reduce((mult, effect) => mult * (effect.weaponRangeMultiplier ?? 1), 1),
    heatMultiplier: effects.reduce((mult, effect) => mult * (effect.heatMultiplier ?? 1), 1),
  };
  byPart.set(placed, totals);
  return totals;
}

export interface PlacementCellEffects {
  cell: Required<CellRef>;
  exterior: boolean;
  port: boolean;
  passiveCoolingBlocked: boolean;
  /** Top-to-bottom installed instance order at this cell. */
  stackInstanceIds: string[];
}

export interface DirectionalPlacementExposure {
  /** Cells where this part is the first damageable layer. */
  directCellCount: number;
  /** Targetable cells where armour or another compatible layer is above it. */
  protectedCellCount: number;
}

export interface PlacementEffects {
  instanceId: string;
  regionNames: string[];
  cells: PlacementCellEffects[];
  exteriorCellCount: number;
  passiveCoolingCellCount: number;
  passiveCoolingKwPerC: number;
  portCellCount: number;
  location: LocationEffectTotals;
  armourHeatMultiplier: number;
  effectiveHeatMultiplier: number;
  stackAboveInstanceIds: string[];
  stackBelowInstanceIds: string[];
  supportArcBonusDeg: number;
  baseWeaponArcDeg: number | null;
  effectiveWeaponArcDeg: number | null;
  weaponRangeMultiplier: number;
  exposure: Record<AttackDirection, DirectionalPlacementExposure>;
}

/** Complete inspectable placement result for one fitted component. */
export function resolvePlacementEffects(
  chassis: ChassisSpec,
  build: Pick<Build, 'parts' | 'routes'>,
  instanceId: string,
  functional?: (candidateId: string) => boolean,
): PlacementEffects | null {
  const placed = build.parts.find((part) => part.instanceId === instanceId);
  if (!placed) return null;
  const isFunctional = functional ?? ((candidateId: string) =>
    (build.parts.find((part) => part.instanceId === candidateId)?.integrity ?? 0) > 0);
  const def = getPart(placed.partId);
  const occupancy = buildSpatialOccupancy(chassis, build);
  const occupied = occupancy.cellsByInstance.get(instanceId) ?? [];
  const stackAbove = new Set<string>();
  const stackBelow = new Set<string>();
  let armourHeatMultiplier = 1;
  let supportArcBonusDeg = 0;

  const cells = occupied.map((cell): PlacementCellEffects => {
    const stack = occupancy.stacksByCell.get(spatialCellKey(chassis, cell)) ?? [];
    const ownIndex = stack.findIndex((entry) => entry.instanceId === instanceId);
    const above = ownIndex < 0 ? [] : stack.slice(ownIndex + 1);
    const below = ownIndex < 0 ? [] : stack.slice(0, ownIndex);
    for (const entry of above) stackAbove.add(entry.instanceId);
    for (const entry of below) stackBelow.add(entry.instanceId);
    for (const entry of above) {
      if (!isFunctional(entry.instanceId)) continue;
      const candidate = getPart(entry.partId);
      if (candidate.spatial?.coveredHeatMultiplier !== undefined) {
        armourHeatMultiplier = Math.max(
          armourHeatMultiplier,
          candidate.spatial.coveredHeatMultiplier,
        );
      }
    }
    for (const entry of below) {
      if (!isFunctional(entry.instanceId)) continue;
      supportArcBonusDeg = Math.max(
        supportArcBonusDeg,
        getPart(entry.partId).spatial?.weaponArcBonusDeg ?? 0,
      );
    }
    const passiveCoolingBlocked = above.some((entry) =>
      isFunctional(entry.instanceId)
      && getPart(entry.partId).spatial?.blocksPassiveCooling === true);
    return {
      cell,
      exterior: isExteriorCell(chassis, cell),
      port: isPortCell(chassis, cell),
      passiveCoolingBlocked,
      stackInstanceIds: [...stack].reverse().map((entry) => entry.instanceId),
    };
  });

  const location = locationEffectsForPart(chassis, placed);
  const exposure = Object.fromEntries(ATTACK_DIRECTIONS.map((direction) => {
    let directCellCount = 0;
    let protectedCellCount = 0;
    for (const ticket of exposedEquipmentTickets(chassis, build, direction, isFunctional)) {
      const index = ticket.stackInstanceIds.indexOf(instanceId);
      if (index === 0) directCellCount += 1;
      else if (index > 0) protectedCellCount += 1;
    }
    return [direction, { directCellCount, protectedCellCount }];
  })) as Record<AttackDirection, DirectionalPlacementExposure>;
  const passiveCoolingCellCount = cells.filter((cell) => cell.exterior && !cell.passiveCoolingBlocked).length;
  const baseWeaponArcDeg = def.weapon?.mountArcDeg ?? null;

  return {
    instanceId,
    regionNames: [...new Set(occupied.map((cell) =>
      chassis.regions?.find((region) => region.id === cell.regionId)?.name ?? cell.regionId))],
    cells,
    exteriorCellCount: cells.filter((cell) => cell.exterior).length,
    passiveCoolingCellCount,
    passiveCoolingKwPerC: passiveCoolingCellCount * EXTERIOR_PASSIVE_K,
    portCellCount: cells.filter((cell) => cell.port).length,
    location,
    armourHeatMultiplier,
    effectiveHeatMultiplier: location.heatMultiplier * armourHeatMultiplier,
    stackAboveInstanceIds: [...stackAbove],
    stackBelowInstanceIds: [...stackBelow],
    supportArcBonusDeg,
    baseWeaponArcDeg,
    effectiveWeaponArcDeg: baseWeaponArcDeg === null
      ? null
      : Math.min(360, baseWeaponArcDeg + location.weaponArcBonusDeg + supportArcBonusDeg),
    weaponRangeMultiplier: location.weaponRangeMultiplier,
    exposure,
  };
}
