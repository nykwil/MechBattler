import { describe, expect, it } from 'vitest';
import type { Build, PlacedPart } from '../src/types.js';
import { getChassis } from '../src/chassis.js';
import { validateBuild } from '../src/validation.js';
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
