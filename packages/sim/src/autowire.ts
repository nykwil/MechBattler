/**
 * Auto-wire baseline (docs/09 M4, docs/01 §9): lay a *functional* — not
 * optimal — conduit graph so every part that needs power reaches a reactor,
 * and the core taps power too. The player keeps every placement decision;
 * this only does the first wiring pass they could do by hand. Hand-routing
 * (shorter trunks, protected lines, freed cells) remains the optimization
 * game — docs/05 R1's routing-tedium mitigation.
 *
 * Deterministic: plain BFS over free mask cells, nearest target first.
 */
import type { Build, ChassisSpec, PlacedPart } from './types.js';
import { getPart } from './catalog.js';
import { buildOccupancyMap, computeConnectivity, computeCoreNetwork } from './grid.js';

const DELTAS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const key = (x: number, y: number) => `${x},${y}`;

export interface AutoWireResult {
  /** U-CON placements to add, in lay order. Empty when already fully wired. */
  conduits: PlacedPart[];
  /** Parts (or '__core__') that no free-cell path can reach — e.g. no reactor placed. */
  unreachableInstanceIds: string[];
}

function needsPower(partId: string): boolean {
  const def = getPart(partId);
  return Boolean(def.draw) || def.category === 'weapon' || def.category === 'capacitor';
}

export function autoWire(chassis: ChassisSpec, build: Build): AutoWireResult {
  const conduits: PlacedPart[] = [];
  const unreachable = new Set<string>();
  let wireN = 0;
  const existingIds = new Set(build.parts.map((p) => p.instanceId));
  const nextId = () => {
    let id = `wire-${++wireN}`;
    while (existingIds.has(id)) id = `wire-${++wireN}`;
    return id;
  };

  // Iterate: connect one still-unpowered target per pass over fresh
  // connectivity, so each laid trunk becomes backbone for the next target.
  for (let guard = 0; guard < 64; guard++) {
    const parts = [...build.parts, ...conduits];
    const { connectedInstanceIds, energizedConduitCells } = computeConnectivity(parts);
    const { cellsByInstance } = buildOccupancyMap(parts);

    // Backbone cells a new conduit can energize from: reactors + live conduits.
    const backbone = new Set<string>(energizedConduitCells);
    for (const p of parts) {
      if (getPart(p.partId).category !== 'reactor') continue;
      for (const c of cellsByInstance.get(p.instanceId)!) backbone.add(key(c.x, c.y));
    }

    // Free cells: on the mask, unoccupied, and not the reserved core cell.
    const occupied = new Set<string>();
    for (const cells of cellsByInstance.values()) for (const c of cells) occupied.add(key(c.x, c.y));
    const free = (x: number, y: number) =>
      Boolean(chassis.mask[y]?.[x]) && !occupied.has(key(x, y)) &&
      !(x === chassis.coreCell.x && y === chassis.coreCell.y);

    // Targets: unpowered consumers, plus the core when it has no tap.
    const targetCells = new Map<string, { x: number; y: number }[]>();
    for (const p of build.parts) {
      if (needsPower(p.partId) && !connectedInstanceIds.has(p.instanceId) && !unreachable.has(p.instanceId)) {
        targetCells.set(p.instanceId, cellsByInstance.get(p.instanceId)!);
      }
    }
    if (computeCoreNetwork(chassis, parts) === null && !unreachable.has('__core__') && backbone.size > 0) {
      targetCells.set('__core__', [chassis.coreCell]);
    }
    if (targetCells.size === 0) break;

    // BFS from every free cell adjacent to the backbone, fanning out through
    // free cells until one lands adjacent to any target; nearest target wins.
    const cameFrom = new Map<string, string | null>();
    const queue: string[] = [];
    for (const bk of [...backbone].sort()) {
      const [bx, by] = bk.split(',').map(Number) as [number, number];
      for (const [dx, dy] of DELTAS) {
        const nx = bx + dx;
        const ny = by + dy;
        if (free(nx, ny) && !cameFrom.has(key(nx, ny))) {
          cameFrom.set(key(nx, ny), null);
          queue.push(key(nx, ny));
        }
      }
    }
    const adjacentTarget = (x: number, y: number): string | null => {
      for (const [id, cells] of targetCells) {
        if (cells.some((c) => DELTAS.some(([dx, dy]) => c.x === x + dx && c.y === y + dy))) return id;
      }
      return null;
    };

    let hit: { cell: string; target: string } | null = null;
    for (let qi = 0; qi < queue.length && !hit; qi++) {
      const cur = queue[qi]!;
      const [x, y] = cur.split(',').map(Number) as [number, number];
      const target = adjacentTarget(x, y);
      if (target) { hit = { cell: cur, target }; break; }
      for (const [dx, dy] of DELTAS) {
        const nk = key(x + dx, y + dy);
        if (free(x + dx, y + dy) && !cameFrom.has(nk)) {
          cameFrom.set(nk, cur);
          queue.push(nk);
        }
      }
    }

    if (!hit) {
      // Nothing reachable this pass: every remaining target is walled off.
      for (const id of targetCells.keys()) unreachable.add(id);
      break;
    }
    for (let cell: string | null = hit.cell; cell !== null; cell = cameFrom.get(cell) ?? null) {
      const [x, y] = cell.split(',').map(Number) as [number, number];
      conduits.push({ instanceId: nextId(), partId: 'U-CON', origin: { x, y }, rotation: 0, integrity: 1 });
    }
  }

  return { conduits, unreachableInstanceIds: [...unreachable].sort() };
}

/** Convenience: the build with the auto-wire conduits applied. */
export function applyAutoWire(chassis: ChassisSpec, build: Build): { build: Build; result: AutoWireResult } {
  const result = autoWire(chassis, build);
  return {
    build: result.conduits.length === 0 ? build : { ...build, parts: [...build.parts, ...result.conduits] },
    result,
  };
}
