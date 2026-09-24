import { describe, expect, it } from 'vitest';
import { Battle, autopilotController, withManualOrders, type ManualOrders } from '../src/combat.js';
import { TEMPLATES } from '../src/templates.js';
import { getPart } from '../src/catalog.js';

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
});
