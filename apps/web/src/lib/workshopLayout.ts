import type { ChassisSpec } from '@mechbattler/sim';

export interface WorkshopLayoutCell {
  column: number;
  row: number;
  regionId?: string;
  offsetX: number;
  offsetY: number;
}

export interface WorkshopLayoutRegion {
  id: string;
  name: string;
  columnStart: number;
  columnEnd: number;
  rowStart: number;
  rowEnd: number;
  offsetPercentX: number;
  offsetPercentY: number;
}

/** One visual projection shared by construction and battle damage displays. */
export function resolveWorkshopLayout(chassis: ChassisSpec): {
  cells: Map<string, WorkshopLayoutCell>;
  width: number;
  height: number;
  regions: WorkshopLayoutRegion[];
} {
  const cells = new Map<string, WorkshopLayoutCell>();
  if (!chassis.regions?.length) {
    for (let y = 0; y < chassis.height; y += 1) {
      for (let x = 0; x < chassis.width; x += 1) {
        if (chassis.mask[y]?.[x]) {
          cells.set(`${x},${y}`, { column: x + 1, row: y + 1, offsetX: 0, offsetY: 0 });
        }
      }
    }
    return { cells, width: chassis.width, height: chassis.height, regions: [] };
  }

  let width = 0;
  let height = 0;
  const regions = chassis.regions.map((region) => {
    const occupied: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < region.height; y += 1) {
      for (let x = 0; x < region.width; x += 1) {
        if (region.mask[y]?.[x]) occupied.push({ x, y });
      }
    }
    const minX = Math.min(...occupied.map((cell) => cell.x));
    const maxX = Math.max(...occupied.map((cell) => cell.x));
    const minY = Math.min(...occupied.map((cell) => cell.y));
    const maxY = Math.max(...occupied.map((cell) => cell.y));
    const origin = region.workshopOrigin ?? { x: minX, y: minY };
    const offset = region.workshopOffset ?? { x: 0, y: 0 };
    for (const cell of occupied) {
      cells.set(`${cell.x},${cell.y}`, {
        column: origin.x + cell.x - minX + 1,
        row: origin.y + cell.y - minY + 1,
        regionId: region.id,
        offsetX: offset.x,
        offsetY: offset.y,
      });
    }
    const visualWidth = maxX - minX + 1;
    const visualHeight = maxY - minY + 1;
    width = Math.max(width, origin.x + visualWidth);
    height = Math.max(height, origin.y + visualHeight);
    return {
      id: region.id,
      name: region.name,
      columnStart: origin.x + 1,
      columnEnd: origin.x + visualWidth + 1,
      rowStart: origin.y + 1,
      rowEnd: origin.y + visualHeight + 1,
      offsetPercentX: (offset.x / visualWidth) * 100,
      offsetPercentY: (offset.y / visualHeight) * 100,
    };
  });
  return { cells, width, height, regions };
}
