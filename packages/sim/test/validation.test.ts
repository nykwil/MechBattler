import { describe, expect, it } from 'vitest';
import type { Build, PlacedPart } from '../src/types.js';
import { getChassis } from '../src/chassis.js';
import { computeHeatAdvice, validateBuild } from '../src/validation.js';
import { TEMPLATES } from '../src/templates.js';

const chassis = getChassis('CH-5');
const part = (instanceId: string, partId: string, x: number, y: number, rotation: 0 | 90 = 0): PlacedPart =>
  ({ instanceId, partId, origin: { x, y }, rotation, integrity: 1 });

function codes(build: Build): string[] {
  return validateBuild(chassis, build).map((i) => i.code);
}

describe('build validation (docs/02 §2, warn-only philosophy)', () => {
  it('flags unpowered parts and a dead core as errors', () => {
    // MG far from the reactor, reactor not adjacent to the core.
    const build: Build = {
      chassisId: 'CH-5',
      parts: [part('reactor', 'R-E25', 4, 4), part('mg', 'W-MG', 1, 0)],
      powerPriority: [],
    };
    const issues = validateBuild(chassis, build);
    expect(codes(build)).toContain('unpowered-parts');
    expect(codes(build)).toContain('core-unpowered');
    expect(issues.find((i) => i.code === 'unpowered-parts')!.severity).toBe('error');
    expect(issues.find((i) => i.code === 'unpowered-parts')!.instanceIds).toEqual(['mg']);
  });

  it('flags a cap-fed railgun with no capacitors as a hard error', () => {
    const build: Build = {
      chassisId: 'CH-5',
      parts: [part('reactor', 'R-C40', 0, 1), part('con', 'U-CON', 2, 1), part('rg', 'W-RG', 3, 0)],
      powerPriority: [],
    };
    const issue = validateBuild(chassis, build).find((i) => i.code === 'cap-starved-weapon');
    expect(issue?.severity).toBe('error');
    expect(issue?.instanceIds).toEqual(['rg']);
  });

  it('warns CANNOT SUSTAIN FIRE when demand exceeds supply', () => {
    // Whisper (25 kW) driving an autocannon + locomotion on a heavy mule.
    const build: Build = {
      chassisId: 'CH-5',
      parts: [
        part('reactor', 'R-E25', 3, 1),
        part('ac', 'W-AC', 1, 3), part('con', 'U-CON', 3, 3),
        part('ac2', 'W-AC', 4, 3), // second AC: 12 kW weapons + ~19 kW locomotion > 25 kW
      ],
      powerPriority: [],
    };
    const issue = validateBuild(chassis, build).find((i) => i.code === 'cannot-sustain-fire');
    expect(issue?.severity).toBe('warn');
    expect(issue?.message).toContain('CANNOT SUSTAIN FIRE');
  });

  it('warns when heat generation exceeds cooling capacity', () => {
    const build: Build = {
      chassisId: 'CH-5',
      parts: [part('reactor', 'R-C40', 3, 1), part('ac', 'W-AC', 1, 3), part('con', 'U-CON', 3, 3)],
      powerPriority: [],
    };
    expect(codes(build)).toContain('overheats'); // combustion waste + AC heat, zero radiators
  });

  it('flags a starved reactor island that the pooled energy margin hides', () => {
    // Two lasers (15 kW avg each) on a 25 kW Whisper, while an unconnected
    // 40 kW Lump idles: pooled margin is healthy, that island is not.
    const build: Build = {
      chassisId: 'CH-5',
      parts: [
        part('whisper', 'R-E25', 0, 0),
        part('las1', 'W-LAS', 2, 0),
        part('las2', 'W-LAS', 0, 2, 90),
        part('lump', 'R-C40', 4, 2),
      ],
      powerPriority: [],
    };
    const issue = validateBuild(chassis, build).find((i) => i.code === 'network-starved');
    expect(issue?.severity).toBe('warn');
    expect(issue?.instanceIds).toEqual(expect.arrayContaining(['las1', 'las2']));
    expect(codes(build)).not.toContain('cannot-sustain-fire');
  });

  it('template roster builds produce no errors (warnings allowed)', () => {
    for (const t of TEMPLATES) {
      const errors = validateBuild(getChassis(t.build.chassisId), t.build).filter((i) => i.severity === 'error');
      expect(errors, `${t.id}: ${JSON.stringify(errors)}`).toEqual([]);
    }
  });

  it('an empty build produces no issues', () => {
    expect(validateBuild(chassis, { chassisId: 'CH-5', parts: [], powerPriority: [] })).toEqual([]);
  });
});

describe('heat advice (prescriptive, from predicted temps)', () => {
  const laserBuild: Build = {
    chassisId: 'CH-5',
    parts: [
      part('reactor', 'R-E25', 3, 1),
      part('las', 'W-LAS', 1, 3), // (1,3),(2,3),(3,3)
      part('rad', 'U-RAD', 1, 0), // (1,0),(2,0),(3,0) -- 3 cells from the laser
    ],
    powerPriority: [],
  };
  const temps = (laserPeak: number): Record<string, number> => ({
    '1,3': laserPeak, '2,3': laserPeak - 5, '3,3': laserPeak - 8,
    '1,0': 40, '2,0': 40, '3,0': 40, '3,1': 30, '4,1': 30, '3,2': 30, '4,2': 30,
  });

  it('a shutdown-bound part gets a pipe-path prescription', () => {
    const advice = computeHeatAdvice(chassis, laserBuild, temps(145));
    const hot = advice.find((i) => i.code === 'part-overheats');
    expect(hot?.severity).toBe('warn');
    expect(hot?.message).toContain('heat-pipe route');
    expect(hot?.instanceIds).toEqual(['las']);
  });

  it('a warm part gets a margin hint, and a far radiator gets a distance hint', () => {
    const advice = computeHeatAdvice(chassis, laserBuild, temps(112));
    expect(advice.some((i) => i.code === 'part-runs-hot')).toBe(true);
    expect(advice.some((i) => i.code === 'radiator-far')).toBe(true);
  });

  it('hot ammo warns about cook-off with the air-gap teaching', () => {
    const build: Build = {
      chassisId: 'CH-5',
      parts: [part('ammo', 'U-AMMO', 1, 3)],
      powerPriority: [],
    };
    const advice = computeHeatAdvice(chassis, build, { '1,3': 150, '2,3': 150 });
    const issue = advice.find((i) => i.code === 'ammo-cookoff-risk');
    expect(issue?.severity).toBe('warn');
    expect(issue?.message).toContain('air gap');
  });

  it('a cool build gets no advice', () => {
    expect(computeHeatAdvice(chassis, laserBuild, temps(60))).toEqual([]);
  });
});
