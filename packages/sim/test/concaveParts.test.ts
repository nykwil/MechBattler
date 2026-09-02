/**
 * A part whose footprint is not a rectangle. `W-SR` is the first one, and it
 * broke two assumptions that had been safe for every rect and every line in
 * the catalog. Both are pinned here because neither failure is visible: the
 * placer reported "no legal cell" for a part with legal cells, and no test,
 * screenshot or audit would have said otherwise.
 */
import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../src/chassis.js';
import { getPart } from '../src/catalog.js';
import { checkPlacement, getOccupiedCells, rotateShape } from '../src/grid.js';
import { checkSpatialPartPlacement } from '../src/spatial.js';
import { placeParts } from '../src/assembly.js';
import type { Build, PlacedPart } from '../src/types.js';

const vulture = CHASSIS['CH-2']!;
const def = getPart('W-SR');

const legalPlacements = () => {
  const found: { regionId: string; x: number; y: number; rotation: number }[] = [];
  for (const region of vulture.regions ?? []) {
    for (const rotation of [0, 90, 180, 270] as const) {
      for (let y = 0; y < vulture.height; y++) {
        for (let x = 0; x < vulture.width; x++) {
          const candidate: PlacedPart = {
            instanceId: 'probe', partId: 'W-SR',
            origin: { regionId: region.id, x, y }, rotation, integrity: 1,
          };
          if (checkPlacement(vulture, [], candidate, def) !== null) continue;
          if (checkSpatialPartPlacement(vulture, { parts: [], routes: [] }, candidate, def) !== null) continue;
          found.push({ regionId: region.id, x, y, rotation });
        }
      }
    }
  }
  return found;
};

describe('a part cut to the shape of a region', () => {
  it('fits each Vulture arm exactly once, and the right arm only at 180', () => {
    // The arms are 180-rotations of each other rather than mirrors, which is
    // why one authored shape can serve both and why 0/90 alone is not enough.
    expect(legalPlacements()).toEqual([
      { regionId: 'left-hardpoint', x: 0, y: 0, rotation: 0 },
      { regionId: 'right-hardpoint', x: 3, y: 0, rotation: 180 },
    ]);
  });

  it('has an origin that is not one of its own cells', () => {
    // The reason the placer missed it: the search only ever offered origins
    // that were themselves free cells, and (0,0) is the hole in this shape.
    const cells = getOccupiedCells(
      { instanceId: 'p', partId: 'W-SR', origin: { regionId: 'left-hardpoint', x: 0, y: 0 }, rotation: 0, integrity: 1 },
      def,
    );
    expect(cells.some((c) => c.x === 0 && c.y === 0)).toBe(false);
    expect(cells).toHaveLength(6);
  });

  it('is a different footprint at 180 than at 0, unlike every rect and line', () => {
    const norm = (rotation: 0 | 90 | 180 | 270) => {
      const r = rotateShape(def.shape, rotation);
      const minDx = Math.min(...r.map((c) => c.dx));
      const minDy = Math.min(...r.map((c) => c.dy));
      return r.map((c) => `${c.dx - minDx},${c.dy - minDy}`).sort().join(' ');
    };
    expect(norm(180)).not.toEqual(norm(0));
    expect(norm(270)).not.toEqual(norm(90));
    // The assumption that made two rotations enough, still true of a rect:
    const plate = getPart('U-ARM');
    const normOf = (shape: typeof plate.shape, rotation: 0 | 180) => {
      const r = rotateShape(shape, rotation);
      const minDx = Math.min(...r.map((c) => c.dx));
      const minDy = Math.min(...r.map((c) => c.dy));
      return r.map((c) => `${c.dx - minDx},${c.dy - minDy}`).sort().join(' ');
    };
    expect(normOf(plate.shape, 180)).toEqual(normOf(plate.shape, 0));
  });

  it('is actually found by the auto-placer', () => {
    const empty: Build = { chassisId: 'CH-2', parts: [], routes: [], powerPriority: ['__core__'] };
    const { build, placed } = placeParts(empty, 'W-SR', 1);
    expect(placed).toBe(1);
    expect(build.parts).toHaveLength(1);
    expect(getOccupiedCells(build.parts[0]!, def)).toHaveLength(6);
  });
});
