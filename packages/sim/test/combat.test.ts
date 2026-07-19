import { describe, expect, it } from 'vitest';
import type { Build, ChassisSpec, PlacedPart } from '../src/types.js';
import { Simulation } from '../src/simulation.js';
import { Combatant, runBattle, computeHitModel, CORE_HP, TRACKING_LAG_BASE_S, TRACKING_LAG_TC_S } from '../src/combat.js';
import { CORE_INSTANCE_ID } from '../src/thermal.js';

/**
 * Legal CH-5 Mule layouts (mask + core cell per src/chassis.ts):
 *   .####.
 *   ######
 *   ##C###   <- core at (2,2)
 *   ######
 *   ######
 *   .####.
 */
function muleGunline(): Build {
  const parts: PlacedPart[] = [
    { instanceId: 'reactor', partId: 'R-C40', origin: { x: 3, y: 1 }, rotation: 0, integrity: 1 },
    { instanceId: 'ac', partId: 'W-AC', origin: { x: 1, y: 3 }, rotation: 0, integrity: 1 },
    { instanceId: 'con1', partId: 'U-CON', origin: { x: 3, y: 3 }, rotation: 0, integrity: 1 },
    { instanceId: 'rad', partId: 'U-RAD', origin: { x: 1, y: 0 }, rotation: 0, integrity: 1 },
    { instanceId: 'arm1', partId: 'U-ARM', origin: { x: 2, y: 1 }, rotation: 0, integrity: 1 },
  ];
  return { chassisId: 'CH-5', parts, powerPriority: [CORE_INSTANCE_ID, 'ac'] };
}

function muleSkirmisher(): Build {
  const parts: PlacedPart[] = [
    { instanceId: 'reactor', partId: 'R-E25', origin: { x: 3, y: 1 }, rotation: 0, integrity: 1 },
    { instanceId: 'mg1', partId: 'W-MG', origin: { x: 1, y: 1 }, rotation: 0, integrity: 1 },
    { instanceId: 'con1', partId: 'U-CON', origin: { x: 3, y: 3 }, rotation: 0, integrity: 1 },
    { instanceId: 'con2', partId: 'U-CON', origin: { x: 2, y: 3 }, rotation: 0, integrity: 1 },
    { instanceId: 'mg2', partId: 'W-MG', origin: { x: 1, y: 3 }, rotation: 90, integrity: 1 },
    { instanceId: 'arm1', partId: 'U-ARM', origin: { x: 2, y: 0 }, rotation: 0, integrity: 1 },
  ];
  return { chassisId: 'CH-5', parts, powerPriority: [CORE_INSTANCE_ID, 'mg1', 'mg2'] };
}

/**
 * CH-7 Widow (spider, strafe 4.5 vs fwd 5.0 -> orbit-capable). Mask:
 *   ..###..
 *   .#####.
 *   #######
 *   ###C###   <- core at (3,3)
 *   #######
 *   .#####.
 *   ..###..
 */
function widowOrbiter(): Build {
  const parts: PlacedPart[] = [
    { instanceId: 'reactor', partId: 'R-E25', origin: { x: 4, y: 1 }, rotation: 0, integrity: 1 },
    { instanceId: 'con1', partId: 'U-CON', origin: { x: 4, y: 3 }, rotation: 0, integrity: 1 },
    { instanceId: 'mg1', partId: 'W-MG', origin: { x: 2, y: 1 }, rotation: 0, integrity: 1 },
    { instanceId: 'arm1', partId: 'U-ARM', origin: { x: 3, y: 0 }, rotation: 0, integrity: 1 },
  ];
  return { chassisId: 'CH-7', parts, powerPriority: [CORE_INSTANCE_ID, 'mg1'] };
}

function weaponlessMule(): Build {
  const parts: PlacedPart[] = [
    { instanceId: 'reactor', partId: 'R-E25', origin: { x: 3, y: 1 }, rotation: 0, integrity: 1 },
    { instanceId: 'arm1', partId: 'U-ARM', origin: { x: 2, y: 1 }, rotation: 0, integrity: 1 },
  ];
  return { chassisId: 'CH-5', parts, powerPriority: [CORE_INSTANCE_ID] };
}

describe('locational damage via sampled shot rays (docs/01 §5, docs/03 §5-6)', () => {
  // A combatant at the origin facing +x; grid row 0 is its front, so a ray
  // fired from ahead (origin +x, direction -x) strikes front-row cells first.
  function frontRowTarget(): Combatant {
    const parts: PlacedPart[] = [
      { instanceId: 'arm-front', partId: 'U-ARM', origin: { x: 3, y: 0 }, rotation: 0, integrity: 1 },
      { instanceId: 'mg', partId: 'W-MG', origin: { x: 3, y: 1 }, rotation: 0, integrity: 1 },
    ];
    const build: Build = { chassisId: 'CH-5', parts, powerPriority: [] };
    return new Combatant(build, { x: 0, y: 0 }, 0);
  }

  it('a shot from dead ahead strikes the front perimeter cell', () => {
    const target = frontRowTarget();
    const result = target.applyRay({ x: 20, y: 0 }, { x: -1, y: 0 }, 10);
    expect(result.hit).toBe(true);
    expect(result.entryCell).toEqual({ x: 3, y: 0 });
    expect(result.damaged).toEqual([{ instanceId: 'arm-front', partId: 'U-ARM', damage: 10 }]);
    expect(target.hpByInstance.get('arm-front')).toBe(50);
    expect(target.isPartFunctional('arm-front')).toBe(true);
  });

  it('overkill penetrates the destroyed occupant into the next cell at 50%', () => {
    const target = frontRowTarget();
    const result = target.applyRay({ x: 20, y: 0 }, { x: -1, y: 0 }, 100);
    // Armor (60 HP) dies; (100-60) * 0.5 = 20 continues into the machine gun behind it.
    expect(result.damaged).toEqual([
      { instanceId: 'arm-front', partId: 'U-ARM', damage: 60 },
      { instanceId: 'mg', partId: 'W-MG', damage: 20 },
    ]);
    expect(target.isPartFunctional('arm-front')).toBe(false);
    expect(target.hpByInstance.get('mg')).toBe(5);
  });

  it('a ray through empty cells reaches the core; core death is tracked', () => {
    const build: Build = {
      chassisId: 'CH-5',
      parts: [{ instanceId: 'reactor', partId: 'R-E25', origin: { x: 3, y: 1 }, rotation: 0, integrity: 1 }],
      powerPriority: [],
    };
    const target = new Combatant(build, { x: 0, y: 0 }, 0);
    // Column x=2 is empty down to the core at (2,2); offset the ray line to that column.
    const result = target.applyRay({ x: 20, y: 0.25 }, { x: -1, y: 0 }, 60);
    expect(result.damaged[0]).toEqual({ instanceId: CORE_INSTANCE_ID, partId: CORE_INSTANCE_ID, damage: CORE_HP });
    expect(target.coreHp).toBeLessThanOrEqual(0);
  });

  it('a ray that misses the bounding box damages nothing', () => {
    const target = frontRowTarget();
    const result = target.applyRay({ x: 20, y: 50 }, { x: -1, y: 0 }, 10);
    expect(result.hit).toBe(false);
    expect(result.damaged).toEqual([]);
  });
});

describe('mid-fight conduit destruction splits the power network (docs/01 §5)', () => {
  it('a weapon downstream of a destroyed conduit stops firing immediately', () => {
    const chassis: ChassisSpec = {
      id: 'TEST-OPEN', name: 'Test Rig', type: 'test rig',
      width: 10, height: 4,
      mask: Array.from({ length: 4 }, () => Array(10).fill(true)),
      coreCell: { x: 0, y: 0 },
      ratedMassT: 5, speedsMps: { fwd: 6, strafe: 4, rev: 3 }, turnRateDegS: 90, accelMps2: 3,
    };
    const parts: PlacedPart[] = [
      { instanceId: 'reactor', partId: 'R-E25', origin: { x: 1, y: 0 }, rotation: 0, integrity: 1 },
      { instanceId: 'conduit', partId: 'U-CON', origin: { x: 3, y: 0 }, rotation: 0, integrity: 1 },
      { instanceId: 'mg', partId: 'W-MG', origin: { x: 4, y: 0 }, rotation: 0, integrity: 1 },
    ];
    const build: Build = { chassisId: chassis.id, parts, powerPriority: ['mg'] };
    const sim = new Simulation(chassis, build);
    const command = { weaponsEnabled: { mg: true }, speedSetting: 'stationary' as const };

    let shotsBefore = 0;
    for (let i = 0; i < 20; i++) shotsBefore += sim.step(0.05, command).shotsThisTick.length;
    expect(shotsBefore).toBeGreaterThan(0);

    sim.destroyPart('conduit');

    let shotsAfter = 0;
    for (let i = 0; i < 40; i++) shotsAfter += sim.step(0.05, command).shotsThisTick.length;
    expect(shotsAfter).toBe(0);
  });
});

describe('the stat-based hit model (docs/03 §5)', () => {
  // Autocannon-ish baseline: sigma 4 mrad, 600 m/s, at 60 m vs a ~3 m target.
  const base = {
    rangeM: 60, sigmaRad: 0.004, lateralSpeedMps: 0,
    lagS: TRACKING_LAG_BASE_S, projectileSpeed: 600 as number | 'hitscan', targetHalfWidthM: 1.5,
  };

  it('a stationary target at ideal range is nearly always hit', () => {
    expect(computeHitModel(base).pHit).toBeGreaterThan(0.99);
  });

  it('sustained lateral speed lowers hit probability', () => {
    const moving = computeHitModel({ ...base, lateralSpeedMps: 4.5 });
    expect(moving.pHit).toBeLessThan(0.9);
    expect(moving.pHit).toBeGreaterThan(0.2);
  });

  it('slow projectiles are easier to dodge than fast ones at the same range', () => {
    const rocket = computeHitModel({ ...base, lateralSpeedMps: 4.5, projectileSpeed: 250 });
    const railgun = computeHitModel({ ...base, lateralSpeedMps: 4.5, projectileSpeed: 2000 });
    const hitscan = computeHitModel({ ...base, lateralSpeedMps: 4.5, projectileSpeed: 'hitscan' });
    expect(rocket.pHit).toBeLessThan(railgun.pHit);
    expect(railgun.pHit).toBeLessThan(hitscan.pHit);
    // Time-of-flight is the mechanism: staleness = lag + range/speed.
    expect(rocket.aimStalenessS).toBeCloseTo(TRACKING_LAG_BASE_S + 60 / 250, 9);
    expect(hitscan.aimStalenessS).toBeCloseTo(TRACKING_LAG_BASE_S, 9);
  });

  it('a targeting computer buys accuracy back against crossing targets', () => {
    const noTc = computeHitModel({ ...base, lateralSpeedMps: 4.5 });
    const tc = computeHitModel({ ...base, lateralSpeedMps: 4.5, lagS: TRACKING_LAG_TC_S });
    expect(tc.pHit).toBeGreaterThan(noTc.pHit);
  });

  it('dispersion error grows with range even against stationary targets', () => {
    const near = computeHitModel({ ...base, rangeM: 40, sigmaRad: 0.008 });
    const far = computeHitModel({ ...base, rangeM: 120, sigmaRad: 0.008 });
    expect(far.pHit).toBeLessThan(near.pHit);
  });
});

describe('battles run to a decision (docs/03 §1)', () => {
  it('is deterministic: identical seeds produce identical reports', () => {
    const a = runBattle({ builds: [muleGunline(), muleSkirmisher()], seed: 1234 });
    const b = runBattle({ builds: [muleGunline(), muleSkirmisher()], seed: 1234 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('two armed builds trade fire and the battle terminates inside the timeout window', () => {
    const report = runBattle({ builds: [muleGunline(), muleSkirmisher()], seed: 42 });
    expect(report.durationS).toBeLessThanOrEqual(120.1);
    expect(['core-kill', 'mission-kill', 'judges']).toContain(report.reason);
    expect(report.mechs[0].shotsFired + report.mechs[1].shotsFired).toBeGreaterThan(0);
    expect(report.mechs[0].shotsHit + report.mechs[1].shotsHit).toBeGreaterThan(0);
    const victory = report.events[report.events.length - 1];
    expect(victory.type).toBe('victory');
  });

  it('a weaponless mech surrenders after 3 seconds (mission-kill)', () => {
    const report = runBattle({ builds: [muleGunline(), weaponlessMule()], seed: 7 });
    expect(report.winner).toBe(0);
    expect(report.reason).toBe('mission-kill');
    expect(report.durationS).toBeGreaterThanOrEqual(3);
    expect(report.durationS).toBeLessThan(5);
    expect(report.events.some((e) => e.type === 'surrender-countdown' && e.mech === 1)).toBe(true);
  });

  it('an orbiting spider is measurably harder to hit than a head-on target (tracking lag)', () => {
    // Against the radially-approaching mule, the gunline hits nearly everything
    // (no lateral motion -> no tracking error). Against the orbiting spider,
    // sustained crossing speed must cost the shooter real accuracy.
    // Spawn inside both bands so the spider orbits from the first tick; a long
    // spawn would let the gunline shoot through the purely-radial (zero
    // tracking error) approach and wash out the comparison.
    const vsMule = runBattle({ builds: [muleGunline(), muleSkirmisher()], seed: 42, spawnDistanceM: 40 });
    const vsSpider = runBattle({ builds: [muleGunline(), widowOrbiter()], seed: 42, spawnDistanceM: 40 });
    const rate = (r: typeof vsMule) => r.mechs[0].shotsHit / Math.max(r.mechs[0].shotsFired, 1);
    expect(rate(vsMule)).toBeGreaterThan(0.9);
    expect(rate(vsSpider)).toBeLessThan(rate(vsMule) - 0.05);
  });

  it('dispersion makes some shots miss at range but connect up close', () => {
    const report = runBattle({ builds: [muleGunline(), muleSkirmisher()], seed: 99 });
    const shots = report.events.filter((e) => e.type === 'shot');
    expect(shots.some((s) => s.type === 'shot' && !s.hit)).toBe(true);
    expect(shots.some((s) => s.type === 'shot' && s.hit)).toBe(true);
  });
});

describe('salvage integrity scales part HP (docs/04 §3, docs/10 M3)', () => {
  it('a part placed at 40% integrity starts (and reports) at 40% of catalog HP', () => {
    // The gunline shoots a weaponless mech: mech 0 takes no damage, so its
    // final HP fractions are exactly its starting integrities.
    const build = muleGunline();
    const arm = build.parts.find((p) => p.instanceId === 'arm1')!;
    arm.integrity = 0.4;
    const report = runBattle({ builds: [build, weaponlessMule()], seed: 7 });
    expect(report.winner).toBe(0);
    const byId = new Map(report.mechs[0].partsFinalHp.map((p) => [p.instanceId, p.hpFrac]));
    expect(byId.get('arm1')).toBeCloseTo(0.4, 5);
    expect(byId.get('reactor')).toBeCloseTo(1, 5);
    expect(byId.get('ac')).toBeCloseTo(1, 5);
  });

  it('a low-integrity part is destroyed earlier than its pristine twin', () => {
    // Same seed, same battlefield, one dial turned: the armor plate that
    // started at 5% integrity must fall strictly sooner.
    const armDiedAt = (integrity: number) => {
      const build = muleSkirmisher();
      build.parts.find((p) => p.instanceId === 'arm1')!.integrity = integrity;
      const report = runBattle({ builds: [muleGunline(), build], seed: 42 });
      const ev = report.events.find((e) => e.type === 'part-destroyed' && e.mech === 1 && e.instanceId === 'arm1');
      return ev ? ev.tSec : Infinity;
    };
    expect(armDiedAt(0.05)).toBeLessThan(armDiedAt(1));
  });

  it('partsFinalHp covers every part, is 0 for lost parts and in [0,1] for the rest', () => {
    const report = runBattle({ builds: [muleGunline(), muleSkirmisher()], seed: 42 });
    for (const mech of report.mechs) {
      expect(mech.partsFinalHp.length).toBeGreaterThan(0);
      const lost = new Set(mech.partsLost.map((p) => p.instanceId));
      for (const p of mech.partsFinalHp) {
        if (lost.has(p.instanceId)) expect(p.hpFrac).toBe(0);
        expect(p.hpFrac).toBeGreaterThanOrEqual(0);
        expect(p.hpFrac).toBeLessThanOrEqual(1);
      }
    }
  });
});
