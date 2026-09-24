import { describe, expect, it } from 'vitest';
import type { Build, PlacedPart } from '../src/types.js';
import { getChassis } from '../src/chassis.js';
import { computeCapacitorBank, computeHeatBalance, REACTOR_LOAD_SOURCE } from '../src/derivedStats.js';
import { SHOT_HEAT_TO_REACTOR_FRAC } from '../src/simulation.js';
import { getPart } from '../src/catalog.js';

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

    // Laser: 9 kJ / 2.0 s = 4.5 kW (docs/02 §3 table, Jul 2026 retune), plus
    // the share of every shot the reactor pays for (MW spec §4).
    // Electric reactor: 1 kW waste.
    const heatIn = 4.5 * (1 + SHOT_HEAT_TO_REACTOR_FRAC) + 1;
    expect(balance.heatInKw).toBeCloseTo(heatIn, 5);

    // Cooling is quoted at the fire-hold threshold, so the bar answers "can
    // this build ever be forced to stop firing?". Two terms, and the skin is
    // the larger one -- it used to be credited nothing at all while the
    // radiator was credited everything, which was backwards (docs/17 F14).
    expect(balance.radiatorKw).toBe(6);
    expect(balance.passiveKw).toBeGreaterThan(balance.radiatorKw);
    expect(balance.coolingKw).toBeCloseTo(balance.passiveKw + balance.radiatorKw, 5);
    expect(balance.orphanedRadiatorIds).toEqual([]);
    expect(balance.marginKw).toBeCloseTo(balance.coolingKw - heatIn, 5);
    expect(computeCapacitorBank(build).storedKj).toBe(60);
  });

  it('bills the reactor its share of every shot, as its own source', () => {
    // The sim deposits SHOT_HEAT_TO_REACTOR_FRAC of each shot's heat on the
    // reactor and core as well as the full shot at the gun (step 6d). Leaving
    // it out under-read the roster by 0.4-2.7 kW.
    const reactor: PlacedPart = { instanceId: 'reactor', partId: 'R-E25', origin: { x: 3, y: 1 }, rotation: 0, integrity: 1 };
    const las: PlacedPart = { instanceId: 'las', partId: 'W-LAS', origin: { x: 1, y: 3 }, rotation: 0, integrity: 1 };
    const without = computeHeatBalance(getChassis('CH-5'), { chassisId: 'CH-5', parts: [reactor], powerPriority: [] });
    const withGun = computeHeatBalance(getChassis('CH-5'), { chassisId: 'CH-5', parts: [reactor, las], powerPriority: [] });
    const def = getPart('W-LAS');
    const gunKw = def.heat!.heatPerShotKj! / def.weapon!.cycleS;
    expect(withGun.heatInKw - without.heatInKw).toBeCloseTo(gunKw * (1 + SHOT_HEAT_TO_REACTOR_FRAC), 9);
    const load = withGun.perSource.find((s) => s.partId === REACTOR_LOAD_SOURCE)!;
    expect(load.kw).toBeCloseTo(gunKw * SHOT_HEAT_TO_REACTOR_FRAC, 9);
    expect(load.label).toBe('Reactor load from firing');
    expect(without.perSource.some((s) => s.partId === REACTOR_LOAD_SOURCE)).toBe(false);
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
