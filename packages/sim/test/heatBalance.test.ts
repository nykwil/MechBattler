import { describe, expect, it } from 'vitest';
import type { Build, PlacedPart } from '../src/types.js';
import { getChassis } from '../src/chassis.js';
import { computeCapacitorBank, computeHeatBalance } from '../src/derivedStats.js';

describe('heat balance bar math (docs/01 §9, docs/02 §3)', () => {
  it('sums weapon cadence heat and reactor waste against radiator capacity', () => {
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
    expect(balance.coolingKw).toBe(6);
    expect(balance.marginKw).toBeCloseTo(0.5, 5);
    expect(computeCapacitorBank(build).storedKj).toBe(60);
  });

  it('combustion reactors bill high-band waste when demand exceeds half of supply', () => {
    // W-AC (6 kW) + locomotion on a Mule pushes an R-C40 (40 kW) past 50% load.
    const parts: PlacedPart[] = [
      { instanceId: 'reactor', partId: 'R-C40', origin: { x: 3, y: 1 }, rotation: 0, integrity: 1 },
      { instanceId: 'ac', partId: 'W-AC', origin: { x: 1, y: 3 }, rotation: 0, integrity: 1 },
    ];
    const build: Build = { chassisId: 'CH-5', parts, powerPriority: [] };
    const balance = computeHeatBalance(getChassis('CH-5'), build);
    const reactorSource = balance.perSource.find((s) => s.partId === 'R-C40')!;
    expect(reactorSource.kw).toBe(6); // high band of [3, 6]
    expect(balance.coolingKw).toBe(0); // no radiator mounted -- the meter should scream
  });
});
