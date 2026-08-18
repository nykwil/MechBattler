import { describe, expect, it } from 'vitest';
import type { Build, ChassisSpec, PlacedPart } from '../src/types.js';
import { Simulation } from '../src/simulation.js';
import {
  Battle, Combatant, autopilotController, runBattle, computeHitModel, meanSilhouetteHalfWidthM,
  TRACKING_LAG_S, type Controller,
} from '../src/combat.js';
import { generateTerrain } from '../src/terrain.js';
import { getPart } from '../src/catalog.js';

/**
 * The targeting computer's strength is a catalog field now, not a constant, so
 * the tests read the shipped value. When it was an import of a since-deleted
 * constant, two of these passed vacuously against `undefined`.
 */
const TC_MULT = getPart('U-TC1').fireControlLateralMult!;
import { CORE_INSTANCE_ID } from '../src/thermal.js';
import { getChassis } from '../src/chassis.js';
import { BRANCH_PROBE_TEMPLATES, TEMPLATES } from '../src/templates.js';

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

  it('the legacy explicit ray helper can still address the old internal cell', () => {
    const build: Build = {
      chassisId: 'CH-5',
      parts: [{ instanceId: 'reactor', partId: 'R-E25', origin: { x: 3, y: 1 }, rotation: 0, integrity: 1 }],
      powerPriority: [],
    };
    const target = new Combatant(build, { x: 0, y: 0 }, 0);
    // Column x=2 is empty down to the core at (2,2); offset the ray line to that column.
    const result = target.applyRay({ x: 20, y: 0.25 }, { x: -1, y: 0 }, 60);
    expect(result.damaged[0]).toEqual({ instanceId: CORE_INSTANCE_ID, partId: CORE_INSTANCE_ID, damage: 60 });
    expect(target.coreHp).toBe(getChassis('CH-5').maxIntegrity - 60);
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
    lagS: TRACKING_LAG_S, projectileSpeed: 600 as number | 'hitscan', targetHalfWidthM: 1.5,
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
    expect(rocket.aimStalenessS).toBeCloseTo(TRACKING_LAG_S + 60 / 250, 9);
    expect(hitscan.aimStalenessS).toBeCloseTo(TRACKING_LAG_S, 9);
  });

  /**
   * The targeting computer now scales the lateral-target penalty rather than
   * fire-control lag. The distinction is the point: it must help against a
   * crosser and do nothing at all against a target standing still, because
   * "hard to hit while moving" and "hard to hit at range" are separate problems
   * with separate counters.
   */
  it('a targeting computer buys accuracy back against crossing targets', () => {
    const noTc = computeHitModel({ ...base, lateralSpeedMps: 4.5 });
    const tc = computeHitModel({
      ...base, lateralSpeedMps: 4.5, lateralPenaltyMult: TC_MULT,
    });
    expect(tc.pHit).toBeGreaterThan(noTc.pHit);
  });

  it('a targeting computer does nothing against a stationary target', () => {
    const noTc = computeHitModel({ ...base, lateralSpeedMps: 0 });
    const tc = computeHitModel({
      ...base, lateralSpeedMps: 0, lateralPenaltyMult: TC_MULT,
    });
    expect(tc.pHit).toBe(noTc.pHit);
  });

  /** Time of flight rides on lag, and the TC must not quietly shorten it. */
  it('a targeting computer does not change aim staleness', () => {
    const noTc = computeHitModel({ ...base, lateralSpeedMps: 4.5 });
    const tc = computeHitModel({
      ...base, lateralSpeedMps: 4.5, lateralPenaltyMult: TC_MULT,
    });
    expect(tc.aimStalenessS).toBe(noTc.aimStalenessS);
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
    expect(['chassis-failure', 'mission-kill', 'judges']).toContain(report.reason);
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
    //
    // Seed moved 42 -> 26, Aug 2026. The property is unchanged; the old seed
    // stopped exhibiting it. Since the autopilot learned to close on a slant
    // this matchup resolves before the gunline strips that plate, so `arm1`
    // survived both runs and the assertion compared two Infinities — passing
    // vacuously would have been worse than failing. Seed 26 still grinds it
    // down, at 1.8 s against 40.8 s; 8 of the first 200 seeds do.
    const armDiedAt = (integrity: number) => {
      const build = muleSkirmisher();
      build.parts.find((p) => p.instanceId === 'arm1')!.integrity = integrity;
      const report = runBattle({ builds: [muleGunline(), build], seed: 26 });
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

/**
 * Locomotion is a continuous load (1.2 kW per tonne per m/s), so a bus that
 * cannot cover the commanded throttle should move the mech slower — not park
 * it. Shedding the core whole was the workshop test bench's simplification, and
 * the arena inherited it silently: `probe-bastion-suppression` splits its two
 * reactors across two networks, leaving the core on a 25 kW island against a
 * ~31 kW flank draw, so it stood on its spawn mark for an entire battle and
 * lost without firing a shot. Two other shipped starting builds did the same.
 */
describe('partial locomotion power slows a mech instead of freezing it', () => {
  const underpowered = () => structuredClone(
    BRANCH_PROBE_TEMPLATES.find((t) => t.id === 'probe-bastion-suppression')!.build,
  );

  it('a mech whose bus cannot cover flank still crosses the arena and fires', () => {
    const report = runBattle({ builds: [underpowered(), muleSkirmisher()], seed: 7 });
    const start = report.frames[0]!.mechs[0];
    const travelled = report.frames.reduce((far, f) =>
      Math.max(far, Math.hypot(f.mechs[0].x - start.x, f.mechs[0].y - start.y)), 0);
    expect(travelled, 'it should leave the spawn mark').toBeGreaterThan(20);
    expect(report.mechs[0].shotsFired).toBeGreaterThan(0);
  });

  it('and it moves slower than the same order on a bus that can feed it', () => {
    const chassis = getChassis(underpowered().chassisId);
    const sim = new Simulation(chassis, underpowered());
    let snapshot = sim.step(0.05, { speedSetting: 'flank', weaponsEnabled: {} });
    // Reactors spool up; sample once supply has settled.
    for (let t = 0; t < 100; t++) snapshot = sim.step(0.05, { speedSetting: 'flank', weaponsEnabled: {} });
    expect(snapshot.locomotionPowerFrac).toBeGreaterThan(0);
    expect(snapshot.locomotionPowerFrac).toBeLessThan(1);
    // Starved, but never shed: a fraction of the drive is still the drive.
    expect(snapshot.shedInstanceIds).not.toContain(CORE_INSTANCE_ID);
  });
});

/**
 * The exchange-optimizing autopilot prices standing ranges, not the transit
 * between them — nothing upstream stops two mechs closing on each other from
 * opposite sides in the same tick and walking through their own hulls. This
 * is the floor that actually stops that, checked with a controller that does
 * nothing but ram, so the autopilot's own restraint can't mask a missing one.
 */
describe('body collision (a floor no order can close past)', () => {
  const rammer: Controller = ({ enemy }) => [
    { verb: 'weapons', enabled: {} },
    { verb: 'move', intent: 'close', dest: { x: enemy.pos.x, y: enemy.pos.y } },
    { verb: 'throttle', setting: 'flank' },
    { verb: 'face', mode: 'target' },
  ];

  it('never lets two mechs occupy less than their combined hull radius', () => {
    const build = muleGunline();
    const chassis = getChassis(build.chassisId);
    const minSepM = meanSilhouetteHalfWidthM(chassis) * 2;
    const battle = new Battle({
      builds: [build, structuredClone(build)],
      seed: 1,
      controllers: [rammer, rammer],
      suppressSurrender: true,
      recordFrames: false,
    });
    let minSeen = Infinity;
    for (let i = 0; i < 1000 && battle.step(); i++) {
      const [a, b] = battle.combatants;
      const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
      if (d < minSeen) minSeen = d;
    }
    // They actually closed the distance (this would be a vacuous pass on a
    // controller that never moved), and never closer than the hull floor.
    expect(minSeen).toBeLessThan(minSepM + 1);
    expect(minSeen).toBeGreaterThanOrEqual(minSepM - 1e-6);
  });

  /**
   * The hull push used to run after the wall clamp and nothing re-clamped, so
   * a mech already flat against a wall could be shoved back out through it and
   * that position written straight into the recorded frame. Small -- 3 mm in an
   * 8 m arena, and unreachable at 60 m -- but a recorded position being inside
   * the arena should be an invariant rather than a near-miss, and a cramped
   * arena is exactly where a future ram or knockback would make it not one.
   */
  it('never records a position outside the arena, even pinned in a corner', () => {
    const build = () => structuredClone(
      TEMPLATES.find((t) => t.id === 'bastion-tank')!.build,
    );
    for (const [lengthM, widthM, spawnDistanceM] of [[20, 20, 8], [8, 8, 4]] as const) {
      for (let seed = 1; seed <= 6; seed += 1) {
        const battle = new Battle({
          builds: [build(), build()],
          seed, spawnDistanceM, arenaLengthM: lengthM, arenaWidthM: widthM, timeoutS: 25,
        });
        while (battle.step()) { /* run it out */ }
        expect(battle.frames.length).toBeGreaterThan(0);
        for (const frame of battle.frames) {
          for (const mech of frame.mechs) {
            expect(Math.abs(mech.x), `seed ${seed} @${lengthM}m`).toBeLessThanOrEqual(lengthM / 2);
            expect(Math.abs(mech.y), `seed ${seed} @${lengthM}m`).toBeLessThanOrEqual(widthM / 2);
          }
        }
      }
    }
  });

  it("won't hold a gun's trigger down inside its own dead zone", () => {
    // muleGunline's W-AC (Judge) has idealMin > 0, so falloffAt(def, 0) is 0
    // (docs/03 §5, test/minrange.test.ts) — a shot from contact range is a
    // shot the sim itself prices at zero damage. Two Combatants placed on
    // top of each other exercise the autopilot's own weapon-enable gate
    // directly, without needing a rammer to walk them there first.
    const build = muleGunline();
    const pos = { x: 0, y: 0 };
    const self = new Combatant(build, pos, 0);
    const enemy = new Combatant(structuredClone(build), { x: 0, y: 0 }, Math.PI);
    const terrain = generateTerrain(1, 400, 300);
    const orders = autopilotController({ self, enemy, snapshot: null, terrain, tSec: 0, tick: 0 });
    const weaponsOrder = orders.find((o) => o.verb === 'weapons')!;
    expect(weaponsOrder.verb).toBe('weapons');
    if (weaponsOrder.verb === 'weapons') {
      expect(weaponsOrder.enabled['ac']).toBe(false);
    }
  });

  /**
   * The gate above only ever bites for real on W-MG, the one gun that authors
   * `falloff.min` -- everything else ramps from 0 and is positive at any range
   * a hull collision permits. The frame the HUD reads had no reason code for
   * it: a Stitcher inside its 10 m floor was silenced by the sim while the
   * readout said nothing was stopping it.
   */
  it('names the minimum-range gate in the frame the readout reads', () => {
    const mgBuild = () => structuredClone(
      TEMPLATES.find((t) => t.id === 'mule-skirmisher')!.build,
    );
    const inside = new Battle({
      builds: [mgBuild(), mgBuild()],
      // 4 m spawn settles at 9.6 m after the first tick's hull push -- inside
      // the Stitcher's 10 m floor, and far enough out that the gun is still
      // powered rather than shed, so the gate is the only thing silencing it.
      seed: 7, spawnDistanceM: 4, timeoutS: 1,
    });
    inside.step();
    const mg = inside.frames[0]!.mechs[0]!.weapons.find((w) => w.instanceId === 'mg1')!;
    expect(mg.status).toBe('ok');
    expect(mg.gate).toBe('minrange');

    // Outside the floor and the same gun reports clear, so the reason is the
    // range band and not some other silence standing in for it.
    const outside = new Battle({
      builds: [mgBuild(), mgBuild()],
      seed: 7, spawnDistanceM: 30, timeoutS: 1,
    });
    outside.step();
    const far = outside.frames[0]!.mechs[0]!.weapons.find((w) => w.instanceId === 'mg1')!;
    expect(far.status).toBe('ok');
    expect(far.gate).toBe(null);
  });
});

/**
 * Coil-sprung / gyro flywheel / weaving gait (docs/04 §4b) are chassis-wide:
 * one actuator changes every gun's dispersion, unlike Gyrostabilized which
 * only buys down the weapon carrying it. That needs a real aggregator
 * (`Combatant.mechMoveJitterMult` / `turnJitterMult`, same shape as the
 * existing `profileMult`), so these exercise the aggregator directly rather
 * than only the pure `effectiveMults` math modifiers.test.ts already covers.
 */
describe('movement mods aggregate mech-wide, not per-weapon', () => {
  function buildWithActuator(mods: string[]): Build {
    return {
      chassisId: 'CH-5',
      parts: [
        { instanceId: 'reactor', partId: 'R-C40', origin: { x: 3, y: 1 }, rotation: 0, integrity: 1 },
        { instanceId: 'act', partId: 'U-ACT', origin: { x: 4, y: 4 }, rotation: 0, integrity: 1, modifiers: mods },
      ],
      powerPriority: [CORE_INSTANCE_ID],
    };
  }

  it('coil-sprung lowers the mech-wide own-motion jitter multiplier', () => {
    const c = new Combatant(buildWithActuator(['coil-sprung']), { x: 0, y: 0 }, 0);
    expect(c.mechMoveJitterMult('open')).toBeCloseTo(0.6);
  });

  it('gyro flywheel lowers the turn-jitter multiplier', () => {
    const c = new Combatant(buildWithActuator(['gyro-flywheel']), { x: 0, y: 0 }, 0);
    expect(c.turnJitterMult('open')).toBeCloseTo(0.5);
  });

  it('weaving gait raises jitter unconditionally but only shrinks the profile above 4 m/s', () => {
    const c = new Combatant(buildWithActuator(['weaving-gait']), { x: 0, y: 0 }, 0);
    expect(c.mechMoveJitterMult('open')).toBeCloseTo(1.3);
    expect(c.profileMult('open', 3)).toBe(1);
    expect(c.profileMult('open', 5)).toBeCloseTo(0.8);
  });

  it('a destroyed actuator stops contributing', () => {
    const c = new Combatant(buildWithActuator(['coil-sprung']), { x: 0, y: 0 }, 0);
    c.sim.destroyPart('act');
    expect(c.mechMoveJitterMult('open')).toBe(1);
  });
});
