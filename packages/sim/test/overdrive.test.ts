import { describe, expect, it } from 'vitest';
import { Simulation, HEAT_SHUTDOWN_C, OVERDRIVE_CYCLE_MULT } from '../src/simulation.js';
import { Battle, autopilotController, withManualOrders } from '../src/combat.js';
import { TEMPLATES } from '../src/templates.js';
import { getChassis } from '../src/chassis.js';
import { getPart } from '../src/catalog.js';

/** MW spec §3, amended 24 Sep 2026: OVR is overdrive -- guns cycle faster and every shot runs hotter. */
const template = (id: string) => TEMPLATES.find((t) => t.id === id)!.build;
const gunline = template('mule-gunline');
const allGuns = Object.fromEntries(gunline.parts.filter((p) => getPart(p.partId).category === 'weapon').map((p) => [p.instanceId, true]));

function fire20s(overdrive: boolean) {
  const s = new Simulation(getChassis(gunline.chassisId), gunline);
  let shots = 0;
  let snap = s.step(0.05, { weaponsEnabled: allGuns, speedSetting: 'stationary', overdrive });
  for (let i = 1; i < 400; i++) {
    shots += snap.shotsThisTick.length;
    snap = s.step(0.05, { weaponsEnabled: allGuns, speedSetting: 'stationary', overdrive });
  }
  shots += snap.shotsThisTick.length;
  const gunC = Math.max(...(s.thermal.cellKeysByInstance.get('ac') ?? []).map((k) => s.thermal.cells.get(k)!.tempC));
  return { shots, gunC, reactorCoreC: snap.reactorCoreC };
}

describe('OVR overdrive', () => {
  it('a gun cleared to fire cycles 1/OVERDRIVE_CYCLE_MULT times as often', () => {
    const ratio = fire20s(true).shots / fire20s(false).shots;
    const expected = 1 / OVERDRIVE_CYCLE_MULT;
    expect(ratio).toBeGreaterThan(expected * 0.85);
    expect(ratio).toBeLessThan(expected * 1.15);
  });

  it('runs the gun and the reactor hotter', () => {
    const normal = fire20s(false);
    const od = fire20s(true);
    expect(od.gunC).toBeGreaterThan(normal.gunC);
    expect(od.reactorCoreC).toBeGreaterThan(normal.reactorCoreC);
  });

  it('only OVR asks for it: the autopilot never orders overdrive, and OVR always does', () => {
    const orders = (overrideHeat: boolean) => {
      const battle = new Battle({
        builds: [gunline, template('mule-skirmisher')], seed: 11, timeoutS: 20,
        controllers: [withManualOrders(autopilotController, () => ({ overrideHeat })), autopilotController],
      });
      while (battle.step()) { /* run */ }
      return battle.events.flatMap((e) => (e.type === 'order' && e.order.verb === 'weapons' ? [{ mech: e.mech, od: e.order.overdrive }] : []));
    };
    const auto = orders(false);
    expect(auto.length).toBeGreaterThan(0);
    expect(auto.every((o) => o.od !== true)).toBe(true);
    const ovr = orders(true).filter((o) => o.mech === 0);
    expect(ovr.length).toBeGreaterThan(0);
    expect(ovr.every((o) => o.od === true)).toBe(true);
  });

  it('lets a canonical template cook its own guns to HEAT_SHUTDOWN_C, which OVR alone never could', () => {
    const me = template('mule-skirmisher');
    const guns = me.parts.filter((p) => getPart(p.partId).category === 'weapon').map((p) => p.instanceId);
    let peak = -Infinity;
    for (const foe of ['bastion-tank', 'vulture-sniper']) {
      const battle = new Battle({
        builds: [me, template(foe)], seed: 4000, recordFrames: false,
        controllers: [withManualOrders(autopilotController, () => ({ overrideHeat: true })), autopilotController],
      });
      const sim = battle.combatants[0].sim;
      const keys = guns.flatMap((id) => sim.thermal.cellKeysByInstance.get(id) ?? []);
      while (battle.step()) for (const k of keys) peak = Math.max(peak, sim.thermal.cells.get(k)!.tempC);
    }
    expect(peak).toBeGreaterThanOrEqual(HEAT_SHUTDOWN_C);
  });
});
