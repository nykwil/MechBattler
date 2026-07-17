/**
 * Thermal model construction: per-cell temperature state and the conduction
 * edges between them. See docs/02-power-heat-spec.md §3.
 */
import type { ChassisSpec, PlacedPart } from './types.js';
import { getPart } from './catalog.js';
import { buildOccupancyMap, isPerimeterCell } from './grid.js';

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

const key = (x: number, y: number) => `${x},${y}`;

export const CORE_INSTANCE_ID = '__core__';

export function buildThermalModel(chassis: ChassisSpec, parts: PlacedPart[]): ThermalModel {
  const { cellsByInstance } = buildOccupancyMap(parts);
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
    });
    cellKeysByInstance.set(CORE_INSTANCE_ID, [coreKey]);
  }

  for (const p of parts) {
    const def = getPart(p.partId);
    const cellCoords = cellsByInstance.get(p.instanceId)!;
    const keys: string[] = [];
    const thermalMass = def.thermalMassPerCell ?? 1.0;
    for (const c of cellCoords) {
      const k = key(c.x, c.y);
      keys.push(k);
      cells.set(k, {
        key: k,
        x: c.x,
        y: c.y,
        instanceId: p.instanceId,
        partId: p.partId,
        tempC: AMBIENT_C,
        thermalMassKjPerC: thermalMass,
        isPerimeter: isPerimeterCell(chassis, c.x, c.y),
        isHeatPipe: def.isHeatPipe === true,
        isRadiator: def.id === 'U-RAD',
      });
    }
    cellKeysByInstance.set(p.instanceId, keys);
  }

  const edges: ThermalEdge[] = [];
  const seen = new Set<string>();
  const deltas: [number, number][] = [[1, 0], [0, 1]]; // only need each undirected edge once
  for (const cell of cells.values()) {
    for (const [dx, dy] of deltas) {
      const nk = key(cell.x + dx, cell.y + dy);
      const neighbor = cells.get(nk);
      if (!neighbor) continue;
      const edgeId = `${cell.key}|${nk}`;
      if (seen.has(edgeId)) continue;
      seen.add(edgeId);
      const k = cell.isHeatPipe || neighbor.isHeatPipe ? CONDUCTION_K_PIPE : CONDUCTION_K_NORMAL;
      edges.push({ aKey: cell.key, bKey: nk, k });
    }
  }

  return { cells, edges, cellKeysByInstance };
}
