import { describe, expect, it } from 'vitest';
import type { Build, PlacedPart } from '../src/types.js';
import { Battle, runBattle, type Controller, type MechOrder } from '../src/combat.js';
import { CORE_INSTANCE_ID } from '../src/thermal.js';

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
    expect(report.arena).toEqual({ lengthM: 200, widthM: 140 });
    const first = report.frames[0]!;
    expect(first.mechs[0].x).toBeLessThan(first.mechs[1].x); // mech 0 spawns on -x
    expect(first.mechs[0].coreHp).toBe(50);

    const bare = runBattle({ builds: [muleGunline(), muleGunline()], seed: 31, recordFrames: false });
    expect(bare.frames).toEqual([]);
  });
});
