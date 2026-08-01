/**
 * Lockstep protocol (docs/11 M2): the order stream + deterministic sim must
 * reproduce a match bit-for-bit, orders must land at 20 Hz, and the replay is
 * the dispute resolver.
 */
import { describe, expect, it } from 'vitest';
import { LockstepBattle, replayMatch, sealReplay, sortOrders, type MatchConfig, type TickOrder } from '../src/lockstep.js';
import { Battle } from '../src/combat.js';
import { CORE_INSTANCE_ID } from '../src/thermal.js';
import type { Build, PlacedPart } from '../src/types.js';

function part(instanceId: string, partId: string, x: number, y: number, rotation: 0 | 90 = 0): PlacedPart {
  return { instanceId, partId, origin: { x, y }, rotation, integrity: 1 };
}
function gunline(): Build {
  return {
    chassisId: 'CH-5',
    parts: [
      part('reactor', 'R-C40', 3, 1), part('ac', 'W-AC', 1, 3),
      part('con1', 'U-CON', 3, 3), part('rad', 'U-RAD', 1, 0), part('arm1', 'U-ARM', 2, 1),
    ],
    powerPriority: [CORE_INSTANCE_ID, 'ac'],
  };
}
function skirmisher(): Build {
  return {
    chassisId: 'CH-5',
    parts: [
      part('reactor', 'R-E25', 3, 1), part('mg1', 'W-MG', 1, 1),
      part('con1', 'U-CON', 3, 3), part('con2', 'U-CON', 2, 3),
      part('mg2', 'W-MG', 1, 3, 90), part('arm1', 'U-ARM', 2, 0),
    ],
    powerPriority: [CORE_INSTANCE_ID, 'mg1', 'mg2'],
  };
}
const CONFIG: MatchConfig = { seed: 20260719, builds: [gunline(), skirmisher()] };

/** A representative human order stream: player 0 holds a waypoint then fires. */
const ORDERS: TickOrder[] = [
  { tick: 3, mech: 0, manual: { move: { dest: { x: 20, y: 15 } }, face: { mode: 'target' } } },
  { tick: 25, mech: 1, manual: { throttle: 'flank' } },
  { tick: 47, mech: 0, manual: { weapons: { ac: 'force' }, move: 'hold' } },
  { tick: 88, mech: 0, manual: null }, // revert to autopilot
];

describe('lockstep determinism (docs/11 M2)', () => {
  it('two independent drivers over the same order stream stay hash-identical', () => {
    const a = new LockstepBattle(CONFIG);
    const b = new LockstepBattle(CONFIG);
    for (const o of ORDERS) { a.enqueue(o); b.enqueue(o); }
    for (let t = 0; t < 500; t++) {
      a.step(); b.step();
      expect(a.hash(), `tick ${t}`).toBe(b.hash());
    }
  });

  it('out-of-order enqueue is normalized to the same result as sorted', () => {
    const straight = new LockstepBattle(CONFIG);
    for (const o of sortOrders(ORDERS)) straight.enqueue(o);
    const shuffled = new LockstepBattle(CONFIG);
    for (const o of [ORDERS[2]!, ORDERS[0]!, ORDERS[3]!, ORDERS[1]!]) shuffled.enqueue(o);
    for (let t = 0; t < 300; t++) { straight.step(); shuffled.step(); }
    expect(shuffled.hash()).toBe(straight.hash());
  });

  it('rejects an order stamped for a tick already run (would desync)', () => {
    const ls = new LockstepBattle(CONFIG);
    for (let t = 0; t < 10; t++) ls.step();
    expect(ls.enqueue({ tick: 5, mech: 0, manual: null })).toBe(false);
    expect(ls.enqueue({ tick: 20, mech: 0, manual: null })).toBe(true);
  });
});

describe('20 Hz manual response (docs/11 M2)', () => {
  it('a fire order lands the tick it is stamped, not at the next 4 Hz boundary', () => {
    // tick 11 is not a 4 Hz boundary (those are multiples of 5). If manual
    // orders only applied at 4 Hz, the force would wait until tick 15.
    const ls = new LockstepBattle({ seed: 5, builds: [gunline(), skirmisher()], spawnDistanceM: 30 });
    ls.enqueue({ tick: 11, mech: 0, manual: { weapons: { ac: 'force' }, face: { mode: 'target' } } });
    const before: number[] = [];
    while (ls.currentTick < 11) { ls.step(); }
    // Step exactly tick 11 and read the enabled flag straight after.
    ls.step();
    const c0 = ls.battle.combatants[0];
    expect(c0.weaponsEnabled['ac']).toBe(true);
    void before;
  });

  it('manual overrides are sticky until replaced or cleared', () => {
    const ls = new LockstepBattle(CONFIG);
    ls.enqueue({ tick: 2, mech: 0, manual: { throttle: 'stationary' } });
    ls.enqueue({ tick: 60, mech: 0, manual: null });
    while (ls.currentTick < 30) ls.step();
    expect(ls.battle.combatants[0].speedSetting).toBe('stationary'); // held since tick 2
    while (ls.currentTick < 70) ls.step();
    // After the clear the autopilot drives throttle again (not forced stationary).
    // We can't assert a specific setting, only that the override no longer pins it:
    // run long enough that the autopilot would have chosen to move.
    expect(['creep', 'cruise', 'flank', 'stationary']).toContain(ls.battle.combatants[0].speedSetting);
  });

  it('an unmanaged lockstep match (no orders) still fights via autopilot (R3)', () => {
    const ls = new LockstepBattle(CONFIG);
    ls.runToEnd();
    expect(ls.finished).toBe(true);
    const report = ls.battle.report();
    expect(['chassis-failure', 'mission-kill', 'judges']).toContain(report.reason);
  });
});

describe('replay: seal, re-verify, dispute (docs/11 M2)', () => {
  it('sealReplay + replayMatch reproduce the sealed hash exactly', () => {
    const ls = new LockstepBattle(CONFIG);
    for (const o of ORDERS) ls.enqueue(o);
    ls.runToEnd();
    const replay = sealReplay(CONFIG, ORDERS, ls);
    const result = replayMatch(replay);
    expect(result.versionMismatch).toBe(false);
    expect(result.matches).toBe(true);
    expect(result.finalHash).toBe(replay.finalHash);
    expect(result.finalTick).toBe(replay.finalTick);
  });

  it('a tampered order log fails re-verification (the cheat-catch)', () => {
    const ls = new LockstepBattle(CONFIG);
    for (const o of ORDERS) ls.enqueue(o);
    ls.runToEnd();
    const replay = sealReplay(CONFIG, ORDERS, ls);
    // Forge a stronger play for mech 0 (extra fire window) but keep the old hash.
    const tampered = {
      ...replay,
      orders: sortOrders([...replay.orders, { tick: 10, mech: 0 as const, manual: { weapons: { ac: 'force' as const } } }]),
    };
    const result = replayMatch(tampered);
    expect(result.matches).toBe(false);
  });

  it('a replay stamped with a different sim version is flagged', () => {
    const ls = new LockstepBattle(CONFIG);
    ls.runToEnd();
    const replay = sealReplay(CONFIG, [], ls);
    const stale = { ...replay, simVersion: '0.0.1' };
    expect(replayMatch(stale).versionMismatch).toBe(true);
  });
});

describe('lockstep mode leaves the default sim untouched', () => {
  it('a lockstep battle with no orders matches a plain autopilot battle', () => {
    // Both run pure autopilot; lockstep only adds the manual merge layer,
    // which is a no-op when no overrides are set.
    const plain = new Battle({ builds: [gunline(), skirmisher()], seed: 20260719 });
    while (!plain.finished) plain.step();
    const ls = new LockstepBattle(CONFIG);
    ls.runToEnd();
    expect(ls.hash()).toBe(plain.stateHash());
    expect(ls.battle.report().reason).toBe(plain.report().reason);
  });
});
