import { describe, expect, it } from 'vitest';
import { falloffAt, getPart } from '../src/index.js';

/**
 * The near side of the falloff curve. Weapons that need room to work -- rockets
 * still boosting, a railgun's sight picture in a brawl -- lose damage below their
 * minimum rather than being barred from firing: the shot lands, badly.
 */
describe('minimum range', () => {
  const rocket = getPart('W-RKT');
  const rail = getPart('W-RG');

  it('leaves weapons without a minimum fully effective at contact', () => {
    for (const id of ['W-MG', 'W-AC', 'W-CB', 'W-BR', 'W-SC', 'W-LAS', 'W-ION']) {
      expect(falloffAt(getPart(id), 0), id).toBe(1);
    }
  });

  it('penalises the rocket pod inside its minimum, without silencing it', () => {
    const { rangeMin, multAtMin } = rocket.weapon!.falloff;
    expect(rangeMin).toBe(30);
    expect(falloffAt(rocket, 0)).toBeCloseTo(multAtMin!, 5);
    expect(falloffAt(rocket, rangeMin!)).toBeCloseTo(1, 5);
    // Still worth firing: a penalty, not a dead zone.
    expect(falloffAt(rocket, 0)).toBeGreaterThan(0);
  });

  it('ramps smoothly from contact up to the minimum', () => {
    const half = falloffAt(rail, rail.weapon!.falloff.rangeMin! / 2);
    expect(half).toBeGreaterThan(falloffAt(rail, 0));
    expect(half).toBeLessThan(falloffAt(rail, rail.weapon!.falloff.rangeMin!));
  });

  it('hands back to the existing curve above the minimum', () => {
    // Between rangeMin and rangeStart the weapon is at full damage, as before.
    expect(falloffAt(rail, 60)).toBe(1);
    expect(falloffAt(rail, 80)).toBe(1);
    expect(falloffAt(rail, 240)).toBeCloseTo(0.85, 5);
  });
});
