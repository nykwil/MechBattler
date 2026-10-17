/**
 * The L family (`catalog.ts`, above U-ARM3). Their whole claim is geometric --
 * two of a kind slide together into a rectangle, the 4-cell L has a handedness
 * and the 3-cell one does not -- so that is what is pinned, along with the
 * placer actually finding them.
 */
import { describe, expect, it } from 'vitest';
import { getPart } from '../src/catalog.js';
import { rotateShape } from '../src/grid.js';
import { placeParts } from '../src/assembly.js';
import type { Build, CellOffset } from '../src/types.js';

type Rotation = 0 | 90 | 180 | 270;
const ROTATIONS: Rotation[] = [0, 90, 180, 270];

const normalise = (cells: CellOffset[]) => {
  const minDx = Math.min(...cells.map((c) => c.dx));
  const minDy = Math.min(...cells.map((c) => c.dy));
  return cells.map((c) => ({ dx: c.dx - minDx, dy: c.dy - minDy }));
};
const key = (cells: CellOffset[]) => normalise(cells).map((c) => `${c.dx},${c.dy}`).sort().join(' ');
const mirror = (cells: CellOffset[]) => cells.map((c) => ({ dx: -c.dx, dy: c.dy }));

/** Does some rotation of `b`, at some offset, fill exactly the cells `a` leaves in a w x h box? */
function closesInto(shape: CellOffset[], w: number, h: number): boolean {
  for (const ra of ROTATIONS) {
    const a = normalise(rotateShape(shape, ra));
    for (const rb of ROTATIONS) {
      const b = normalise(rotateShape(shape, rb));
      for (let oy = 0; oy < h; oy++) {
        for (let ox = 0; ox < w; ox++) {
          const filled = new Set(a.map((c) => `${c.dx},${c.dy}`));
          let ok = a.every((c) => c.dx < w && c.dy < h);
          for (const c of b) {
            const k = `${c.dx + ox},${c.dy + oy}`;
            if (c.dx + ox >= w || c.dy + oy >= h || filled.has(k)) ok = false;
            filled.add(k);
          }
          if (ok && filled.size === w * h) return true;
        }
      }
    }
  }
  return false;
}

describe('the L family', () => {
  it('is an L-tromino at 3 cells and an L-tetromino at 4', () => {
    expect(getPart('U-ARM3').shape).toHaveLength(3);
    expect(getPart('U-HS3').shape).toHaveLength(3);
    expect(getPart('R-E25L').shape).toHaveLength(4);
  });

  it('slides together: two of a kind close into a rectangle', () => {
    expect(closesInto(getPart('U-ARM3').shape, 2, 3) || closesInto(getPart('U-ARM3').shape, 3, 2)).toBe(true);
    expect(closesInto(getPart('U-HS3').shape, 2, 3) || closesInto(getPart('U-HS3').shape, 3, 2)).toBe(true);
    expect(closesInto(getPart('R-E25L').shape, 2, 4) || closesInto(getPart('R-E25L').shape, 4, 2)).toBe(true);
  });

  it('the 4-cell L has a handedness and the 3-cell L does not', () => {
    // No mirroring (docs/01 §1), so whether a part reaches its own mirror image
    // decides whether a salvaged one fits every L-shaped hole or only half.
    const reaches = (shape: CellOffset[]) => {
      const target = key(mirror(shape));
      return ROTATIONS.some((r) => key(rotateShape(shape, r)) === target);
    };
    expect(reaches(getPart('U-ARM3').shape)).toBe(true);
    expect(reaches(getPart('R-E25L').shape)).toBe(false);
  });

  it('is priced at its original part\'s per-cell rates', () => {
    for (const [l, original] of [['U-ARM3', 'U-ARM'], ['U-HS3', 'U-HS'], ['R-E25L', 'R-E25']] as const) {
      const a = getPart(l);
      const b = getPart(original);
      const ratio = a.shape.length / b.shape.length;
      expect(a.massKg, l).toBeCloseTo(b.massKg * ratio);
      expect(a.hp, l).toBeCloseTo(b.hp * ratio);
      expect(a.thermalMassPerCell, l).toBe(b.thermalMassPerCell);
      expect(a.reactor, l).toEqual(b.reactor);
    }
  });

  it('is found by the auto-placer on every starter frame', () => {
    for (const chassisId of ['CH-2', 'CH-5', 'CH-9']) {
      for (const partId of ['U-ARM3', 'U-HS3', 'R-E25L']) {
        const empty: Build = { chassisId, parts: [], routes: [], powerPriority: ['__core__'] };
        const { placed } = placeParts(empty, partId, 2);
        expect(placed, `${partId} x2 on ${chassisId}`).toBe(2);
      }
    }
  });
});
