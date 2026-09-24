import { describe, expect, it } from 'vitest';
import { Battle, autopilotController, withManualOrders, type ManualOrders } from '../src/combat.js';
import { TEMPLATES } from '../src/templates.js';
import { getPart } from '../src/catalog.js';
import { HEAT_RESTART_C, HEAT_SHUTDOWN_C, Simulation } from '../src/simulation.js';
import { getChassis } from '../src/chassis.js';
import { applyAutoWire } from '../src/autowire.js';

/** MW spec §3: Alpha fires every loaded gun once, then leaves each in its previous state. */
const gunline = TEMPLATES.find((t) => t.id === 'mule-gunline')!.build;

function fight(manual: () => ManualOrders) {
  return new Battle({
    builds: [gunline, gunline], seed: 9, spawnDistanceM: 60, timeoutS: 30,
    controllers: [withManualOrders(autopilotController, manual), autopilotController],
  });
}
const gunIds = gunline.parts.filter((p) => getPart(p.partId).category === 'weapon').map((p) => p.instanceId);
const hold = Object.fromEntries(gunIds.map((id) => [id, 'hold' as const]));

describe('Alpha', () => {
  it('fires each loaded gun exactly once, even though the order is re-issued every command tick', () => {
    let m: ManualOrders = { weapons: hold };
    const battle = fight(() => m);
    for (let t = 0; t < 100; t++) battle.step();       // 5 s held: everything loads
    m = { weapons: hold, alpha: 1 };
    for (let t = 0; t < 100; t++) battle.step();       // 5 s more with the same token
    const alphas = battle.events.filter((e) => e.type === 'alpha' && e.mech === 0);
    expect(alphas).toHaveLength(1);
    const shots = battle.events.filter((e) => e.type === 'shot' && e.mech === 0);
    for (const id of gunIds) expect(shots.filter((e) => e.type === 'shot' && e.instanceId === id)).toHaveLength(1);
  });

  it('a new token fires again once the guns have reloaded', () => {
    let m: ManualOrders = { weapons: hold };
    const battle = fight(() => m);
    for (let t = 0; t < 100; t++) battle.step();
    m = { weapons: hold, alpha: 1 };
    for (let t = 0; t < 200; t++) battle.step();
    m = { weapons: hold, alpha: 2 };
    for (let t = 0; t < 20; t++) battle.step();
    expect(battle.events.filter((e) => e.type === 'alpha' && e.mech === 0)).toHaveLength(2);
  });

  it('an unloaded gun ignores the token rather than firing when it later loads', () => {
    let m: ManualOrders = { weapons: hold };
    const battle = fight(() => m);
    for (let t = 0; t < 100; t++) battle.step();
    m = { weapons: hold, alpha: 1 };
    // Fired; now reloading. This relies on every gun on the template taking
    // longer than 0.5 s to reload -- assert it rather than assume it.
    for (const id of gunIds) expect(getPart(gunline.parts.find((p) => p.instanceId === id)!.partId).weapon!.cycleS).toBeGreaterThan(0.6);
    for (let t = 0; t < 10; t++) battle.step();
    m = { weapons: hold, alpha: 2 };                       // pressed while nothing is loaded
    const before = battle.events.filter((e) => e.type === 'shot' && e.mech === 0).length;
    for (let t = 0; t < 200; t++) battle.step();
    expect(battle.events.filter((e) => e.type === 'shot' && e.mech === 0).length).toBe(before);
  });
  it('a gun that drops out of loaded after the press loses it, rather than firing held once it recovers', () => {
    let m: ManualOrders = { weapons: hold };
    const battle = fight(() => m);
    const sim = battle.combatants[0].sim;
    const gunCells = [...sim.thermal.cells.values()].filter((c) => gunIds.includes(c.instanceId));
    expect(gunCells.length).toBeGreaterThan(0);
    const pin = (tempC: number) => { for (const c of gunCells) c.tempC = tempC; };
    for (let t = 0; t < 100; t++) battle.step();       // held and loaded; tick 100 issues orders next
    // Arm, and shut the guns down before the step that would fire them.
    m = { weapons: hold, alpha: 1 };
    for (let t = 0; t < 5; t++) { pin(HEAT_SHUTDOWN_C + 5); battle.step(); }
    expect(battle.events.filter((e) => e.type === 'alpha' && e.mech === 0)).toHaveLength(1);
    for (const id of gunIds) expect(battle.events.some((e) => e.type === 'shutdown' && e.mech === 0 && e.instanceId === id)).toBe(true);
    // Cool below restart and give them long enough to reload, still held.
    pin(HEAT_RESTART_C - 60);
    for (let t = 0; t < 100; t++) battle.step();
    expect(sim.volleyPendingIds()).toEqual([]);
    expect(battle.events.filter((e) => e.type === 'shot' && e.mech === 0)).toHaveLength(0);
    // They did recover and reload: a fresh press fires each once.
    m = { weapons: hold, alpha: 2 };
    for (let t = 0; t < 10; t++) battle.step();
    const shots = battle.events.filter((e) => e.type === 'shot' && e.mech === 0);
    for (const id of gunIds) expect(shots.filter((e) => e.type === 'shot' && e.instanceId === id)).toHaveLength(1);
  });
});

/**
 * A cap-fed gun is loaded only when its network holds the rest of a shot
 * (MW spec §1: an Alpha dumps within 1 s). Counting it loaded on cooldown alone
 * let Alpha arm a railgun on empty caps, which then fired seconds later while
 * held -- and the Alpha count and the ready bar disagreed about it.
 *
 * railgun-mule banks 3 × 60 = 180 kJ, less than one 220 kJ shot, so the bench
 * swaps one plate for a fourth Jolt: 240 kJ, and 320 kW of discharge against
 * the 220 kW dump limit. validateBuild would refuse the cell; the sim needs only
 * the network.
 */
describe('Alpha and a cap-fed gun', () => {
  const mule = TEMPLATES.find((t) => t.id === 'railgun-mule')!.build;
  const bench = applyAutoWire(getChassis('CH-5'), {
    ...mule,
    routes: [],
    parts: mule.parts.filter((p) => p.instanceId !== 'arm2')
      .concat([{ instanceId: 'cap4', partId: 'P-CAP', origin: { regionId: 'body', x: 4, y: 2 }, rotation: 0, integrity: 1 }]),
  }).build;
  const SHOT_KJ = getPart('W-RG').draw!.capFedEnergyPerShotKj!;
  const held = (s: Simulation, n: number) => {
    const fired: number[] = [];
    for (let i = 0; i < n; i++) {
      if (s.step(0.05, { weaponsEnabled: {}, speedSetting: 'stationary' }).shotsThisTick.some((e) => e.instanceId === 'rg')) fired.push(i + 1);
    }
    return fired;
  };
  const stored = (s: Simulation) => s.capacitorLevels().reduce((a, b) => a + b, 0);

  it('the bench banks a whole shot', () => {
    const s = new Simulation(getChassis(bench.chassisId), bench);
    expect(stored(s)).toBeGreaterThanOrEqual(SHOT_KJ);
  });

  it('with full caps it is loaded, and the Alpha shot lands within 1 s', () => {
    const s = new Simulation(getChassis(bench.chassisId), bench);
    held(s, 1);
    expect(s.instanceRuntime.get('rg')!.loaded).toBe(true);
    expect(s.instanceRuntime.get('rg')!.readyFrac).toBe(1);
    expect(s.armVolley()).toContain('rg');
    const fired = held(s, 20);
    expect(fired).toHaveLength(1);
  });

  it('off cooldown with drained caps it is not loaded, and Alpha does not arm it', () => {
    const s = new Simulation(getChassis(bench.chassisId), bench);
    for (let i = 0; i < 40 && !s.step(0.05, { weaponsEnabled: { rg: true }, speedSetting: 'stationary' }).shotsThisTick.length; i++);
    held(s, 120);                                          // 6 s: past the 5 s cooldown
    expect(s.instanceRuntime.get('rg')!.cooldownRemainingS).toBeLessThanOrEqual(0);
    s.drainCapacitorChargeKj(stored(s) - 40);
    held(s, 1);
    const rt = s.instanceRuntime.get('rg')!;
    expect(stored(s)).toBeLessThan(SHOT_KJ);
    expect(rt.loaded).toBe(false);
    expect(rt.readyFrac).toBeCloseTo(stored(s) / SHOT_KJ, 6);
    expect(s.armVolley()).not.toContain('rg');
    // The caps refill while it waits, but nothing armed it: it stays held.
    expect(held(s, 200)).toEqual([]);
  });

  // railgun-mule banks 180 kJ against a 220 kJ shot, so it can never hold a
  // whole one. Full caps are the best it can reach: there it counts as loaded
  // and fires as soon as it can; short of full it waits to fill.
  it('railgun-mule off cooldown on drained caps is not loaded, arms nothing, and stays held', () => {
    const s = new Simulation(getChassis(mule.chassisId), mule);
    for (let i = 0; i < 60 && !s.step(0.05, { weaponsEnabled: { rg: true }, speedSetting: 'stationary' }).shotsThisTick.length; i++);
    held(s, 120);                                          // past the 5 s cooldown
    expect(s.instanceRuntime.get('rg')!.cooldownRemainingS).toBeLessThanOrEqual(0);
    s.drainCapacitorChargeKj(stored(s) - 40);
    held(s, 1);
    expect(stored(s)).toBeLessThan(180);
    expect(s.instanceRuntime.get('rg')!.loaded).toBe(false);
    expect(s.instanceRuntime.get('rg')!.readyFrac).toBeLessThan(1);
    expect(s.armVolley()).toEqual([]);
    expect(held(s, 200)).toEqual([]);                      // the caps refill, but nothing armed it
  });

  it('railgun-mule on full caps is loaded, and its Alpha shot is no later than auto fire from full caps', () => {
    const s = new Simulation(getChassis(mule.chassisId), mule);
    const twin = new Simulation(getChassis(mule.chassisId), mule);
    held(s, 1);
    held(twin, 1);
    expect(stored(s)).toBeLessThan(SHOT_KJ);               // the bank really is short of a shot
    expect(s.instanceRuntime.get('rg')!.loaded).toBe(true);
    expect(s.instanceRuntime.get('rg')!.readyFrac).toBe(1);
    expect(s.armVolley()).toEqual(['rg']);
    let autoTick = -1;
    for (let i = 1; i <= 100 && autoTick < 0; i++) {
      if (twin.step(0.05, { weaponsEnabled: { rg: true }, speedSetting: 'stationary' }).shotsThisTick.length) autoTick = i;
    }
    expect(autoTick).toBeGreaterThan(0);
    const fired = held(s, autoTick + 1);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toBeLessThanOrEqual(autoTick + 1);
  });
});
