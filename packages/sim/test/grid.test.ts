import { describe, expect, it } from 'vitest';
import { getChassis, getUsableCellCount } from '../src/chassis.js';
import { checkPlacement } from '../src/grid.js';
import type { PlacedPart } from '../src/types.js';

describe('chassis masks', () => {
  it('report a usable cell count for every starter chassis', () => {
    for (const id of ['CH-2', 'CH-5', 'CH-7', 'CH-9']) {
      const chassis = getChassis(id);
      const count = getUsableCellCount(chassis);
      expect(count).toBeGreaterThan(10);
      expect(count).toBeLessThanOrEqual(chassis.width * chassis.height);
    }
  });
});

describe('placement legality (docs/01 §1, §6)', () => {
  const chassis = getChassis('CH-5'); // Mule, 6x6

  it('rejects placement outside the mask', () => {
    const candidate: PlacedPart = { instanceId: 'a', partId: 'U-ARM', origin: { x: 0, y: 0 }, rotation: 0, integrity: 1 };
    // (0,0) is masked out on the Mule (top row is ".####.").
    const err = checkPlacement(chassis, [], candidate, { id: 'U-ARM', name: '', category: 'structural', shape: [{ dx: 0, dy: 0 }], massKg: 150, hp: 60, tier: 1 });
    expect(err?.reason).toBe('out-of-mask');
  });

  it('rejects overlapping parts', () => {
    const existing: PlacedPart[] = [
      { instanceId: 'a', partId: 'U-ARM', origin: { x: 1, y: 1 }, rotation: 0, integrity: 1 },
    ];
    const candidate: PlacedPart = { instanceId: 'b', partId: 'U-ARM', origin: { x: 1, y: 1 }, rotation: 0, integrity: 1 };
    const err = checkPlacement(chassis, existing, candidate, { id: 'U-ARM', name: '', category: 'structural', shape: [{ dx: 0, dy: 0 }], massKg: 150, hp: 60, tier: 1 });
    expect(err?.reason).toBe('overlap');
  });

  it('rejects a part placed on the core cell', () => {
    const candidate: PlacedPart = { instanceId: 'a', partId: 'U-ARM', origin: chassis.coreCell, rotation: 0, integrity: 1 };
    const err = checkPlacement(chassis, [], candidate, { id: 'U-ARM', name: '', category: 'structural', shape: [{ dx: 0, dy: 0 }], massKg: 150, hp: 60, tier: 1 });
    expect(err?.reason).toBe('core-occupied');
  });

  it('rejects a perimeter-only part (radiator) placed in the interior', () => {
    // (2,3),(3,3),(4,3) on the Mule are fully surrounded by in-mask neighbors -> not perimeter.
    const candidate: PlacedPart = { instanceId: 'rad', partId: 'U-RAD', origin: { x: 2, y: 3 }, rotation: 0, integrity: 1 };
    const err = checkPlacement(chassis, [], candidate, {
      id: 'U-RAD', name: '', category: 'utility', shape: [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }, { dx: 2, dy: 0 }],
      massKg: 100, hp: 25, tier: 2, perimeterOnly: true,
    });
    expect(err?.reason).toBe('perimeter-required');
  });

  it('accepts a perimeter-only part (radiator) placed along the chassis edge', () => {
    // Column 0 is a mask edge on rows 1-4 -> always perimeter.
    const candidate: PlacedPart = { instanceId: 'rad', partId: 'U-RAD', origin: { x: 0, y: 1 }, rotation: 90, integrity: 1 };
    const err = checkPlacement(chassis, [], candidate, {
      id: 'U-RAD', name: '', category: 'utility', shape: [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }, { dx: 2, dy: 0 }],
      massKg: 100, hp: 25, tier: 2, perimeterOnly: true,
    });
    expect(err).toBeNull();
  });
});
