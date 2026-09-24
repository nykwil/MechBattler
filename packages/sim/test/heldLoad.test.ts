import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/simulation.js';
import { getChassis } from '../src/chassis.js';
import type { Build, PlacedPart } from '../src/types.js';

/**
 * MW spec §1: a held gun finishes loading and waits, so guns released together
 * fire together. Before this, holding a gun paused its load and a release fired
 * staggered by up to a whole cycle.
 *
 * Same bench layout as mechanicalFire.test.ts: validateBuild would refuse it
 * (the reactor overhangs the CH-5 mask), but every gun here is wired to the
 * reactor, which is all the sim needs.
 */
const chassis = getChassis('CH-5');
const at = (instanceId: string, partId: string, x: number, y: number): PlacedPart => ({
  instanceId, partId, origin: { regionId: 'body', x, y }, rotation: 0, integrity: 1,
});
const WIRE = [1, 2, 3, 4, 5].map((x) => ({ kind: 'wire' as const, regionId: 'body', x, y: 2 }));
const DT = 1 / 20;

function sim(parts: PlacedPart[], reactor = 'R-C90'): Simulation {
  const build: Build = { chassisId: chassis.id, parts: [at('reactor', reactor, 3, 3), ...parts], routes: WIRE, powerPriority: [] };
  return new Simulation(chassis, build);
}
/** Steps with `enabled`, returning the ids that fired on each tick. */
function stepN(s: Simulation, n: number, enabled: string[]): string[][] {
  const weaponsEnabled = Object.fromEntries(enabled.map((id) => [id, true]));
  const out: string[][] = [];
  for (let i = 0; i < n; i++) out.push(s.step(DT, { weaponsEnabled, speedSetting: 'stationary' }).shotsThisTick.map((e) => e.instanceId));
  return out;
}

describe('a held gun loads and waits', () => {
  it.each([
    ['ballistic', 'W-AC'],
    ['charged', 'W-LAS'],
    ['continuous or salvo', 'W-RKT'],
  ])('%s: held past its cycle, fires on the first released tick', (_label, partId) => {
    const s = sim([at('gun', partId, 1, 1)]);
    // Fire once so the gun starts from an empty load, then hold for 20 s.
    stepN(s, 400, ['gun']);
    stepN(s, 400, []);
    expect(s.instanceRuntime.get('gun')!.loaded).toBe(true);
    const ticks = stepN(s, 1, ['gun']);
    expect(ticks[0]).toContain('gun');
  });

  it('mixed guns released together fire on the same tick', () => {
    const s = sim([at('ac', 'W-AC', 1, 1), at('las', 'W-LAS', 5, 1)]);
    stepN(s, 400, []);
    const [first] = stepN(s, 1, ['ac', 'las']);
    expect(first).toEqual(expect.arrayContaining(['ac', 'las']));
  });

  it('a held gun does not fire', () => {
    const s = sim([at('ac', 'W-AC', 1, 1)]);
    expect(stepN(s, 400, []).flat()).toHaveLength(0);
  });

  it('a full charged gun fires on release even when the bus cannot feed it that tick', () => {
    // Review Focus 5: the shot is paid for; brownout must not swallow it.
    // Not on an R-E25: its 25 kW can never feed the laser's 30 kW charge, so
    // the gun is shed from the first tick and never loads at all. Charge on a
    // reactor that can feed it, then release at flank beside a twin that stays
    // held: equal bus demand proves the shot drew nothing that tick.
    const s = sim([at('las', 'W-LAS', 5, 1)]);
    const twin = sim([at('las', 'W-LAS', 5, 1)]);
    stepN(s, 400, []);
    stepN(twin, 400, []);
    expect(s.instanceRuntime.get('las')!.loaded).toBe(true);
    const snap = s.step(DT, { weaponsEnabled: { las: true }, speedSetting: 'flank' }); // flank competes for the bus
    const held = twin.step(DT, { weaponsEnabled: {}, speedSetting: 'flank' });
    expect(snap.totalDemandKw).toBe(held.totalDemandKw);
    expect(snap.shotsThisTick.map((e) => e.instanceId)).toContain('las');
  });
});
