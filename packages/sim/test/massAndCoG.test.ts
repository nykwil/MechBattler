import { describe, expect, it } from 'vitest';
import { getChassis } from '../src/chassis.js';
import { computeMassAndCoG } from '../src/grid.js';
import type { PlacedPart } from '../src/types.js';

describe('mass and center of gravity (docs/01 §8)', () => {
  const chassis = getChassis('CH-5'); // Mule, rated 6.0t

  it('an empty chassis is just its structural mass (30% of rated) and centered CoG', () => {
    const { totalMassT, offsetFraction } = computeMassAndCoG(chassis, []);
    expect(totalMassT).toBeCloseTo(6.0 * 0.3, 5);
    expect(offsetFraction).toBeCloseTo(0, 5);
  });

  it('adding mass off-center shifts the CoG away from the geometric center', () => {
    const parts: PlacedPart[] = [
      { instanceId: 'reactor', partId: 'R-C90', origin: { x: 0, y: 1 }, rotation: 0, integrity: 1 },
    ];
    const { totalMassT, offsetFraction } = computeMassAndCoG(chassis, parts);
    expect(totalMassT).toBeGreaterThan(6.0 * 0.3);
    expect(offsetFraction).toBeGreaterThan(0);
  });

  it('integrity does not affect mass (docs/04 §3: integrity scales HP only)', () => {
    const pristine: PlacedPart[] = [
      { instanceId: 'a', partId: 'U-ARM', origin: { x: 1, y: 1 }, rotation: 0, integrity: 1.0 },
    ];
    const damaged: PlacedPart[] = [
      { instanceId: 'a', partId: 'U-ARM', origin: { x: 1, y: 1 }, rotation: 0, integrity: 0.4 },
    ];
    expect(computeMassAndCoG(chassis, pristine).totalMassT).toBeCloseTo(computeMassAndCoG(chassis, damaged).totalMassT, 6);
  });
});
