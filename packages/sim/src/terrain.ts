/**
 * Arena terrain (docs/03 §2): a coarse square tile grid over the battlefield.
 * Every effect is a physical modifier on an existing model (rule R1), never a
 * scripted proc:
 *
 *  - forest: concealment — incoming fire sees a reduced target silhouette;
 *    dense ground slows movement.
 *  - hill:   elevation — the shooter's line of sight flattens the ballistic
 *    problem, extending every gun's falloff band and despawn bound; climbing
 *    costs a little speed.
 *  - water:  a coolant bath — radiators dump heat far faster (convection into
 *    water vs air), but wading is slow. The counterpart to ram-air.
 *
 * Tiles are generated from the battle seed (deterministic, replayable) by
 * random-walk blob growth, mostly-open so fights still cross real ground.
 * World coordinates are arena-centered: tile (0,0) starts at (-length/2,
 * -width/2).
 */
import { Pcg32 } from './rng.js';

export type TerrainType = 'open' | 'forest' | 'hill' | 'water';

export interface TerrainGrid {
  cellSizeM: number;
  cols: number;
  rows: number;
  /** cells[row][col], row 0 at world y = -width/2. */
  cells: TerrainType[][];
}

export const TERRAIN_CELL_SIZE_M = 20;
/** Movement speed multiplier while standing on a tile. */
export const TERRAIN_SPEED_MULT: Record<TerrainType, number> = {
  open: 1,
  forest: 0.8,
  hill: 0.9,
  water: 0.65,
};
/** A target in forest shows this fraction of its silhouette to incoming fire. */
export const FOREST_COVER_MULT = 0.65;
/** A shooter on a hill scales its guns' falloff band and despawn bound by this. */
export const HILL_RANGE_MULT = 1.25;
/** Radiators on a mech standing in water dissipate at this multiple. */
export const WATER_RADIATOR_MULT = 1.6;

/** Blob counts and target sizes per type (tiles). Tuned to keep ~70% open. */
const BLOBS: [TerrainType, number, number][] = [
  ['forest', 3, 9],
  ['hill', 2, 6],
  ['water', 2, 7],
];

export function generateTerrain(seed: number, lengthM: number, widthM: number, cellSizeM = TERRAIN_CELL_SIZE_M): TerrainGrid {
  const cols = Math.max(1, Math.round(lengthM / cellSizeM));
  const rows = Math.max(1, Math.round(widthM / cellSizeM));
  const cells: TerrainType[][] = Array.from({ length: rows }, () => Array<TerrainType>(cols).fill('open'));
  // Distinct stream from the battle's combat RNG (offset avoids correlating
  // terrain with the shot rolls of the same seed).
  const rng = new Pcg32(seed + 0x7e22a1);
  for (const [type, blobCount, blobSize] of BLOBS) {
    for (let b = 0; b < blobCount; b++) {
      let cx = Math.floor(rng.nextFloat() * cols);
      let cy = Math.floor(rng.nextFloat() * rows);
      for (let i = 0; i < blobSize; i++) {
        if (cy >= 0 && cy < rows && cx >= 0 && cx < cols && cells[cy]![cx] === 'open') {
          cells[cy]![cx] = type;
        }
        const step = Math.floor(rng.nextFloat() * 4);
        cx += step === 0 ? 1 : step === 1 ? -1 : 0;
        cy += step === 2 ? 1 : step === 3 ? -1 : 0;
        cx = Math.max(0, Math.min(cols - 1, cx));
        cy = Math.max(0, Math.min(rows - 1, cy));
      }
    }
  }
  return { cellSizeM, cols, rows, cells };
}

/** Tile under an arena-centered world position (positions outside clamp to the edge tile). */
export function terrainAt(grid: TerrainGrid, x: number, y: number): TerrainType {
  const col = Math.max(0, Math.min(grid.cols - 1, Math.floor((x + (grid.cols * grid.cellSizeM) / 2) / grid.cellSizeM)));
  const row = Math.max(0, Math.min(grid.rows - 1, Math.floor((y + (grid.rows * grid.cellSizeM) / 2) / grid.cellSizeM)));
  return grid.cells[row]![col]!;
}
