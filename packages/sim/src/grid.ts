/**
 * Grid placement, connectivity, and mass/CoG. See docs/01-chassis-grid-spec.md.
 */
import type { CellOffset, CellRef, ChassisSpec, PartDef, PlacedPart, Rotation, RouteCell } from './types.js';
import { getPart } from './catalog.js';
import { STATIC_CTX, effectiveMults } from './modifiers.js';
import { dhypot } from './dmath.js';

export function rotateShape(shape: CellOffset[], rotation: Rotation): CellOffset[] {
  return shape.map(({ dx, dy }) => {
    switch (rotation) {
      case 0: return { dx, dy };
      case 90: return { dx: -dy, dy: dx };
      case 180: return { dx: -dx, dy: -dy };
      case 270: return { dx: dy, dy: -dx };
    }
  });
}

/** Absolute occupied cells for a placed part, normalized so the min corner sits at origin+offset. */
export function getOccupiedCells(placed: PlacedPart, partDef: PartDef): CellRef[] {
  const rotated = rotateShape(partDef.shape, placed.rotation);
  const minDx = Math.min(...rotated.map((c) => c.dx));
  const minDy = Math.min(...rotated.map((c) => c.dy));
  return rotated.map((c) => ({
    ...(placed.origin.regionId ? { regionId: placed.origin.regionId } : {}),
    x: placed.origin.x + (c.dx - minDx),
    y: placed.origin.y + (c.dy - minDy),
  }));
}

function inMask(chassis: ChassisSpec, x: number, y: number): boolean {
  if (y < 0 || y >= chassis.height || x < 0 || x >= chassis.width) return false;
  return chassis.mask[y]?.[x] === true;
}

export function isPerimeterCell(chassis: ChassisSpec, x: number, y: number, regionId?: string): boolean {
  const region = regionId ? chassis.regions?.find((candidate) => candidate.id === regionId) : undefined;
  const mask = region?.mask ?? chassis.mask;
  const inSelectedMask = (cx: number, cy: number) => mask[cy]?.[cx] === true;
  if (!inSelectedMask(x, y)) return false;
  const neighbors: [number, number][] = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
  return neighbors.some(([nx, ny]) => !inSelectedMask(nx, ny));
}

const cellKey = (x: number, y: number) => `${x},${y}`;

export interface PlacementError {
  reason:
    | 'out-of-mask' | 'overlap' | 'perimeter-required' | 'core-occupied'
    | 'out-of-region' | 'route-on-equipment' | 'duplicate-route'
    | 'incompatible-stack' | 'footprint-mismatch'
    | 'ceiling-exceeded' | 'blocks-firing-lane';
}

/** Checks whether `candidate` can legally be placed given the parts already on the chassis. */
export function checkPlacement(
  chassis: ChassisSpec,
  existing: PlacedPart[],
  candidate: PlacedPart,
  partDef: PartDef,
): PlacementError | null {
  const cells = getOccupiedCells(candidate, partDef);

  for (const { x, y } of cells) {
    if (!inMask(chassis, x, y)) return { reason: 'out-of-mask' };
    if (x === chassis.coreCell.x && y === chassis.coreCell.y) return { reason: 'core-occupied' };
  }

  const occupied = new Set<string>();
  for (const p of existing) {
    if (p.instanceId === candidate.instanceId) continue;
    for (const c of getOccupiedCells(p, getPart(p.partId))) occupied.add(cellKey(c.x, c.y));
  }
  for (const { x, y } of cells) {
    if (occupied.has(cellKey(x, y))) return { reason: 'overlap' };
  }

  if (partDef.perimeterOnly && !cells.every(({ regionId, x, y }) =>
    isPerimeterCell(chassis, x, y, regionId))) {
    return { reason: 'perimeter-required' };
  }

  return null;
}

export interface OccupancyEntry {
  instanceId: string;
  partId: string;
}

/** Map from "x,y" to the part occupying that cell, plus the reverse per-instance cell list. */
export function buildOccupancyMap(parts: PlacedPart[]): {
  byCell: Map<string, OccupancyEntry>;
  cellsByInstance: Map<string, { x: number; y: number }[]>;
} {
  const byCell = new Map<string, OccupancyEntry>();
  const cellsByInstance = new Map<string, { x: number; y: number }[]>();
  for (const p of parts) {
    const cells = getOccupiedCells(p, getPart(p.partId));
    cellsByInstance.set(p.instanceId, cells);
    for (const c of cells) byCell.set(cellKey(c.x, c.y), { instanceId: p.instanceId, partId: p.partId });
  }
  return { byCell, cellsByInstance };
}


/*
 * The pre-spatial power model lived here: computeConnectivity, buildBackbone,
 * findAdjacentNetwork, computePowerNetworks and computeCoreNetwork, plus the
 * PowerNetwork type. It walked raw grid adjacency and knew nothing about
 * regions, ports or wire capacity.
 *
 * Deleted Aug 2026. Every shipped chassis defines regions, so it had been
 * unreachable in production for some time -- but it was still consulted at
 * eight call sites behind a `usesSpatialSystems(...)` ternary, and two of those
 * had never been updated to branch at all. `adaptation.ts` asked it whether a
 * part it had just placed was powered, and the workshop's brownout lamp asked
 * it which parts were live, so both answered a question the sim resolves
 * differently. Keeping a second power model alive to serve saves nobody has is
 * not worth a class of bug that ships wrong answers to the player.
 *
 * `resolveSpatialPower` in spatialPower.ts is the model. `connectedInstanceIds`
 * is the front door for callers that only need the connected set.
 */

export interface MassAndCoG {
  totalMassT: number;
  cog: { x: number; y: number };
  /** 0 (centered) to 1 (at the edge), used for turn-rate penalty. See docs/03 §3. */
  offsetFraction: number;
}

/** docs/03-combat-spec.md §3: m_load = clamp(rated/actual, 0.4, 1.15). */
export function computeLoadFactor(chassis: ChassisSpec, actualMassT: number): number {
  const raw = chassis.ratedMassT / Math.max(actualMassT, 0.001);
  return Math.max(0.4, Math.min(1.15, raw));
}

export interface LoadScaledSpeeds {
  loadFactor: number;
  fwd: number;
  strafe: number;
  rev: number;
  turnRateDegS: number;
}

/**
 * The mass- and CoG-derated speed profile a build can actually achieve.
 * Shared by derivedStats.ts (workshop display) and simulation.ts
 * (locomotion power draw) so the two never drift apart -- see docs/03 §3.
 */
export function computeLoadScaledSpeeds(chassis: ChassisSpec, massAndCoG: MassAndCoG): LoadScaledSpeeds {
  const loadFactor = computeLoadFactor(chassis, massAndCoG.totalMassT);
  return {
    loadFactor,
    fwd: chassis.speedsMps.fwd * loadFactor,
    strafe: chassis.speedsMps.strafe * loadFactor,
    rev: chassis.speedsMps.rev * loadFactor,
    turnRateDegS: chassis.turnRateDegS * loadFactor * (1 - 0.5 * massAndCoG.offsetFraction),
  };
}

export function computeMassAndCoG(chassis: ChassisSpec, parts: PlacedPart[], routes: RouteCell[] = []): MassAndCoG {
  const structuralMassKg = chassis.ratedMassT * 1000 * 0.3;
  const center = { x: (chassis.width - 1) / 2, y: (chassis.height - 1) / 2 };
  const halfDiagonal = dhypot(chassis.width / 2, chassis.height / 2);

  let massKg = structuralMassKg;
  let momentX = structuralMassKg * center.x;
  let momentY = structuralMassKg * center.y;

  for (const p of parts) {
    const def = getPart(p.partId);
    const cells = getOccupiedCells(p, def);
    // Static mass modifiers (docs/04 §4b) scale the part's real mass.
    const perCellMass = (def.massKg * effectiveMults(p, STATIC_CTX).massKg) / cells.length;
    for (const c of cells) {
      massKg += perCellMass;
      momentX += perCellMass * c.x;
      momentY += perCellMass * c.y;
    }
  }
  for (const route of routes) {
    const routeMassKg = route.kind === 'wire' ? 15 : 20;
    massKg += routeMassKg;
    momentX += routeMassKg * route.x;
    momentY += routeMassKg * route.y;
  }

  const cog = massKg > 0 ? { x: momentX / massKg, y: momentY / massKg } : center;
  const offset = dhypot(cog.x - center.x, cog.y - center.y);
  return {
    totalMassT: massKg / 1000,
    cog,
    offsetFraction: halfDiagonal > 0 ? Math.min(1, offset / halfDiagonal) : 0,
  };
}
