/**
 * Grid placement, connectivity, and mass/CoG. See docs/01-chassis-grid-spec.md.
 */
import type { CellOffset, ChassisSpec, PartDef, PlacedPart, Rotation } from './types.js';
import { getPart } from './catalog.js';

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
export function getOccupiedCells(placed: PlacedPart, partDef: PartDef): { x: number; y: number }[] {
  const rotated = rotateShape(partDef.shape, placed.rotation);
  const minDx = Math.min(...rotated.map((c) => c.dx));
  const minDy = Math.min(...rotated.map((c) => c.dy));
  return rotated.map((c) => ({
    x: placed.origin.x + (c.dx - minDx),
    y: placed.origin.y + (c.dy - minDy),
  }));
}

function inMask(chassis: ChassisSpec, x: number, y: number): boolean {
  if (y < 0 || y >= chassis.height || x < 0 || x >= chassis.width) return false;
  return chassis.mask[y]?.[x] === true;
}

export function isPerimeterCell(chassis: ChassisSpec, x: number, y: number): boolean {
  if (!inMask(chassis, x, y)) return false;
  const neighbors: [number, number][] = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
  return neighbors.some(([nx, ny]) => !inMask(chassis, nx, ny));
}

const cellKey = (x: number, y: number) => `${x},${y}`;
function parseCellKey(key: string): [number, number] {
  const [xs, ys] = key.split(',');
  return [Number(xs), Number(ys)];
}

export interface PlacementError {
  reason: 'out-of-mask' | 'overlap' | 'perimeter-required' | 'core-occupied';
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

  if (partDef.perimeterOnly && !cells.every(({ x, y }) => isPerimeterCell(chassis, x, y))) {
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

const NEIGHBOR_DELTAS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Power connectivity. See docs/01-chassis-grid-spec.md §3:
 * a part is connected if edge-adjacent to a reactor, or edge-adjacent to a
 * conduit cell that has a conduit-path back to a reactor.
 */
export function computeConnectivity(
  parts: PlacedPart[],
): { connectedInstanceIds: Set<string>; energizedConduitCells: Set<string> } {
  const { byCell, cellsByInstance } = buildOccupancyMap(parts);

  const reactorCells = new Set<string>();
  const conduitCells = new Set<string>();
  for (const p of parts) {
    const def = getPart(p.partId);
    const cells = cellsByInstance.get(p.instanceId)!;
    if (def.category === 'reactor') for (const c of cells) reactorCells.add(cellKey(c.x, c.y));
    if (def.isConduit) for (const c of cells) conduitCells.add(cellKey(c.x, c.y));
  }

  // BFS through conduit cells starting from any conduit adjacent to a reactor cell.
  const energized = new Set<string>();
  const queue: string[] = [];
  for (const key of conduitCells) {
    const [x, y] = parseCellKey(key);
    for (const [dx, dy] of NEIGHBOR_DELTAS) {
      if (reactorCells.has(cellKey(x + dx, y + dy))) {
        if (!energized.has(key)) { energized.add(key); queue.push(key); }
        break;
      }
    }
  }
  while (queue.length > 0) {
    const key = queue.pop()!;
    const [x, y] = parseCellKey(key);
    for (const [dx, dy] of NEIGHBOR_DELTAS) {
      const nk = cellKey(x + dx, y + dy);
      if (conduitCells.has(nk) && !energized.has(nk)) {
        energized.add(nk);
        queue.push(nk);
      }
    }
  }

  // A part (any category) is connected if adjacent to a reactor cell or an energized conduit cell.
  const connected = new Set<string>();
  for (const p of parts) {
    const def = getPart(p.partId);
    if (def.category === 'reactor') { connected.add(p.instanceId); continue; }
    const cells = cellsByInstance.get(p.instanceId)!;
    outer: for (const c of cells) {
      for (const [dx, dy] of NEIGHBOR_DELTAS) {
        const nk = cellKey(c.x + dx, c.y + dy);
        if (reactorCells.has(nk) || energized.has(nk)) {
          connected.add(p.instanceId);
          break outer;
        }
      }
    }
  }
  void byCell;
  return { connectedInstanceIds: connected, energizedConduitCells: energized };
}

class DisjointSet {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    this.parent.set(x, root);
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export interface PowerNetwork {
  networkId: string;
  reactorInstanceIds: string[];
  memberInstanceIds: string[];
}

interface Backbone {
  /** Union-find over reactor+conduit CELLS (not instances), so chains of any length merge correctly. */
  dsu: DisjointSet;
  /** cellKey -> owning instanceId, for every reactor or conduit cell. */
  cellOwner: Map<string, string>;
  /** UF root -> the network it belongs to, only for roots that contain >=1 reactor cell. */
  networkByRoot: Map<string, PowerNetwork>;
}

function buildBackbone(parts: PlacedPart[]): Backbone {
  const { cellsByInstance } = buildOccupancyMap(parts);
  const dsu = new DisjointSet();
  const cellOwner = new Map<string, string>();

  for (const p of parts) {
    const def = getPart(p.partId);
    if (def.category !== 'reactor' && !def.isConduit) continue;
    const cells = cellsByInstance.get(p.instanceId)!;
    for (const c of cells) cellOwner.set(cellKey(c.x, c.y), p.instanceId);
    for (let i = 1; i < cells.length; i++) {
      dsu.union(cellKey(cells[0]!.x, cells[0]!.y), cellKey(cells[i]!.x, cells[i]!.y));
    }
  }
  for (const key of cellOwner.keys()) {
    const [x, y] = parseCellKey(key);
    for (const [dx, dy] of NEIGHBOR_DELTAS) {
      const nk = cellKey(x + dx, y + dy);
      if (cellOwner.has(nk)) dsu.union(key, nk);
    }
  }

  const networkByRoot = new Map<string, PowerNetwork>();
  for (const p of parts) {
    if (getPart(p.partId).category !== 'reactor') continue;
    const cells = cellsByInstance.get(p.instanceId)!;
    const root = dsu.find(cellKey(cells[0]!.x, cells[0]!.y));
    if (!networkByRoot.has(root)) {
      networkByRoot.set(root, { networkId: root, reactorInstanceIds: [], memberInstanceIds: [] });
    }
    networkByRoot.get(root)!.reactorInstanceIds.push(p.instanceId);
  }

  return { dsu, cellOwner, networkByRoot };
}

/** Which backbone network (if any) is adjacent to the given absolute cell. */
function findAdjacentNetwork(backbone: Backbone, x: number, y: number): PowerNetwork | null {
  for (const [dx, dy] of NEIGHBOR_DELTAS) {
    const nk = cellKey(x + dx, y + dy);
    if (!backbone.cellOwner.has(nk)) continue;
    const root = backbone.dsu.find(nk);
    const network = backbone.networkByRoot.get(root);
    if (network) return network;
  }
  return null;
}

/**
 * Groups parts into independent power networks. Two reactors are on the same
 * network if bridged by adjacency/conduits of any length; a part joins the
 * network of any reactor/energized-conduit cell it is edge-adjacent to. See
 * docs/01-chassis-grid-spec.md §3.
 */
export function computePowerNetworks(parts: PlacedPart[]): {
  networks: PowerNetwork[];
  unconnectedInstanceIds: string[];
} {
  const { cellsByInstance } = buildOccupancyMap(parts);
  const backbone = buildBackbone(parts);
  const unconnected: string[] = [];

  for (const p of parts) {
    if (getPart(p.partId).category === 'reactor') continue;
    const cells = cellsByInstance.get(p.instanceId)!;
    let joined: PowerNetwork | null = null;
    for (const c of cells) {
      joined = findAdjacentNetwork(backbone, c.x, c.y);
      if (joined) break;
    }
    if (joined) joined.memberInstanceIds.push(p.instanceId);
    else unconnected.push(p.instanceId);
  }

  return { networks: [...backbone.networkByRoot.values()], unconnectedInstanceIds: unconnected };
}

/**
 * The chassis core taps power at its cell like any other part (docs/01 §3),
 * but it is not a PlacedPart, so its connectivity is resolved separately:
 * connected if adjacent to a reactor cell or an energized conduit cell.
 * Returns the reactor network id it should draw from, if any.
 */
export function computeCoreNetwork(chassis: ChassisSpec, parts: PlacedPart[]): string | null {
  const backbone = buildBackbone(parts);
  const network = findAdjacentNetwork(backbone, chassis.coreCell.x, chassis.coreCell.y);
  return network?.networkId ?? null;
}

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

export function computeMassAndCoG(chassis: ChassisSpec, parts: PlacedPart[]): MassAndCoG {
  const structuralMassKg = chassis.ratedMassT * 1000 * 0.3;
  const center = { x: (chassis.width - 1) / 2, y: (chassis.height - 1) / 2 };
  const halfDiagonal = Math.hypot(chassis.width / 2, chassis.height / 2);

  let massKg = structuralMassKg;
  let momentX = structuralMassKg * center.x;
  let momentY = structuralMassKg * center.y;

  for (const p of parts) {
    const def = getPart(p.partId);
    const cells = getOccupiedCells(p, def);
    const perCellMass = def.massKg / cells.length;
    for (const c of cells) {
      massKg += perCellMass;
      momentX += perCellMass * c.x;
      momentY += perCellMass * c.y;
    }
  }

  const cog = massKg > 0 ? { x: momentX / massKg, y: momentY / massKg } : center;
  const offset = Math.hypot(cog.x - center.x, cog.y - center.y);
  return {
    totalMassT: massKg / 1000,
    cog,
    offsetFraction: halfDiagonal > 0 ? Math.min(1, offset / halfDiagonal) : 0,
  };
}
