import { describe, expect, it } from 'vitest';
import { getChassis, getOccupiedCells, getPart } from '@mechbattler/sim';
import {
  PROTOTYPE_LOADOUTS,
  VULTURE_LONGSHOT,
  computePhysicalCenterOfMass,
  describeLoadout,
} from './model.js';
import { createGaitState, nextStepGroup, stepArc, supportCentroid } from './gait.js';

describe('physical mech adapter', () => {
  it('preserves modifier-adjusted part mass and structural mass', () => {
    const loadout = PROTOTYPE_LOADOUTS.find((candidate) => candidate.id === 'vulture-skirmisher')!;
    const physical = describeLoadout(loadout);
    const expectedPayload = loadout.build.parts.reduce((sum, placed) => {
      return sum + getPart(placed.partId).massKg / 1000;
    }, 0);

    expect(physical.structuralMassT).toBeCloseTo(getChassis(loadout.build.chassisId).ratedMassT * 0.3);
    expect(physical.payloadMassT).toBeCloseTo(expectedPayload);
    expect(physical.totalMassT).toBeCloseTo(physical.structuralMassT + physical.payloadMassT);
  });

  it('maps occupied grid footprints onto the dorsal deck', () => {
    const loadout = PROTOTYPE_LOADOUTS.find((candidate) => candidate.id === 'mule-gunline')!;
    const physical = describeLoadout(loadout);
    const placed = loadout.build.parts.find((part) => part.instanceId === 'ac')!;
    const cells = getOccupiedCells(placed, getPart(placed.partId));
    const rendered = physical.parts.find((part) => part.instanceId === 'ac')!;

    expect(new Set(cells.map((cell) => cell.x)).size).toBe(2);
    expect(new Set(cells.map((cell) => cell.y)).size).toBe(3);
    expect(rendered.localSizeM[0]).toBeCloseTo(0.88);
    expect(rendered.localSizeM[2]).toBeCloseTo(1.32);
    expect(rendered.localPositionM[1]).toBeGreaterThan(physical.bodySizeM[1] / 2);
  });

  it('makes the stress rig rear-heavy and includes catalog recoil', () => {
    const baseline = describeLoadout(PROTOTYPE_LOADOUTS.find((candidate) => candidate.id === 'vulture-skirmisher')!);
    const stressed = describeLoadout(PROTOTYPE_LOADOUTS.find((candidate) => candidate.id === 'vulture-longshot')!);

    expect(stressed.totalMassT - baseline.totalMassT).toBeCloseTo(VULTURE_LONGSHOT.massT);
    expect(stressed.centerOfMassLocalM[2]).toBeLessThan(baseline.centerOfMassLocalM[2]);
    expect(stressed.parts.find((part) => part.instanceId === 'stress-longshot')?.recoilKnS).toBe(8);
  });

  it('computes a mass-weighted physical center of mass', () => {
    expect(computePhysicalCenterOfMass(1, [
      { ...VULTURE_LONGSHOT, massT: 1, localPositionM: [2, 1, -1] },
    ])).toEqual([1, 0.5, -0.5]);
  });
});

describe('gait helpers', () => {
  it('alternates biped feet and quad diagonal pairs', () => {
    expect(nextStepGroup('biped', 0)).toEqual([0]);
    expect(nextStepGroup('biped', 1)).toEqual([1]);
    expect(nextStepGroup('quad', 0)).toEqual([0, 3]);
    expect(nextStepGroup('quad', 1)).toEqual([1, 2]);
  });

  it('creates a raised, smooth swing arc', () => {
    expect(stepArc([0, 0, 0], [2, 0, 0], 0, 0.5)).toEqual([0, 0, 0]);
    expect(stepArc([0, 0, 0], [2, 0, 0], 0.5, 0.5)).toEqual([1, 0.5, 0]);
    expect(stepArc([0, 0, 0], [2, 0, 0], 1, 0.5)[0]).toBeCloseTo(2);
  });

  it('tracks planted feet and support centroid', () => {
    const gait = createGaitState([[-1, 0, 1], [1, 0, 1], [-1, 0, -1], [1, 0, -1]]);
    expect(gait.feet.every((foot) => !foot.swinging)).toBe(true);
    expect(supportCentroid(gait.feet.map((foot) => foot.planted))).toEqual([0, 0, 0]);
    expect(supportCentroid(gait.feet.map((foot) => foot.planted), [0, 3])).toEqual([0, 0, 0]);
  });
});
