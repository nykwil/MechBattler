import { describe, expect, it } from 'vitest';
import type { Build, PlacedPart } from '../src/types.js';
import { getChassis } from '../src/chassis.js';
import { computeCapacitorBank, computeHeatBalance } from '../src/derivedStats.js';

describe('heat balance bar math (docs/01 §9, docs/02 §3)', () => {
  it('sums weapon cadence heat and reactor waste against skin AND radiator capacity', () => {
    const parts: PlacedPart[] = [
      { instanceId: 'reactor', partId: 'R-E25', origin: { x: 3, y: 1 }, rotation: 0, integrity: 1 },
      { instanceId: 'las', partId: 'W-LAS', origin: { x: 1, y: 3 }, rotation: 0, integrity: 1 },
      { instanceId: 'rad', partId: 'U-RAD', origin: { x: 1, y: 0 }, rotation: 0, integrity: 1 },
      { instanceId: 'cap', partId: 'P-CAP', origin: { x: 1, y: 4 }, rotation: 0, integrity: 1 },
    ];
    const build: Build = { chassisId: 'CH-5', parts, powerPriority: [] };
    const balance = computeHeatBalance(getChassis('CH-5'), build);

    // Laser: 9 kJ / 2.0 s = 4.5 kW (docs/02 §3 table, Jul 2026 retune).
    // Electric reactor: 1 kW waste.
    expect(balance.heatInKw).toBeCloseTo(5.5, 5);

    // Cooling is quoted at the fire-hold threshold, so the bar answers "can
    // this build ever be forced to stop firing?". Two terms, and the skin is
    // the larger one -- it used to be credited nothing at all while the
    // radiator was credited everything, which was backwards (docs/17 F14).
    expect(balance.radiatorKw).toBe(6);
    expect(balance.passiveKw).toBeGreaterThan(balance.radiatorKw);
    expect(balance.coolingKw).toBeCloseTo(balance.passiveKw + balance.radiatorKw, 5);
    expect(balance.orphanedRadiatorIds).toEqual([]);
    expect(balance.marginKw).toBeCloseTo(balance.coolingKw - 5.5, 5);
    expect(computeCapacitorBank(build).storedKj).toBe(60);
  });

  it('combustion reactors bill high-band waste when demand exceeds half of supply', () => {
    // W-LAS (15 kW average) + locomotion on a Mule pushes an R-C40 (40 kW)
    // past 50% load. A laser rather than the autocannon this used to fit:
    // ballistic guns fire mechanically now (`firesMechanically`) and put no
    // load on the reactor at all, so they cannot move it between waste bands.
    const parts: PlacedPart[] = [
      { instanceId: 'reactor', partId: 'R-C40', origin: { x: 3, y: 1 }, rotation: 0, integrity: 1 },
      { instanceId: 'las', partId: 'W-LAS', origin: { x: 1, y: 3 }, rotation: 0, integrity: 1 },
    ];
    const build: Build = { chassisId: 'CH-5', parts, powerPriority: [] };
    const balance = computeHeatBalance(getChassis('CH-5'), build);
    const reactorSource = balance.perSource.find((s) => s.partId === 'R-C40')!;
    expect(reactorSource.kw).toBe(6); // high band of [3, 6]
    // No radiator, so no radiator credit -- but the skin still cools, and
    // pretending otherwise is what made the old gauge condemn builds that ran
    // all fight at 47 C.
    expect(balance.radiatorKw).toBe(0);
    expect(balance.passiveKw).toBeGreaterThan(0);
    expect(balance.coolingKw).toBe(balance.passiveKw);
  });

  it('gives a radiator plumbed to nothing no credit, and names it', () => {
    // The Mule's left shoulder is its own conduction region, so a radiator put
    // there while the guns and reactor sit in the body cools nothing at all --
    // which is exactly what two shipped templates were doing unnoticed. The
    // gauge has to say so, or the player fits a second one and wonders why the
    // bar refuses to move.
    const parts: PlacedPart[] = [
      { instanceId: 'reactor', partId: 'R-E25', origin: { regionId: 'body', x: 3, y: 1 }, rotation: 0, integrity: 1 },
      { instanceId: 'las', partId: 'W-LAS', origin: { regionId: 'body', x: 1, y: 3 }, rotation: 0, integrity: 1 },
      { instanceId: 'rad', partId: 'U-RAD', origin: { regionId: 'left-shoulder', x: 0, y: 1 }, rotation: 0, integrity: 1 },
    ];
    const build: Build = { chassisId: 'CH-5', parts, powerPriority: [] };
    const balance = computeHeatBalance(getChassis('CH-5'), build);
    expect(balance.orphanedRadiatorIds).toEqual(['rad']);
    expect(balance.radiatorKw).toBe(0);
  });
});
