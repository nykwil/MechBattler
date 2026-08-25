/**
 * Shared spatial resolver for workshop, power/thermal systems, and combat.
 *
 * Regional cells use a common 2D workshop projection, but connectivity never
 * crosses a region seam unless an authored port joins two occupied endpoints.
 */
import type {
  Build,
  CellRef,
  ChassisSpec,
  EquipmentLayer,
  PartDef,
  PlacedPart,
  RouteCell,
  RouteKind,
} from './types.js';
import { getPart } from './catalog.js';
import { regionIdAt } from './chassis.js';
import { checkPlacement, getOccupiedCells, type PlacementError } from './grid.js';

export const ROUTE_MASS_KG: Record<RouteKind, number> = { wire: 15, coolant: 20 };
export const WIRE_CAPACITY_KW = 60;
export const COOLANT_CONDUCTANCE = 0.12;
export const EXTERIOR_PASSIVE_K = 0.01;

export type AttackDirection = 'front' | 'rear' | 'left' | 'right';

const LAYER_ORDER: Record<EquipmentLayer, number> = {
  support: 0,
  payload: 1,
  armour: 2,
};

export function equipmentLayer(def: PartDef): EquipmentLayer {
  return def.spatial?.layer ?? 'payload';
}

/** Levels a part occupies. Unauthored parts are one level. */
export function partHeight(def: PartDef): number {
  return def.spatial?.height ?? 1;
}

/** The ceiling this part imposes forward, or undefined if it imposes none. */
export function forwardClearance(def: PartDef): number | undefined {
  return def.spatial?.clearsForward;
}

export function resolveCellRef(chassis: ChassisSpec, cell: CellRef): Required<CellRef> {
  return {
    regionId: cell.regionId ?? regionIdAt(chassis, cell.x, cell.y) ?? 'body',
    x: cell.x,
    y: cell.y,
  };
}

export function spatialCellKey(chassis: ChassisSpec, cell: CellRef): string {
  const ref = resolveCellRef(chassis, cell);
  return `${ref.regionId}:${ref.x},${ref.y}`;
}

export function projectedCellKey(cell: Pick<CellRef, 'x' | 'y'>): string {
  return `${cell.x},${cell.y}`;
}

export function isPortCell(chassis: ChassisSpec, cell: CellRef): boolean {
  const key = spatialCellKey(chassis, cell);
  return (chassis.ports ?? []).some((port) =>
    spatialCellKey(chassis, port.a) === key || spatialCellKey(chassis, port.b) === key);
}

export function isExteriorCell(chassis: ChassisSpec, cell: CellRef): boolean {
  const ref = resolveCellRef(chassis, cell);
  const region = chassis.regions?.find((candidate) => candidate.id === ref.regionId);
  const mask = region?.mask ?? chassis.mask;
  if (!mask[ref.y]?.[ref.x]) return false;
  return ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(
    ([dx, dy]) => mask[ref.y + dy]?.[ref.x + dx] !== true,
  );
}

export interface SpatialOccupant {
  instanceId: string;
  partId: string;
  layer: EquipmentLayer;
}

export interface SpatialOccupancy {
  /** Region-aware cells, each ordered bottom to top. */
  stacksByCell: Map<string, SpatialOccupant[]>;
  /** Projected cells for the one-silhouette builder. */
  stacksByProjectedCell: Map<string, SpatialOccupant[]>;
  cellsByInstance: Map<string, Required<CellRef>[]>;
  routesByCell: Map<string, Set<RouteKind>>;
}

export function buildSpatialOccupancy(chassis: ChassisSpec, build: Pick<Build, 'parts' | 'routes'>): SpatialOccupancy {
  const stacksByCell = new Map<string, SpatialOccupant[]>();
  const stacksByProjectedCell = new Map<string, SpatialOccupant[]>();
  const cellsByInstance = new Map<string, Required<CellRef>[]>();
  const routesByCell = new Map<string, Set<RouteKind>>();

  for (const placed of build.parts) {
    const def = getPart(placed.partId);
    const cells = getOccupiedCells(placed, def).map((cell) => resolveCellRef(chassis, cell));
    cellsByInstance.set(placed.instanceId, cells);
    for (const cell of cells) {
      const occupant = { instanceId: placed.instanceId, partId: placed.partId, layer: equipmentLayer(def) };
      const key = spatialCellKey(chassis, cell);
      const projected = projectedCellKey(cell);
      const stack = stacksByCell.get(key) ?? [];
      stack.push(occupant);
      stack.sort((a, b) => LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer]);
      stacksByCell.set(key, stack);
      const projectedStack = stacksByProjectedCell.get(projected) ?? [];
      projectedStack.push(occupant);
      projectedStack.sort((a, b) => LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer]);
      stacksByProjectedCell.set(projected, projectedStack);
    }
  }

  for (const route of build.routes ?? []) {
    const key = spatialCellKey(chassis, route);
    const kinds = routesByCell.get(key) ?? new Set<RouteKind>();
    kinds.add(route.kind);
    routesByCell.set(key, kinds);
  }
  return { stacksByCell, stacksByProjectedCell, cellsByInstance, routesByCell };
}

export type SpatialPlacementReason =
  | 'out-of-region'
  | 'route-on-equipment'
  | 'duplicate-route'
  | 'incompatible-stack'
  | 'footprint-mismatch';

export interface SpatialPlacementError {
  reason: SpatialPlacementReason;
}

function sameCells(a: Required<CellRef>[], b: Required<CellRef>[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map((cell) => `${cell.regionId}:${cell.x},${cell.y}`));
  return b.every((cell) => keys.has(`${cell.regionId}:${cell.x},${cell.y}`));
}

/** Additional regional/routing/stack checks layered on top of legacy placement. */
export function checkSpatialPartPlacement(
  chassis: ChassisSpec,
  build: Pick<Build, 'parts' | 'routes'>,
  candidate: PlacedPart,
  candidateDef = getPart(candidate.partId),
): SpatialPlacementError | null {
  const occupancy = buildSpatialOccupancy(chassis, build);
  const cells = getOccupiedCells(candidate, candidateDef).map((cell) => resolveCellRef(chassis, cell));

  if (chassis.regions?.length) {
    const originRegionId = resolveCellRef(chassis, candidate.origin).regionId;
    const region = chassis.regions.find((entry) => entry.id === originRegionId);
    if (!region || cells.some((cell) => cell.regionId !== region.id || !region.mask[cell.y]?.[cell.x])) {
      return { reason: 'out-of-region' };
    }
  }
  const overlaps = new Map<string, PlacedPart>();
  for (const cell of cells) {
    const stack = occupancy.stacksByCell.get(spatialCellKey(chassis, cell)) ?? [];
    for (const item of stack) {
      const placed = build.parts.find((part) => part.instanceId === item.instanceId);
      if (placed && placed.instanceId !== candidate.instanceId) overlaps.set(placed.instanceId, placed);
    }
  }
  if (overlaps.size === 0) {
    // Armour is a cover layer, not free-standing structure. Payloads that can
    // optionally use a support remain legal on their own.
    return equipmentLayer(candidateDef) === 'armour'
      ? { reason: 'incompatible-stack' }
      : null;
  }
  const overlappedParts = [...overlaps.values()];
  const below = overlappedParts.sort((a, b) =>
    LAYER_ORDER[equipmentLayer(getPart(b.partId))] - LAYER_ORDER[equipmentLayer(getPart(a.partId))])[0]!;
  const belowDef = getPart(below.partId);
  if (overlappedParts.some((part) =>
    !sameCells(cells, occupancy.cellsByInstance.get(part.instanceId) ?? []))) {
    return { reason: 'footprint-mismatch' };
  }
  if (!(candidateDef.spatial?.stacksOn ?? []).includes(equipmentLayer(belowDef))) {
    return { reason: 'incompatible-stack' };
  }
  return null;
}

export function checkRoutePlacement(
  chassis: ChassisSpec,
  build: Pick<Build, 'parts' | 'routes'>,
  route: RouteCell,
): SpatialPlacementError | null {
  const ref = resolveCellRef(chassis, route);
  const region = chassis.regions?.find((entry) => entry.id === ref.regionId);
  if (region ? !region.mask[ref.y]?.[ref.x] : !chassis.mask[ref.y]?.[ref.x]) {
    return { reason: 'out-of-region' };
  }
  const occupancy = buildSpatialOccupancy(chassis, build);
  const key = spatialCellKey(chassis, ref);
  if (occupancy.stacksByCell.has(key)) return { reason: 'route-on-equipment' };
  if (occupancy.routesByCell.get(key)?.has(route.kind)) return { reason: 'duplicate-route' };
  return null;
}

export interface WholeBuildPlacementIssue {
  target: 'part' | 'route';
  instanceId?: string;
  route?: RouteCell;
  reason: SpatialPlacementReason | PlacementError['reason'] | 'duplicate-instance';
}

/**
 * Authoritative physical validation for templates, persistence, imports, and
 * the workshop. It deliberately exercises the same incremental placement
 * rules as a player building the mech rather than trusting final occupancy.
 */
export function validateWholeBuildPlacement(
  chassis: ChassisSpec,
  build: Pick<Build, 'parts' | 'routes'>,
): WholeBuildPlacementIssue[] {
  const issues: WholeBuildPlacementIssue[] = [];
  const placed: PlacedPart[] = [];
  const instanceIds = new Set<string>();
  const orderedParts = [...build.parts].sort((a, b) =>
    LAYER_ORDER[equipmentLayer(getPart(a.partId))]
    - LAYER_ORDER[equipmentLayer(getPart(b.partId))]);
  for (const part of orderedParts) {
    if (instanceIds.has(part.instanceId)) {
      issues.push({ target: 'part', instanceId: part.instanceId, reason: 'duplicate-instance' });
      continue;
    }
    instanceIds.add(part.instanceId);
    const def = getPart(part.partId);
    const base = checkPlacement(chassis, placed, part, def);
    const spatial = base && base.reason !== 'overlap'
      ? base
      : checkSpatialPartPlacement(chassis, { parts: placed, routes: build.routes }, part, def);
    if (spatial) {
      issues.push({ target: 'part', instanceId: part.instanceId, reason: spatial.reason });
    } else {
      placed.push(part);
    }
  }

  const routes: RouteCell[] = [];
  for (const route of build.routes ?? []) {
    const issue = checkRoutePlacement(chassis, { parts: placed, routes }, route);
    if (issue) issues.push({ target: 'route', route, reason: issue.reason });
    else routes.push(route);
  }
  return issues;
}

export interface ExposureTicket {
  kind: 'equipment';
  cell: Required<CellRef>;
  /** Top-to-bottom instance order at the visible cell. */
  stackInstanceIds: string[];
}

/**
 * One ticket per directionally exposed installed cell. A multi-cell part may
 * therefore contribute several tickets while still sharing one HP pool.
 */
export function exposedEquipmentTickets(
  chassis: ChassisSpec,
  build: Pick<Build, 'parts' | 'routes'>,
  direction: AttackDirection,
  functional: (instanceId: string) => boolean = () => true,
): ExposureTicket[] {
  const occupancy = buildSpatialOccupancy(chassis, build);
  const candidates: Array<{ cell: Required<CellRef>; stack: SpatialOccupant[] }> = [];
  for (const [key, stack] of occupancy.stacksByCell) {
    const live = stack.filter((entry) => functional(entry.instanceId));
    if (live.length === 0) continue;
    const [regionId, coords] = key.split(':');
    const [x, y] = coords!.split(',').map(Number);
    candidates.push({ cell: { regionId: regionId!, x: x!, y: y! }, stack: live });
  }

  const lanes = new Map<number, Array<(typeof candidates)[number]>>();
  for (const candidate of candidates) {
    const lane = direction === 'front' || direction === 'rear' ? candidate.cell.x : candidate.cell.y;
    const list = lanes.get(lane) ?? [];
    list.push(candidate);
    lanes.set(lane, list);
  }

  const tickets: ExposureTicket[] = [];
  for (const list of lanes.values()) {
    const depth = (candidate: (typeof candidates)[number]) =>
      direction === 'front' ? candidate.cell.y
        : direction === 'rear' ? -candidate.cell.y
          : direction === 'left' ? candidate.cell.x : -candidate.cell.x;
    const nearest = Math.min(...list.map(depth));
    for (const candidate of list.filter((entry) => depth(entry) === nearest)) {
      tickets.push({
        kind: 'equipment',
        cell: candidate.cell,
        stackInstanceIds: [...candidate.stack]
          .sort((a, b) => LAYER_ORDER[b.layer] - LAYER_ORDER[a.layer])
          .map((entry) => entry.instanceId),
      });
    }
  }
  return tickets;
}

export function routeMassKg(build: Pick<Build, 'routes'>): number {
  return (build.routes ?? []).reduce((sum, route) => sum + ROUTE_MASS_KG[route.kind], 0);
}
