import { describe, expect, it } from 'vitest';
import { Simulation, HEAT_FIRE_HOLD_C, HEAT_MECH_SHUTDOWN_C, HEAT_RESTART_C } from '../src/simulation.js';
import { Battle, autopilotController, withManualOrders } from '../src/combat.js';
import { CORE_INSTANCE_ID } from '../src/thermal.js';
import { TEMPLATES } from '../src/templates.js';
import { getChassis } from '../src/chassis.js';
import { getPart } from '../src/catalog.js';

/** MW spec §4: an overheated reactor or core shuts the whole mech down until it cools. */
const gunline = TEMPLATES.find((t) => t.id === 'mule-gunline')!.build;
const reactorAndCore = (s: Simulation) => [
  CORE_INSTANCE_ID,
  ...s.parts.filter((p) => getPart(p.partId).category === 'reactor').map((p) => p.instanceId),
].flatMap((id) => s.thermal.cellKeysByInstance.get(id) ?? []);
const setTemp = (s: Simulation, c: number) => { for (const k of reactorAndCore(s)) s.thermal.cells.get(k)!.tempC = c; };
const allGuns = Object.fromEntries(gunline.parts.filter((p) => getPart(p.partId).category === 'weapon').map((p) => [p.instanceId, true]));

describe('mech-wide shutdown', () => {
  it('trips at the threshold: nothing fires, nothing is supplied, and it restarts only below the restart line', () => {
    const s = new Simulation(getChassis(gunline.chassisId), gunline);
    for (let i = 0; i < 100; i++) s.step(0.05, { weaponsEnabled: allGuns, speedSetting: 'cruise' });
    setTemp(s, HEAT_MECH_SHUTDOWN_C + 1);
    let snap = s.step(0.05, { weaponsEnabled: allGuns, speedSetting: 'cruise' });
    expect(snap.mechShutdown).toBe(true);
    for (let i = 0; i < 40; i++) {
      setTemp(s, HEAT_RESTART_C + 5);                     // cooler, but not cool enough
      snap = s.step(0.05, { weaponsEnabled: allGuns, speedSetting: 'cruise' });
      expect(snap.mechShutdown).toBe(true);
      expect(snap.shotsThisTick).toHaveLength(0);
      expect(snap.totalSupplyKw).toBe(0);
    }
    setTemp(s, HEAT_RESTART_C - 5);
    snap = s.step(0.05, { weaponsEnabled: allGuns, speedSetting: 'cruise' });
    expect(snap.mechShutdown).toBe(false);
  });

  it('nothing loads while shut down, so Alpha finds nothing to fire and no volley waits for the restart', () => {
    // Review Focus 4. Fire is held while warming up, so the gun is loaded and
    // waiting when the reactor trips -- warming up with the trigger down left it
    // mid-cycle, and the assertion passed without a shutdown at all.
    const warm = (s: Simulation) => {
      for (let i = 0; i < 100; i++) s.step(0.05, { weaponsEnabled: {}, speedSetting: 'stationary' });
    };
    const control = new Simulation(getChassis(gunline.chassisId), gunline);
    warm(control);
    control.step(0.05, { weaponsEnabled: {}, speedSetting: 'stationary' });
    expect(control.armVolley()).not.toEqual([]);

    const s = new Simulation(getChassis(gunline.chassisId), gunline);
    warm(s);
    setTemp(s, HEAT_MECH_SHUTDOWN_C + 1);
    s.step(0.05, { weaponsEnabled: {}, speedSetting: 'stationary' });
    expect(s.armVolley()).toEqual([]);
  });

  it('in battle: logs both transitions, and the shut-down mech neither turns nor drives', () => {
    const battle = new Battle({ builds: [gunline, gunline], seed: 3, timeoutS: 20 });
    for (let t = 0; t < 40; t++) battle.step();
    const me = battle.combatants[0];
    setTemp(me.sim, HEAT_MECH_SHUTDOWN_C + 1);
    battle.step();
    const facing = me.facingRad;
    // 40 ticks, not 20: the mech coasts down at its normal 3.45 m/s² from about
    // 5.2 m/s, which takes 30 ticks -- it was still at 1.57 m/s after 20.
    for (let t = 0; t < 40; t++) { setTemp(me.sim, HEAT_MECH_SHUTDOWN_C + 1); battle.step(); }
    expect(me.facingRad).toBe(facing);
    expect(Math.hypot(me.vel.x, me.vel.y)).toBeLessThan(0.5);
    setTemp(me.sim, 30);
    battle.step();
    const types = battle.events.filter((e) => e.type === 'mech-shutdown' || e.type === 'mech-restart').map((e) => e.type);
    expect(types).toEqual(['mech-shutdown', 'mech-restart']);
    expect(battle.latestFrame()!.mechs[0].mechShutdown).toBe(false);
  });

  it('the autopilot holds fire on a hot reactor, and OVR fires through it', () => {
    const shots = (overrideHeat: boolean) => {
      const battle = new Battle({
        builds: [gunline, gunline], seed: 5, spawnDistanceM: 40, timeoutS: 6,
        controllers: [withManualOrders(autopilotController, () => ({ overrideHeat })), autopilotController],
      });
      const me = battle.combatants[0];
      const pin = () => setTemp(me.sim, HEAT_FIRE_HOLD_C + 5);   // hot reactor, below mech shutdown
      pin();
      for (let t = 0; t < 10; t++) { battle.step(); pin(); }
      const before = battle.events.filter((e) => e.type === 'shot' && e.mech === 0).length;
      for (let t = 0; t < 80 && battle.step(); t++) pin();
      return battle.events.filter((e) => e.type === 'shot' && e.mech === 0).length - before;
    };
    expect(shots(false)).toBe(0);
    expect(shots(true)).toBeGreaterThan(0);
  });

  it('every shot heats the reactor', () => {
    const cold = new Simulation(getChassis(gunline.chassisId), gunline, { shotHeatToReactorFrac: 0 });
    const hot = new Simulation(getChassis(gunline.chassisId), gunline, { shotHeatToReactorFrac: 1 });
    let a = 0, b = 0;
    for (let i = 0; i < 200; i++) {
      a = cold.step(0.05, { weaponsEnabled: allGuns, speedSetting: 'stationary' }).reactorCoreC;
      b = hot.step(0.05, { weaponsEnabled: allGuns, speedSetting: 'stationary' }).reactorCoreC;
    }
    expect(b).toBeGreaterThan(a + 1);
  });
});
