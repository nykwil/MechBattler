import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/simulation.js';
import { getChassis } from '../src/chassis.js';
import { firesMechanically, getPart, PARTS } from '../src/catalog.js';
import type { Build, PlacedPart } from '../src/types.js';

/**
 * A ballistic gun does not spend the bus, so a brownout cannot silence it. That
 * is the whole point of the class, and it is invisible in the shipped fixtures:
 * the golden battle never sheds a single instance in 1121 ticks, so `GOLDEN`
 * says nothing about it either way. This builds the shortage on purpose.
 */
const chassis = getChassis('CH-5');
const at = (instanceId: string, partId: string, x: number, y: number, modifiers?: string[]): PlacedPart => ({
  instanceId, partId, origin: { regionId: 'body', x, y }, rotation: 0, integrity: 1, modifiers,
});

/** Shots fired by each instance over `ticks`, under a deliberately starved bus. */
const WIRE = [1, 2, 3, 4, 5].map((x) => ({ kind: 'wire' as const, regionId: 'body', x, y: 2 }));

function shotsUnderLoad(parts: PlacedPart[], enabled: string[], ticks = 200): Map<string, number> {
  const build: Build = { chassisId: chassis.id, parts, routes: WIRE, powerPriority: [] };
  const sim = new Simulation(chassis, build);
  const weaponsEnabled = Object.fromEntries(enabled.map((id) => [id, true]));
  const counts = new Map<string, number>();
  for (let t = 0; t < ticks; t += 1) {
    const snap = sim.step(1 / 20, { weaponsEnabled, speedSetting: 'flank' });
    // `shotsThisTick`, not `shots`. Defaulting a mistyped field to [] would
    // report every gun as silent and read exactly like a passing rule.
    for (const shot of snap.shotsThisTick) {
      counts.set(shot.instanceId, (counts.get(shot.instanceId) ?? 0) + 1);
    }
  }
  return counts;
}

describe('the bus cannot silence a mechanical gun', () => {
  it('is a real split across the catalog, not a rule with one member', () => {
    const mech = Object.values(PARTS).filter((d) => d.weapon && firesMechanically(d)).map((d) => d.id);
    const bus = Object.values(PARTS).filter((d) => d.weapon && !firesMechanically(d)).map((d) => d.id);
    expect(mech.length).toBeGreaterThan(1);
    expect(bus.length).toBeGreaterThan(1);
    // The railgun is ballistic and still on the bus: it bought muzzle velocity
    // with a capacitor feed, and dies with the reactor. Deliberate, so pinned.
    expect(bus).toContain('W-RG');
    expect(getPart('W-RG').weapon!.weaponClass).toBe('ballistic');
  });

  it('keeps firing on a bus too small to feed it, while a laser goes quiet', () => {
    // A 25 kW reactor against a laser (30 kW while charging) plus flank
    // locomotion on a Mule. The laser cannot be sustained; the gun never asked.
    const parts = [
      at('reactor', 'R-E25', 3, 3),
      at('mg', 'W-MG', 1, 1),
      at('las', 'W-LAS', 5, 1),
    ];
    const counts = shotsUnderLoad(parts, ['mg', 'las']);
    expect(counts.get('mg') ?? 0).toBeGreaterThan(0);
    expect(counts.get('mg') ?? 0).toBeGreaterThan(counts.get('las') ?? 0);
  });

  it('fires the same whether the bus is starved or generous', () => {
    // The sharpest statement of the rule: swap the reactor for one nearly four
    // times the size and the ballistic gun's output does not move at all.
    const withParts = (reactor: string) => [
      at('reactor', reactor, 3, 3),
      at('mg', 'W-MG', 1, 1),
      at('las', 'W-LAS', 5, 1),
    ];
    const starved = shotsUnderLoad(withParts('R-E25'), ['mg', 'las']);
    const generous = shotsUnderLoad(withParts('R-C90'), ['mg', 'las']);

    expect(starved.get('mg')).toBe(generous.get('mg'));
    // ...whereas the laser is strictly better off with more supply, which is
    // what makes the ballistic gun's indifference worth something.
    expect(generous.get('las') ?? 0).toBeGreaterThan(starved.get('las') ?? 0);
  });
});
