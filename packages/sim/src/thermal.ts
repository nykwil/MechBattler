/**
 * Thermal model construction: per-cell temperature state and the conduction
 * edges between them. See docs/02-power-heat-spec.md §3.
 */
import type { Build, ChassisSpec, PlacedPart, RouteCell } from './types.js';
import { getPart } from './catalog.js';
import { getOccupiedCells, isPerimeterCell } from './grid.js';
import { STATIC_CTX, effectiveMults } from './modifiers.js';
import { COOLANT_CONDUCTANCE, buildSpatialOccupancy, equipmentLayer, isExteriorCell, spatialCellKey } from './spatial.js';
import { regionIdAt } from './chassis.js';

export const AMBIENT_C = 25;
export const CONDUCTION_K_NORMAL = 0.03;
export const CONDUCTION_K_PIPE = 0.12;
export const RADIATOR_K = 0.06;
export const RADIATOR_CAP_KW = 6;

export interface ThermalCell {
  key: string;
  x: number;
  y: number;
  instanceId: string;
  partId: string;
  tempC: number;
  thermalMassKjPerC: number;
  isPerimeter: boolean;
  isHeatPipe: boolean;
  isRadiator: boolean;
  regionId: string;
  isCoolant: boolean;
  passiveCoolingBlocked: boolean;
  /** Relative conductance of edges touching this cell. */
  conductanceMult: number;
}

export interface ThermalEdge {
  aKey: string;
  bKey: string;
  k: number;
}

export interface ThermalModel {
  cells: Map<string, ThermalCell>;
  edges: ThermalEdge[];
  cellKeysByInstance: Map<string, string[]>;
}

export interface ThermalPathResolution {
  radiatorLinkedCoolantCells: Set<string>;
  isolatedCoolantCells: Set<string>;
  radiatorLinkedInstanceIds: Set<string>;
}

const key = (x: number, y: number) => `${x},${y}`;

export const CORE_INSTANCE_ID = '__core__';

export function buildThermalModel(chassis: ChassisSpec, parts: PlacedPart[], routes: RouteCell[] = []): ThermalModel {
  const spatial = buildSpatialOccupancy(chassis, { parts, routes });
  const functionalIds = new Set(parts.filter((part) => part.integrity > 0).map((part) => part.instanceId));
  const disabledTransferIds = new Set(parts.filter((part) =>
    part.integrity <= 0 && getPart(part.partId).spatial?.transfersHeat === true)
    .map((part) => part.instanceId));
  const cells = new Map<string, ThermalCell>();
  const cellKeysByInstance = new Map<string, string[]>();

  // The core cell always exists and always has thermal mass, even though it
  // is not a placeable PlacedPart -- locomotion heat (see docs/02 §3) and
  // the core's own survival (relevant once the arena models core damage)
  // both need somewhere to live.
  {
    const coreKey = key(chassis.coreCell.x, chassis.coreCell.y);
    cells.set(coreKey, {
      key: coreKey,
      x: chassis.coreCell.x,
      y: chassis.coreCell.y,
      instanceId: CORE_INSTANCE_ID,
      partId: CORE_INSTANCE_ID,
      tempC: AMBIENT_C,
      thermalMassKjPerC: 2.0,
      isPerimeter: isPerimeterCell(chassis, chassis.coreCell.x, chassis.coreCell.y),
      isHeatPipe: false,
      isRadiator: false,
      regionId: chassis.coreCell.regionId ?? regionIdAt(chassis, chassis.coreCell.x, chassis.coreCell.y) ?? 'body',
      isCoolant: false,
      passiveCoolingBlocked: false,
      conductanceMult: 1,
    });
    cellKeysByInstance.set(CORE_INSTANCE_ID, [coreKey]);
  }

  for (const p of parts) {
    const def = getPart(p.partId);
    const cellCoords = getOccupiedCells(p, def);
    const keys: string[] = [];
    // Cold-soaked etc. (docs/04 §4): static thermal-mass multiplier.
    //
    // Default 1.0 -> 0.7, Aug 2026. The thermal band is specified up to
    // fire-hold at 115 C, shutdown at 130 and heat damage at 150, and none of
    // it was reachable: across 240 measured battles no template ever passed
    // 65 C, so the whole upper band was dead content and the `redline`
    // challenge — and the two parts it unlocks — could never be earned. Heat
    // was therefore not a tradeoff, it was a number on a readout.
    //
    // 0.7 is the value that satisfies every constraint at once. Peaks now
    // spread 40-79 C instead of 37-65, the genuinely hot builds (-9 to -10 kW)
    // reach 115 C sometimes while the solved ones (-1.6 to -3.1 kW) never do,
    // and `redline` is earnable. 0.5 and 0.3 discriminate harder but both kill
    // the gyrostabilized perk outright in the diversity stress — 0.5 took it
    // from +3 points to -14 — and a perk that is never worth taking is a
    // diversity loss traded for a diversity gain.
    const thermalMass = (def.thermalMassPerCell ?? 0.7) * effectiveMults(p, STATIC_CTX).thermalMass;
    for (const c of cellCoords) {
      const projected = key(c.x, c.y);
      const k = cells.has(projected) ? `${projected}#${p.instanceId}` : projected;
      const ref = { regionId: c.regionId, x: c.x, y: c.y };
      const stack = spatial.stacksByCell.get(spatialCellKey(chassis, ref)) ?? [];
      const ownLayer = equipmentLayer(def);
      const covered = ownLayer !== 'armour' && stack.some((entry) =>
        functionalIds.has(entry.instanceId)
        && entry.layer === 'armour'
        && getPart(entry.partId).spatial?.blocksPassiveCooling);
      keys.push(k);
      cells.set(k, {
        key: k,
        x: c.x,
        y: c.y,
        instanceId: p.instanceId,
        partId: p.partId,
        tempC: AMBIENT_C,
        thermalMassKjPerC: thermalMass,
        // Regional cells use their own boundary. The separated shoulder/body
        // projection must not make two visually distant cells shelter each
        // other merely because their legacy x/y coordinates touch.
        isPerimeter: isExteriorCell(chassis, ref),
        isHeatPipe: def.isHeatPipe === true,
        isRadiator: def.id === 'U-RAD',
        regionId: c.regionId ?? 'body',
        isCoolant: false,
        passiveCoolingBlocked: covered,
        conductanceMult: def.spatial?.thermalConductance ?? (def.isHeatPipe ? 4 : 1),
      });
    }
    cellKeysByInstance.set(p.instanceId, keys);
  }

  for (const route of routes.filter((entry) => entry.kind === 'coolant')) {
    const projected = key(route.x, route.y);
    const routeKey = cells.has(projected) ? `${projected}#__coolant__` : projected;
    cells.set(routeKey, {
      key: routeKey,
      x: route.x,
      y: route.y,
      instanceId: `__coolant__:${route.regionId ?? 'body'}:${route.x},${route.y}`,
      partId: '__coolant__',
      tempC: AMBIENT_C,
      thermalMassKjPerC: 1,
      isPerimeter: isExteriorCell(chassis, route),
      isHeatPipe: false,
      isRadiator: false,
      regionId: route.regionId ?? 'body',
      isCoolant: true,
      passiveCoolingBlocked: false,
      conductanceMult: COOLANT_CONDUCTANCE / CONDUCTION_K_NORMAL,
    });
  }

  // Static conduction multipliers (docs/04 §4b, e.g. Insulated mount): an
  // instance's modifier can dampen every edge touching its cells.
  const conductionByInstance = new Map<string, number>();
  for (const p of parts) {
    const mult = effectiveMults(p, STATIC_CTX).conduction;
    if (mult !== 1) conductionByInstance.set(p.instanceId, mult);
  }

  const edges: ThermalEdge[] = [];
  const allCells = [...cells.values()];
  for (let i = 0; i < allCells.length; i++) {
    const cell = allCells[i]!;
    for (let j = i + 1; j < allCells.length; j++) {
      const neighbor = allCells[j]!;
      if (disabledTransferIds.has(cell.instanceId) || disabledTransferIds.has(neighbor.instanceId)) continue;
      if (cell.regionId !== neighbor.regionId) continue;
      const distance = Math.abs(cell.x - neighbor.x) + Math.abs(cell.y - neighbor.y);
      if (distance > 1) continue;
      if (distance === 0 && cell.instanceId === neighbor.instanceId) continue;
      const base = CONDUCTION_K_NORMAL * Math.max(cell.conductanceMult, neighbor.conductanceMult);
      const k = base
        * (conductionByInstance.get(cell.instanceId) ?? 1)
        * (conductionByInstance.get(neighbor.instanceId) ?? 1);
      edges.push({ aKey: cell.key, bKey: neighbor.key, k });
    }
  }

  // Heat-pipe routes may occupy port endpoints and join directly across the
  // authored link. A thermal manifold remains a damageable alternative.
  for (const port of chassis.ports ?? []) {
    const endpoint = (ref: typeof port.a) => {
      const spatialKey = spatialCellKey(chassis, ref);
      if (spatial.routesByCell.get(spatialKey)?.has('coolant')) {
        const routeInstanceId = `__coolant__:${ref.regionId ?? 'body'}:${ref.x},${ref.y}`;
        return [...cells.values()].find((cell) => cell.instanceId === routeInstanceId) ?? null;
      }
      const stack = spatial.stacksByCell.get(spatialKey) ?? [];
      const occupant = [...stack].reverse().find((entry) =>
        functionalIds.has(entry.instanceId) && getPart(entry.partId).spatial?.transfersHeat);
      if (!occupant) return null;
      return [...cells.values()].find((cell) =>
        cell.instanceId === occupant.instanceId && cell.x === ref.x && cell.y === ref.y) ?? null;
    };
    const a = endpoint(port.a);
    const b = endpoint(port.b);
    if (a && b) {
      const k = CONDUCTION_K_NORMAL * Math.max(a.conductanceMult, b.conductanceMult);
      edges.push({ aKey: a.key, bKey: b.key, k });
    }
  }

  return { cells, edges, cellKeysByInstance };
}

/** Static thermal topology for workshop diagnostics; no temperatures guessed. */
export function resolveThermalPaths(
  chassis: ChassisSpec,
  build: Pick<Build, 'parts' | 'routes'>,
): ThermalPathResolution {
  const model = buildThermalModel(chassis, build.parts, build.routes);
  const adjacency = new Map<string, string[]>();
  for (const edge of model.edges) {
    adjacency.set(edge.aKey, [...(adjacency.get(edge.aKey) ?? []), edge.bKey]);
    adjacency.set(edge.bKey, [...(adjacency.get(edge.bKey) ?? []), edge.aKey]);
  }
  const radiatorLinkedCoolantCells = new Set<string>();
  const isolatedCoolantCells = new Set<string>();
  const radiatorLinkedInstanceIds = new Set<string>();
  const visited = new Set<string>();
  for (const start of model.cells.keys()) {
    if (visited.has(start)) continue;
    const component: ThermalCell[] = [];
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      component.push(model.cells.get(current)!);
      queue.push(...(adjacency.get(current) ?? []));
    }
    const linked = component.some((cell) => cell.isRadiator);
    for (const cell of component) {
      if (linked && !cell.isCoolant) radiatorLinkedInstanceIds.add(cell.instanceId);
      if (!cell.isCoolant) continue;
      const cellKey = `${cell.regionId}:${cell.x},${cell.y}`;
      (linked ? radiatorLinkedCoolantCells : isolatedCoolantCells).add(cellKey);
    }
  }
  return { radiatorLinkedCoolantCells, isolatedCoolantCells, radiatorLinkedInstanceIds };
}
