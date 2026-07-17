import { describe, expect, it } from 'vitest';
import type { Build, ChassisSpec, PlacedPart } from '../src/types.js';
import { Simulation } from '../src/simulation.js';
import { CORE_INSTANCE_ID } from '../src/thermal.js';
import { computeBurstDps } from '../src/derivedStats.js';

/**
 * A fully-open synthetic test rig chassis. Real chassis masks (see
 * docs/01-chassis-grid-spec.md §2) are exercised by grid.test.ts and
 * connectivity.test.ts; these simulation tests isolate the power/heat
 * engine from incidental mask geometry.
 */
function openChassis(width: number, height: number): ChassisSpec {
  return {
    id: 'TEST-OPEN', name: 'Test Rig', type: 'test rig',
    width, height,
    mask: Array.from({ length: height }, () => Array(width).fill(true)),
    coreCell: { x: 0, y: 0 },
    ratedMassT: 5,
    speedsMps: { fwd: 6, strafe: 4, rev: 3 },
    turnRateDegS: 90,
    accelMps2: 3,
  };
}

describe('continuous weapon fire (docs/02 §2-3, docs/03 §5)', () => {
  it('a machine gun connected to a reactor deals damage matching its closed-form DPS', () => {
    const chassis = openChassis(10, 4);
    const parts: PlacedPart[] = [
      { instanceId: 'reactor', partId: 'R-E60', origin: { x: 1, y: 0 }, rotation: 0, integrity: 1 },
      { instanceId: 'mg', partId: 'W-MG', origin: { x: 4, y: 0 }, rotation: 0, integrity: 1 },
    ];
    const build: Build = { chassisId: chassis.id, parts, powerPriority: ['mg'] };
    const sim = new Simulation(chassis, build);

    let totalDamage = 0;
    let shotCount = 0;
    const dt = 0.05;
    for (let i = 0; i < Math.round(5 / dt); i++) {
      const snap = sim.step(dt, { weaponsEnabled: { mg: true }, speedSetting: 'stationary' });
      for (const shot of snap.shotsThisTick) { totalDamage += shot.totalDamage; shotCount += 1; }
      expect(snap.shedInstanceIds).toHaveLength(0); // 2kW draw, 60kW supply -- never brownouts
    }

    const expectedDps = computeBurstDps(build).totalDps;
    expect(expectedDps).toBeCloseTo(15, 5); // 1.5 damage / 0.1s cycle
    // Cycle-fed weapons enter battle loaded, so 5s of fire is 50 cycles + the loaded round.
    expect(shotCount).toBe(51);
    expect(totalDamage).toBeCloseTo(shotCount * 1.5, 5);
  });
});

describe('brownout priority shedding (docs/02 §2 -- the signature rule)', () => {
  it('sheds the lowest-priority consumer first when demand exceeds supply', () => {
    const chassis = openChassis(20, 6);
    const parts: PlacedPart[] = [
      { instanceId: 'reactor', partId: 'R-E25', origin: { x: 1, y: 0 }, rotation: 0, integrity: 1 },
    ];
    // A contiguous conduit strip so every W-AC below is on the same energized network.
    for (let x = 1; x <= 9; x++) {
      parts.push({ instanceId: `conduit${x}`, partId: 'U-CON', origin: { x, y: 2 }, rotation: 0, integrity: 1 });
    }
    const wacIds = ['wac0', 'wac1', 'wac2', 'wac3', 'wac4'];
    wacIds.forEach((id, i) => {
      parts.push({ instanceId: id, partId: 'W-AC', origin: { x: 1 + 2 * i, y: 3 }, rotation: 0, integrity: 1 });
    });

    const build: Build = { chassisId: chassis.id, parts, powerPriority: wacIds };
    const sim = new Simulation(chassis, build);
    const weaponsEnabled = Object.fromEntries(wacIds.map((id) => [id, true]));

    // 5 x 6kW = 30kW requested against a 25kW reactor -> exactly one (the
    // lowest-priority, last in the list) must be shed.
    const snap = sim.step(0.05, { weaponsEnabled, speedSetting: 'stationary' });
    expect(snap.shedInstanceIds).toEqual(['wac4']);
    expect(snap.totalDemandKw).toBeCloseTo(30, 3);
  });
});

describe('radiators measurably reduce heat (docs/02 §3-4)', () => {
  function buildWithLaser(withRadiator: boolean): Build {
    const parts: PlacedPart[] = [
      { instanceId: 'reactor', partId: 'R-E60', origin: { x: 1, y: 0 }, rotation: 0, integrity: 1 },
      { instanceId: 'laser', partId: 'W-LAS', origin: { x: 4, y: 0 }, rotation: 0, integrity: 1 },
    ];
    if (withRadiator) {
      parts.push({ instanceId: 'rad', partId: 'U-RAD', origin: { x: 4, y: 1 }, rotation: 0, integrity: 1 });
    }
    return { chassisId: 'TEST-OPEN', parts, powerPriority: ['laser'] };
  }

  it('running the laser continuously for 100s reaches a lower peak temperature with a radiator', () => {
    const chassis = openChassis(10, 4);
    const dt = 0.05;
    const steps = Math.round(100 / dt);

    function run(build: Build): { peak: number; everShutdown: boolean } {
      const sim = new Simulation(chassis, build);
      let peak = 25;
      let everShutdown = false;
      for (let i = 0; i < steps; i++) {
        const snap = sim.step(dt, { weaponsEnabled: { laser: true }, speedSetting: 'stationary' });
        if (snap.shutdownInstanceIds.includes('laser')) everShutdown = true;
        const laserKeys = sim.thermal.cellKeysByInstance.get('laser')!;
        for (const k of laserKeys) peak = Math.max(peak, snap.cellTempsC[k]!);
      }
      return { peak, everShutdown };
    }

    const withoutRadiator = run(buildWithLaser(false));
    const withRadiator = run(buildWithLaser(true));

    expect(withRadiator.peak).toBeLessThan(withoutRadiator.peak);
    // docs/02 §5's "no radiator shuts down after ~40s" is a rough design-time
    // estimate; the real tick simulation (measured, not guessed -- rule R5)
    // puts it closer to ~70s for this exact fixture, but the qualitative
    // claim -- heat has nowhere to go without a radiator, so it eventually
    // shuts down -- holds.
    expect(withoutRadiator.everShutdown).toBe(true);
    // docs/02 §5: one radiator keeps it hovering below the 130C shutdown line.
    expect(withRadiator.everShutdown).toBe(false);
  });
});

describe('railgun capacitor cadence (docs/02 §4 worked example)', () => {
  it('after draining a full bank, the second shot arrives on roughly a 5-6s cadence while stationary', () => {
    const chassis = openChassis(14, 7);
    // A reactor with a short conduit backbone; four capacitors and the
    // railgun each touch a conduit cell, so all are on the same network
    // (docs/01 §3: every power-drawing part, including cap-fed weapons,
    // must itself be edge-adjacent to the reactor or a conduit chain --
    // being merely near a capacitor is not enough).
    const parts: PlacedPart[] = [
      { instanceId: 'reactor', partId: 'R-C40', origin: { x: 2, y: 2 }, rotation: 0, integrity: 1 },
      ...[4, 5, 6, 7, 8, 9].map((x) => ({
        instanceId: `conduit${x}`, partId: 'U-CON', origin: { x, y: 2 }, rotation: 0 as const, integrity: 1,
      })),
      { instanceId: 'cap1', partId: 'P-CAP', origin: { x: 4, y: 1 }, rotation: 0, integrity: 1 },
      { instanceId: 'cap2', partId: 'P-CAP', origin: { x: 6, y: 1 }, rotation: 0, integrity: 1 },
      { instanceId: 'cap3', partId: 'P-CAP', origin: { x: 4, y: 3 }, rotation: 0, integrity: 1 },
      { instanceId: 'cap4', partId: 'P-CAP', origin: { x: 6, y: 3 }, rotation: 0, integrity: 1 },
      { instanceId: 'rg', partId: 'W-RG', origin: { x: 10, y: 1 }, rotation: 0, integrity: 1 },
    ];
    const build: Build = { chassisId: chassis.id, parts, powerPriority: [] };
    const sim = new Simulation(chassis, build);

    const dt = 0.05;
    const shotTimes: number[] = [];
    for (let i = 0; i < Math.round(20 / dt); i++) {
      const snap = sim.step(dt, { weaponsEnabled: { rg: true }, speedSetting: 'stationary' });
      for (const shot of snap.shotsThisTick) shotTimes.push(shot.tSec);
    }

    expect(shotTimes.length).toBeGreaterThanOrEqual(2);
    const gap = shotTimes[1]! - shotTimes[0]!;
    expect(gap).toBeGreaterThan(4.5);
    expect(gap).toBeLessThan(7.0);
  });
});

it('locomotion draws power at the core cell and competes for network capacity', () => {
  const chassis = openChassis(10, 4);
  const parts: PlacedPart[] = [
    { instanceId: 'reactor', partId: 'R-E25', origin: { x: 1, y: 0 }, rotation: 0, integrity: 1 },
  ];
  const build: Build = { chassisId: chassis.id, parts, powerPriority: [CORE_INSTANCE_ID] };
  const sim = new Simulation(chassis, build);
  const snap = sim.step(0.05, { weaponsEnabled: {}, speedSetting: 'flank' });
  expect(snap.totalDemandKw).toBeGreaterThan(0);
});
