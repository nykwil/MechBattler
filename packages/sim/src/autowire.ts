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
import type { Build, ChassisSpec, PlacedPart, RouteCell } from './types.js';
import { getPart, requiresPowerConnection } from './catalog.js';
import { buildSpatialOccupancy, spatialCellKey } from './spatial.js';
import { resolveSpatialPower } from './spatialPower.js';
import { regionIdAt } from './chassis.js';

const DELTAS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export interface AutoWireResult {
  /** U-CON placements to add, in lay order. Empty when already fully wired. */
  conduits: PlacedPart[];
  /** Bus cells to add for a regional spatial build. */
  routes: RouteCell[];
  /** Parts (or '__core__') that no free-cell path can reach — e.g. no reactor placed. */
  unreachableInstanceIds: string[];
}

function autoWireSpatial(chassis: ChassisSpec, build: Build): AutoWireResult {
  const addedRoutes: RouteCell[] = [];
  const unreachable = new Set<string>();
  const partNeedsPower = (part: PlacedPart) => requiresPowerConnection(getPart(part.partId));
  const regions = chassis.regions ?? [{
    id: 'body', name: 'Body', width: chassis.width, height: chassis.height, mask: chassis.mask,
  }];

  for (let guard = 0; guard < 64; guard += 1) {
    const current: Build = {
      ...build,
      routes: [...(build.routes ?? []), ...addedRoutes],
    };
    const resolution = resolveSpatialPower(chassis, current);
    const targets = current.parts
      .filter((part) => partNeedsPower(part) && !resolution.connectedInstanceIds.has(part.instanceId)
        && !unreachable.has(part.instanceId))
      .map((part) => part.instanceId);
    if (resolution.coreNetworkId === null && !unreachable.has('__core__')) targets.push('__core__');
    if (targets.length === 0) break;
    if (!current.parts.some((part) => getPart(part.partId).category === 'reactor')) {
      for (const target of targets) unreachable.add(target);
      break;
    }

    const occupancy = buildSpatialOccupancy(chassis, current);
    const free = new Map<string, RouteCell>();
    for (const region of regions) {
      for (let y = 0; y < region.height; y += 1) {
        for (let x = 0; x < region.width; x += 1) {
          if (!region.mask[y]?.[x]) continue;
          const cell: RouteCell = { kind: 'wire', regionId: region.id, x, y };
          const cellKey = spatialCellKey(chassis, cell);
          if (occupancy.stacksByCell.has(cellKey)) continue;
          if (region.id === (chassis.coreCell.regionId ?? regionIdAt(chassis, chassis.coreCell.x, chassis.coreCell.y) ?? 'body')
            && x === chassis.coreCell.x && y === chassis.coreCell.y) continue;
          free.set(cellKey, cell);
        }
      }
    }

    const adjacentKeys = (cell: RouteCell): string[] => {
      const keys: string[] = [];
      for (const [dx, dy] of DELTAS) {
        const candidate = spatialCellKey(chassis, {
          regionId: cell.regionId, x: cell.x + dx, y: cell.y + dy,
        });
        if (free.has(candidate)) keys.push(candidate);
      }
      const ownKey = spatialCellKey(chassis, cell);
      for (const port of chassis.ports ?? []) {
        const aKey = spatialCellKey(chassis, port.a);
        const bKey = spatialCellKey(chassis, port.b);
        const other = ownKey === aKey ? bKey : ownKey === bKey ? aKey : null;
        if (other && free.has(other)) keys.push(other);
      }
      return keys;
    };

    const terminalTouches = (cellKey: string, instanceIds: Set<string>, core: boolean): boolean => {
      const cell = free.get(cellKey)!;
      const touchesRef = (ref: { regionId?: string; x: number; y: number }) => {
        const key = spatialCellKey(chassis, ref);
        if ((occupancy.stacksByCell.get(key) ?? []).some((entry) => instanceIds.has(entry.instanceId))) return true;
        if (core) {
          const coreRegion = chassis.coreCell.regionId
            ?? regionIdAt(chassis, chassis.coreCell.x, chassis.coreCell.y) ?? 'body';
          if ((ref.regionId ?? 'body') === coreRegion
            && ref.x === chassis.coreCell.x && ref.y === chassis.coreCell.y) return true;
        }
        return false;
      };
      for (const [dx, dy] of DELTAS) {
        if (touchesRef({ regionId: cell.regionId, x: cell.x + dx, y: cell.y + dy })) return true;
      }
      for (const port of chassis.ports ?? []) {
        const ownKey = spatialCellKey(chassis, cell);
        if (ownKey === spatialCellKey(chassis, port.a) && touchesRef(port.b)) return true;
        if (ownKey === spatialCellKey(chassis, port.b) && touchesRef(port.a)) return true;
      }
      return false;
    };

    const poweredIds = resolution.connectedInstanceIds;
    const targetIds = new Set(targets.filter((target) => target !== '__core__'));
    const queue: string[] = [];
    const cameFrom = new Map<string, string | null>();
    for (const [cellKey] of free) {
      if (resolution.energizedWireCells.has(cellKey)
        || terminalTouches(cellKey, poweredIds, resolution.coreNetworkId !== null)) {
        queue.push(cellKey);
        cameFrom.set(cellKey, null);
      }
    }

    let hit: string | null = null;
    for (let index = 0; index < queue.length && hit === null; index += 1) {
      const currentKey = queue[index]!;
      if (terminalTouches(currentKey, targetIds, targets.includes('__core__'))) {
        hit = currentKey;
        break;
      }
      for (const next of adjacentKeys(free.get(currentKey)!)) {
        if (!cameFrom.has(next)) {
          cameFrom.set(next, currentKey);
          queue.push(next);
        }
      }
    }

    if (hit === null) {
      for (const target of targets) unreachable.add(target);
      break;
    }
    const path: RouteCell[] = [];
    for (let cursor: string | null = hit; cursor !== null; cursor = cameFrom.get(cursor) ?? null) {
      if (!occupancy.routesByCell.get(cursor)?.has('wire')) path.push(free.get(cursor)!);
    }
    if (path.length === 0) {
      for (const target of targets) unreachable.add(target);
      break;
    }
    addedRoutes.push(...path.reverse());
  }
  return { conduits: [], routes: addedRoutes, unreachableInstanceIds: [...unreachable].sort() };
}

/**
 * Auto-wire is spatial-only. The pre-spatial grid walker that used to live here
 * was unreachable: every shipped chassis defines regions, so `usesSpatialSystems`
 * was always true and this function always delegated. It was ~95 lines of a
 * second, subtly different power model that nothing ran and everything had to be
 * read against.
 */
export function autoWire(chassis: ChassisSpec, build: Build): AutoWireResult {
  return autoWireSpatial(chassis, build);
}

/** Convenience: the build with the auto-wire conduits applied. */
export function applyAutoWire(chassis: ChassisSpec, build: Build): { build: Build; result: AutoWireResult } {
  const result = autoWire(chassis, build);
  return {
    build: result.conduits.length === 0 && result.routes.length === 0
      ? build
      : {
        ...build,
        parts: [...build.parts, ...result.conduits],
        routes: [...(build.routes ?? []), ...result.routes],
      },
    result,
  };
}
