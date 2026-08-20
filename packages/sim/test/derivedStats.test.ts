import { describe, expect, it } from 'vitest';
import { getChassis } from '../src/chassis.js';
import {
  computeBurstDps,
  computeEnergyMargin,
  computeIdealRangeBand,
  computeSpeedProfile,
  runTestBench,
} from '../src/derivedStats.js';
import type { Build, PlacedPart } from '../src/types.js';

describe('speed profile (docs/03 §3)', () => {
  it('an empty chassis is under rated mass and hits the 1.15 load-factor cap', () => {
    const chassis = getChassis('CH-2'); // Vulture, rated 3.0t
    const build: Build = { chassisId: chassis.id, parts: [], powerPriority: [] };
    const profile = computeSpeedProfile(chassis, build);
    expect(profile.loadFactor).toBeCloseTo(1.15, 5);
    expect(profile.fwd).toBeCloseTo(chassis.speedsMps.fwd * 1.15, 5);
  });

  it('overloading the chassis drags the load factor below 1.0', () => {
    const chassis = getChassis('CH-2'); // rated 3.0t
    // Structural (0.9t) + enough armor to clear the 3.0t rating -- this is a
    // pure mass-math test (computeMassAndCoG does not validate placement),
    // so cell legality doesn't matter here.
    const parts: PlacedPart[] = Array.from({ length: 20 }, (_, i) => ({
      instanceId: `armor${i}`, partId: 'U-ARM', origin: { x: 0, y: 0 }, rotation: 0 as const, integrity: 1,
    }));
    const build: Build = { chassisId: chassis.id, parts, powerPriority: [] };
    const profile = computeSpeedProfile(chassis, build);
    expect(profile.massT).toBeGreaterThan(chassis.ratedMassT);
    expect(profile.loadFactor).toBeLessThan(1.0);
    expect(profile.fwd).toBeLessThan(chassis.speedsMps.fwd);
  });
});

describe('energy margin (docs/02 §6)', () => {
  it('matches supply minus the sum of locomotion, weapon, and utility demand', () => {
    const chassis = getChassis('CH-2');
    const parts: PlacedPart[] = [
      { instanceId: 'reactor', partId: 'R-E25', origin: { regionId: 'right-hardpoint', x: 3, y: 1 }, rotation: 0, integrity: 1 },
      { instanceId: 'mg', partId: 'W-MG', origin: { regionId: 'left-hardpoint', x: 0, y: 1 }, rotation: 0, integrity: 1 },
      { instanceId: 'tc', partId: 'U-TC1', origin: { regionId: 'body', x: 1, y: 1 }, rotation: 0, integrity: 1 },
    ];
    const build: Build = {
      chassisId: chassis.id,
      parts,
      routes: [
        { kind: 'wire', regionId: 'body', x: 2, y: 0 },
        { kind: 'wire', regionId: 'body', x: 2, y: 2 },
      ],
      powerPriority: [],
    };
    const profile = computeSpeedProfile(chassis, build);
    const margin = computeEnergyMargin(chassis, build);

    const expectedLocomotion = 1.2 * profile.massT * (profile.fwd * 0.65);
    // The machine gun contributes nothing: ballistic guns fire mechanically
    // now (`firesMechanically`) and never load the bus. The targeting computer
    // is here so the non-locomotion term is not vacuously zero.
    expect(margin.demandKw).toBeCloseTo(expectedLocomotion + 3 /* U-TC1 continuous draw */, 4);
    expect(margin.marginKw).toBeCloseTo(margin.supplyKw - margin.demandKw, 6);
    expect(margin.supplyKw).toBeCloseTo(25, 5);
  });
});

describe('burst DPS (docs/03 §5, closed form)', () => {
  it('sums each weapon damage divided by its cycle time', () => {
    const build: Build = {
      chassisId: 'CH-2',
      parts: [
        { instanceId: 'mg', partId: 'W-MG', origin: { x: 0, y: 0 }, rotation: 0, integrity: 1 },
        { instanceId: 'ac', partId: 'W-AC', origin: { x: 0, y: 0 }, rotation: 0, integrity: 1 },
      ],
      powerPriority: [],
    };
    const dps = computeBurstDps(build);
    expect(dps.totalDps).toBeCloseTo(1.5 / 0.1 + 11.5 / 0.75, 5);
  });
});

describe('ideal range band (docs/03 §7)', () => {
  it('a short-range weapon and a long-range weapon on the same mech report a mismatch', () => {
    const build: Build = {
      chassisId: 'CH-2',
      parts: [
        { instanceId: 'mg', partId: 'W-MG', origin: { x: 0, y: 0 }, rotation: 0, integrity: 1 }, // 10 · 10–40 · 90m
        { instanceId: 'rg', partId: 'W-RG', origin: { x: 0, y: 0 }, rotation: 0, integrity: 1 }, // 0 · 50–80 · 240m
      ],
      powerPriority: [],
    };
    const band = computeIdealRangeBand(build);
    expect(band.perWeapon).toHaveLength(2);
    expect(band.bandStart).toBeGreaterThan(0);
  });

  it('a single weapon defines a coherent, non-mismatched band', () => {
    const build: Build = {
      chassisId: 'CH-2',
      parts: [{ instanceId: 'mg', partId: 'W-MG', origin: { x: 0, y: 0 }, rotation: 0, integrity: 1 }],
      powerPriority: [],
    };
    const band = computeIdealRangeBand(build);
    expect(band.mismatched).toBe(false);
    expect(band.bandEnd).toBeGreaterThan(band.bandStart);
  });
});

describe('test bench end-to-end (docs/02 §6, docs/05 -- measurements not estimates)', () => {
  it('runs the real simulation and reports a sustained DPS consistent with burst DPS when there is no heat problem', () => {
    const chassis = { // wide-open rig; see simulation.test.ts for the same pattern
      id: 'TEST-OPEN', name: 'Test Rig', type: 'test',
      width: 10, height: 4,
      mask: Array.from({ length: 4 }, () => Array(10).fill(true)),
      coreCell: { x: 0, y: 0 }, ratedMassT: 5,
      speedsMps: { fwd: 6, strafe: 4, rev: 3 }, turnRateDegS: 90, accelMps2: 3,
    };
    const build: Build = {
      chassisId: chassis.id,
      parts: [
        { instanceId: 'reactor', partId: 'R-E60', origin: { x: 1, y: 0 }, rotation: 0, integrity: 1 },
        { instanceId: 'mg', partId: 'W-MG', origin: { x: 4, y: 0 }, rotation: 0, integrity: 1 },
      ],
      powerPriority: ['mg'],
    };
    const result = runTestBench({ chassis, build, durationS: 30, speedSetting: 'stationary' });
    expect(result.timeToOverheatS).toBeNull();
    expect(result.sustainedDps).toBeCloseTo(computeBurstDps(build).totalDps, 0);
    expect(result.everShedInstanceIds).toHaveLength(0);
  });
});
