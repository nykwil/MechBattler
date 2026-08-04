import { describe, expect, it } from 'vitest';
import {
  ADDITIVE_POOL_FLOOR, ModBuilder, effectiveMults, neutralMults,
} from '../src/modifiers.js';
import { Combatant } from '../src/combat.js';
import { getPart } from '../src/catalog.js';
import type { Build, PlacedPart } from '../src/types.js';

/**
 * How bonuses and penalties combine (docs/04 §4b).
 *
 * Two buckets: sources in the additive pool sum and apply once, sources in the
 * multiplicative pool each compound. This is the contract every future part and
 * mod is written against, so it is pinned rather than left to the one call site
 * that happens to exercise it today.
 */
describe('the two buckets', () => {
  it('sums the additive pool and applies it once', () => {
    const m = new ModBuilder().inc('damage', -0.3).inc('damage', -0.3).resolve();
    // 1 - 0.6, deliberately NOT 0.7 x 0.7 = 0.49.
    expect(m.damage).toBeCloseTo(0.4, 12);
  });

  it('compounds the multiplicative pool', () => {
    const m = new ModBuilder().scale('damage', 0.7).scale('damage', 0.7).resolve();
    expect(m.damage).toBeCloseTo(0.49, 12);
  });

  it('applies the additive pool first, then the multiplicative one', () => {
    const m = new ModBuilder().inc('damage', -0.5).scale('damage', 0.4).resolve();
    expect(m.damage).toBeCloseTo(0.5 * 0.4, 12);
  });

  it('is order-independent in both pools', () => {
    const a = new ModBuilder().inc('cycleS', 0.2).scale('cycleS', 1.5).inc('cycleS', -0.5).resolve();
    const b = new ModBuilder().scale('cycleS', 1.5).inc('cycleS', -0.5).inc('cycleS', 0.2).resolve();
    expect(a.cycleS).toBe(b.cycleS);
  });

  it('leaves untouched fields exactly neutral', () => {
    const m = new ModBuilder().scale('damage', 2).resolve();
    const neutral = neutralMults();
    for (const key of Object.keys(neutral) as (keyof typeof neutral)[]) {
      if (key === 'damage') continue;
      expect(m[key], key).toBe(neutral[key]);
    }
  });

  it('floors a reduction at zero rather than inverting it', () => {
    // A 120% reduction is a content bug; the clamp keeps it from becoming a
    // bonus while `game:audit` is what actually catches the catalog.
    const m = new ModBuilder().inc('damage', -1.2).resolve();
    expect(m.damage).toBe(ADDITIVE_POOL_FLOOR);
  });

  it('sums physical quantities instead of scaling them', () => {
    const m = new ModBuilder().add('extraHeatKw', 1.5).add('extraHeatKw', 2).resolve();
    expect(m.extraHeatKw).toBe(3.5);
  });

  it('takes the worst offender for a latency floor, not their sum', () => {
    const m = new ModBuilder().atLeast('orderLatencyS', 0.8).atLeast('orderLatencyS', 0.4).resolve();
    expect(m.orderLatencyS).toBe(0.8);
  });
});

/**
 * The lateral-target penalty has two scopes that multiply: the mech's fire
 * control, and the individual weapon. Neither existed before -- it was one
 * boolean keyed on a part id -- so these pin the shape the content depends on.
 */
describe('the lateral-target penalty', () => {
  const build = (partIds: string[]): Build => ({
    chassisId: 'CH-5',
    parts: partIds.map((partId, i): PlacedPart => ({
      instanceId: `p${i}`, partId, origin: { regionId: 'body', x: i, y: 0 }, rotation: 0, integrity: 1,
    })),
    powerPriority: [],
  });
  const TC = getPart('U-TC1').fireControlLateralMult!;

  it('is ungated with no fire control fitted', () => {
    const c = new Combatant(build(['W-MG']), { x: 0, y: 0 }, 0);
    expect(c.fireControlLateralMult(null)).toBe(1);
  });

  it('applies the part\'s own declared strength', () => {
    const c = new Combatant(build(['U-TC1']), { x: 0, y: 0 }, 0);
    expect(c.fireControlLateralMult(null)).toBe(TC);
  });

  it('compounds across copies — two computers beat one', () => {
    const c = new Combatant(build(['U-TC1', 'U-TC1']), { x: 0, y: 0 }, 0);
    expect(c.fireControlLateralMult(null)).toBeCloseTo(TC * TC, 12);
    expect(c.fireControlLateralMult(null)).toBeLessThan(TC);
  });

  it('stops counting a computer that has been shed or shut down', () => {
    const c = new Combatant(build(['U-TC1']), { x: 0, y: 0 }, 0);
    for (const key of ['shedInstanceIds', 'shutdownInstanceIds'] as const) {
      const snapshot = {
        shedInstanceIds: [] as string[], shutdownInstanceIds: [] as string[], [key]: ['p0'],
      } as never;
      expect(c.fireControlLateralMult(snapshot), key).toBe(1);
    }
  });

  it('is a per-weapon knob a modifier can bend, independent of the mech-wide one', () => {
    // The case that could not be expressed at all before: this gun leads better
    // than that gun on the same mech.
    const gun: PlacedPart = {
      instanceId: 'g', partId: 'W-MG', origin: { regionId: 'body', x: 0, y: 0 },
      rotation: 0, integrity: 1, variant: {},
    };
    expect(effectiveMults(gun, { tempC: 25, speedMps: 0, tile: 'open' }).lateralPenalty).toBe(1);
    expect(new ModBuilder().scale('lateralPenalty', 0.5).resolve().lateralPenalty).toBe(0.5);
  });
});
