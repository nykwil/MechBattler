import { describe, expect, it } from 'vitest';
import type { Build, PlacedPart } from '../src/types.js';
import {
  Battle, runBattle, computeHitModel, withManualOrders, autopilotController,
  MOVE_JITTER_MRAD_PER_MPS, TRACKING_LAG_BASE_S, type Controller, type MechOrder,
} from '../src/combat.js';
import { TEMPLATES } from '../src/templates.js';
import { CORE_INSTANCE_ID } from '../src/thermal.js';
import { getChassis } from '../src/chassis.js';

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

describe('the order channel (RTS verbs, docs/03 §7)', () => {
  it('a custom controller replaces the autopilot: hold-fire + hold-position never moves or shoots', () => {
    const pacifist: Controller = ({ self }) => {
      const enabled: Record<string, boolean> = {};
      for (const p of self.build.parts) enabled[p.instanceId] = false;
      return [
        { verb: 'weapons', enabled },
        { verb: 'move', intent: 'hold', dest: null },
        { verb: 'throttle', setting: 'stationary' },
        { verb: 'face', mode: 'bearing', bearingRad: 0 },
      ] satisfies MechOrder[];
    };
    const battle = new Battle({
      builds: [muleGunline(), muleGunline()],
      seed: 11,
      controllers: [pacifist, pacifist],
      timeoutS: 10,
    });
    const startX = battle.combatants.map((c) => c.pos.x);
    while (battle.step()) { /* tick */ }
    const report = battle.report();
    expect(report.mechs[0].shotsFired + report.mechs[1].shotsFired).toBe(0);
    expect(battle.combatants[0].pos.x).toBeCloseTo(startX[0]!, 5);
    expect(battle.combatants[1].pos.x).toBeCloseTo(startX[1]!, 5);
    expect(report.reason).toBe('judges');
  });

  it('order events log decisions, not 4 Hz re-issues', () => {
    const report = runBattle({ builds: [muleGunline(), muleGunline()], seed: 21 });
    const orders = report.events.filter((e) => e.type === 'order');
    expect(orders.length).toBeGreaterThan(0);
    // Far fewer order events than command ticks (4 Hz x 2 mechs over the battle).
    const commandIssues = Math.ceil(report.durationS * 4) * 2 * 4;
    expect(orders.length).toBeLessThan(commandIssues / 4);
    // The opening decisions exist: both mechs start by closing at flank speed.
    expect(orders.some((e) => e.type === 'order' && e.mech === 0 && e.order.verb === 'move' && e.order.intent === 'close')).toBe(true);
    expect(orders.some((e) => e.type === 'order' && e.mech === 0 && e.order.verb === 'throttle')).toBe(true);
  });

  it('reports carry playback frames covering the whole battle, and recordFrames:false omits them', () => {
    const report = runBattle({ builds: [muleGunline(), muleGunline()], seed: 31 });
    expect(report.frames.length).toBeGreaterThan(0);
    expect(report.frames[report.frames.length - 1]!.tSec).toBeCloseTo(report.durationS, 5);
    expect(report.arena).toEqual({ lengthM: 240, widthM: 240 });
    const first = report.frames[0]!;
    expect(first.mechs[0].x).toBeLessThan(first.mechs[1].x); // mech 0 spawns on -x
    expect(first.mechs[0].coreHp).toBe(getChassis('CH-5').maxIntegrity);

    const bare = runBattle({ builds: [muleGunline(), muleGunline()], seed: 31, recordFrames: false });
    expect(bare.frames).toEqual([]);
  });

  it('a live renderer can follow a stepping battle: latestFrame/timeS/arena track each tick', () => {
    const battle = new Battle({ builds: [muleGunline(), muleGunline()], seed: 31 });
    expect(battle.latestFrame()).toBeNull();
    expect(battle.timeS).toBe(0);
    expect(battle.arena).toEqual({ lengthM: 240, widthM: 240 });

    battle.step();
    const f1 = battle.latestFrame();
    expect(f1).not.toBeNull();
    expect(f1!.tSec).toBeCloseTo(battle.timeS, 9);
    expect(battle.frames.length).toBe(1);

    while (battle.step()) { /* run out */ }
    expect(battle.finished).toBe(true);
    // The live tail and the report are the same recording (docs/08 invariant:
    // a played battle is automatically a replay).
    const report = battle.report();
    expect(report.frames).toBe(battle.frames);
    expect(battle.latestFrame()).toBe(report.frames[report.frames.length - 1]);
    expect(report.durationS).toBeCloseTo(battle.timeS, 9);
  });
});

describe('manual order overrides (docs/08 §3): the player merge over the autopilot', () => {
  it('a standing hold pins the mech in place and logs MOVE: HOLD', () => {
    const player = withManualOrders(autopilotController, () => ({ move: 'hold' }));
    const battle = new Battle({
      builds: [muleGunline(), muleGunline()], seed: 5,
      controllers: [player, autopilotController], timeoutS: 15,
    });
    while (battle.step()) { /* run out */ }
    const start = battle.frames[0]!.mechs[0];
    const end = battle.latestFrame()!.mechs[0];
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(1);
    expect(battle.events.some(
      (e) => e.type === 'order' && e.mech === 0 && e.order.verb === 'move' && e.order.intent === 'hold',
    )).toBe(true);
    // The autopilot-driven enemy moved normally.
    const foeStart = battle.frames[0]!.mechs[1];
    const foeEnd = battle.latestFrame()!.mechs[1];
    expect(Math.hypot(foeEnd.x - foeStart.x, foeEnd.y - foeStart.y)).toBeGreaterThan(10);
  });

  it('a waypoint order marches the mech to the point (intent `direct`), leaving other verbs on auto', () => {
    const player = withManualOrders(autopilotController, () => ({ move: { dest: { x: 0, y: 0 } } }));
    const battle = new Battle({
      builds: [muleGunline(), muleGunline()], seed: 5,
      controllers: [player, autopilotController], timeoutS: 40,
    });
    let closest = Infinity;
    while (battle.step()) {
      const m = battle.latestFrame()!.mechs[0];
      closest = Math.min(closest, Math.hypot(m.x, m.y));
    }
    expect(closest).toBeLessThan(8);
    expect(battle.events.some(
      (e) => e.type === 'order' && e.mech === 0 && e.order.verb === 'move' && e.order.intent === 'direct',
    )).toBe(true);
    // Weapons stayed under fire control: the held-back player still shot.
    expect(battle.events.some((e) => e.type === 'shot' && e.mech === 0)).toBe(true);
  });

  it('weapon overrides: hold silences a gun the autopilot would fire; force frees a gated one', () => {
    const build = muleGunline();
    const gunIds = ['ac'];
    // Hold-fire on every gun: the player never shoots for the whole battle.
    const holdAll = withManualOrders(autopilotController, () => ({
      weapons: Object.fromEntries(gunIds.map((id) => [id, 'hold' as const])),
    }));
    const held = new Battle({ builds: [build, muleGunline()], seed: 7, controllers: [holdAll, autopilotController], timeoutS: 30 });
    while (held.step()) { /* run out */ }
    expect(held.events.some((e) => e.type === 'shot' && e.mech === 0)).toBe(false);
    expect(held.events.some((e) => e.type === 'shot' && e.mech === 1)).toBe(true);

    // Force-fire while holding position at a ~236 m spawn — beyond the AC's
    // despawn bound (~169 m), where the autopilot's range gate holds fire.
    // Force overrides the gate (the shots just despawn; that's physics).
    const autoHold = withManualOrders(autopilotController, () => ({ move: 'hold' }));
    const forceHold = withManualOrders(autopilotController, () => ({
      move: 'hold',
      weapons: { ac: 'force' },
    }));
    const far = { spawnDistanceM: 236, timeoutS: 6 };
    const gated = new Battle({ builds: [build, muleGunline()], seed: 7, controllers: [autoHold, autopilotController], ...far });
    const forced = new Battle({ builds: [build, muleGunline()], seed: 7, controllers: [forceHold, autopilotController], ...far });
    while (gated.step()) { /* run out */ }
    while (forced.step()) { /* run out */ }
    const shotsBefore = (b: Battle, t: number) => b.events.filter((e) => e.type === 'shot' && e.mech === 0 && e.tSec < t).length;
    expect(shotsBefore(gated, 4)).toBe(0);
    expect(shotsBefore(forced, 4)).toBeGreaterThan(0);
  });

  it('face overrides: a held bearing pins the facing; face-movement turns into the direction of travel', () => {
    const bearing = Math.PI / 2;
    const pinned = withManualOrders(autopilotController, () => ({
      move: 'hold',
      face: { mode: 'bearing', bearingRad: bearing },
    }));
    const battle = new Battle({ builds: [muleGunline(), muleGunline()], seed: 9, controllers: [pinned, autopilotController], timeoutS: 12 });
    while (battle.step()) { /* run out */ }
    const end = battle.latestFrame()!.mechs[0];
    expect(end.faceMode).toBe('bearing');
    const off = Math.abs(Math.atan2(Math.sin(end.facingRad - bearing), Math.cos(end.facingRad - bearing)));
    expect(off).toBeLessThan(0.05);

    // Face-movement while marching +x to a waypoint: facing settles along +x
    // even though the enemy (the default face target) sits off-axis.
    const marcher = withManualOrders(autopilotController, () => ({
      move: { dest: { x: 100, y: 0 } },
      face: 'movement',
    }));
    const march = new Battle({ builds: [muleGunline(), muleGunline()], seed: 9, controllers: [marcher, autopilotController], timeoutS: 8 });
    while (march.step()) { /* run out */ }
    const frames = march.frames.filter((f) => f.tSec > 3 && f.tSec < 7);
    const m = frames[Math.floor(frames.length / 2)]!.mechs[0];
    expect(m.faceMode).toBe('bearing');
    expect(Math.abs(Math.atan2(Math.sin(m.facingRad), Math.cos(m.facingRad)))).toBeLessThan(0.4);
  });

  it('onArrival fires when the mech reaches a manual waypoint', () => {
    let arrived = false;
    const player = withManualOrders(
      autopilotController,
      () => (arrived ? {} : { move: { dest: { x: -40, y: 0 } } }),
      () => { arrived = true; },
    );
    const battle = new Battle({ builds: [muleGunline(), muleGunline()], seed: 3, controllers: [player, autopilotController], timeoutS: 30 });
    while (battle.step()) { /* run out */ }
    expect(arrived).toBe(true);
  });

  it('weapon frames name the fire-control gate: range when beyond reach, arc when faced away', () => {
    // Spawned at 236 m, everything is beyond even the AC's 195 m despawn bound.
    const far = new Battle({ builds: [muleGunline(), muleGunline()], seed: 7, spawnDistanceM: 236, timeoutS: 2 });
    far.step();
    const farGuns = far.latestFrame()!.mechs[0].weapons;
    expect(farGuns.length).toBeGreaterThan(0);
    for (const w of farGuns) expect(w.gate).toBe('range');

    // Pinned perpendicular at the default 160 m spawn: the AC (60° arc) is in
    // reach but out of arc; once the fight closes inside its band it clears.
    const sideways = withManualOrders(autopilotController, () => ({
      move: 'hold',
      face: { mode: 'bearing', bearingRad: Math.PI / 2 },
    }));
    const battle = new Battle({ builds: [muleGunline(), muleGunline()], seed: 7, controllers: [sideways, autopilotController], timeoutS: 8 });
    while (battle.step()) { /* run out */ }
    const late = battle.frames.filter((f) => f.tSec > 4);
    const acGates = late.map((f) => f.mechs[0].weapons.find((w) => w.instanceId === 'ac')!.gate);
    expect(acGates.every((g) => g === 'arc')).toBe(true);
  });

  it('auto-face on a manual waypoint aims at the waypoint, not the autopilot\'s flee point (dead guns)', () => {
    // A weaponless mech (as after losing its guns): the autopilot wants to
    // flee away from the enemy and would face that way. With a manual
    // waypoint perpendicular to the enemy axis and face on auto, the mech
    // must face its actual travel direction (+y) for the forward-speed win.
    const gunless = muleGunline();
    gunless.parts = gunless.parts.filter((p) => p.instanceId !== 'ac');
    const player = withManualOrders(autopilotController, () => ({ move: { dest: { x: -80, y: 60 } } }));
    const battle = new Battle({
      builds: [gunless, muleGunline()],
      seed: 5,
      controllers: [player, autopilotController],
      timeoutS: 8,
      suppressSurrender: true,
    });
    while (battle.step()) { /* run out */ }
    const frames = battle.frames.filter((f) => f.tSec > 3 && f.tSec < 7);
    const m = frames[Math.floor(frames.length / 2)]!.mechs[0];
    const toDest = Math.atan2(60 - m.y, -80 - m.x);
    const off = Math.abs(Math.atan2(Math.sin(m.facingRad - toDest), Math.cos(m.facingRad - toDest)));
    expect(off).toBeLessThan(0.4);
  });
});

describe('motion jitter (docs/03 §4): additive error punishes precision guns most', () => {
  // Each gun at its own working range, against a light mech's ~0.6 m
  // projected half-width (the regime where the additive jitter bites).
  const at = (baseMrad: number, rangeM: number, speedMps: number) => computeHitModel({
    rangeM,
    sigmaRad: (baseMrad + MOVE_JITTER_MRAD_PER_MPS * speedMps) * 0.001,
    lateralSpeedMps: 0,
    lagS: TRACKING_LAG_BASE_S,
    projectileSpeed: 800,
    targetHalfWidthM: 0.6,
  }).pHit;

  it('a railgun at its range loses far more hit% on the move than a machine gun at its own', () => {
    const railgunLoss = at(1.2, 240, 0) - at(1.2, 240, 6);
    const mgLoss = at(8.0, 60, 0) - at(8.0, 60, 6);
    expect(railgunLoss).toBeGreaterThan(2 * Math.max(mgLoss, 1e-9));
    expect(at(1.2, 240, 0)).toBeGreaterThan(0.9); // standing still, the sniper is deadly
  });
});

describe('exchange-optimizing autopilot (docs/03 §7 rewrite)', () => {
  const get = (id: string) => TEMPLATES.find((t) => t.id === id)!.build;

  it('an out-of-reach brawler faces its direction of travel, then the target once in reach', () => {
    // Bastion (Maul, ~58 m reach) spawns at 160 m: it should close while
    // facing the travel bearing (fast forward speed), switching to target
    // tracking once the gun can bear.
    const report = runBattle({ builds: [get('vulture-sniper'), get('bastion-tank')], seed: 77 });
    const faces = report.events.filter((e) => e.type === 'order' && e.mech === 1 && e.order.verb === 'face');
    expect(faces.length).toBeGreaterThanOrEqual(2);
    expect(faces[0]!.type === 'order' && faces[0]!.order.verb === 'face' && faces[0]!.order.mode).toBe('bearing');
    expect(faces.some((e) => e.type === 'order' && e.order.verb === 'face' && e.order.mode === 'target')).toBe(true);
  });

  it('a pressed sniper stands or gives ground; it never brawls forward into the tank', () => {
    const report = runBattle({ builds: [get('vulture-sniper'), get('bastion-tank')], seed: 77 });
    const sniperMoves = report.events
      .filter((e) => e.type === 'order' && e.mech === 0 && e.order.verb === 'move')
      .map((e) => (e.type === 'order' && e.order.verb === 'move' ? e.order.intent : ''));
    expect(sniperMoves).toContain('retreat');
  });

  it('an out-ranged, losing mech turns tail (flee at forward speed, guns off target)', () => {
    const report = runBattle({ builds: [get('vulture-skirmisher'), get('mule-gunline')], seed: 77 });
    const fled = report.events.some((e) => e.type === 'order' && e.order.verb === 'move' && e.order.intent === 'flee');
    expect(fled).toBe(true);
  });
});
