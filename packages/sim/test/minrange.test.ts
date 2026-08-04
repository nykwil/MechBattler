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

  /**
   * Which weapons own the knife fight is a design statement, so it is asserted
   * rather than left to whoever edits the catalog next. The brawlers keep no
   * minimum; every gun that trades on reach and precision pays for it up close,
   * which is what makes standing at your ideal band a decision.
   */
  it('leaves the brawling weapons fully effective at contact', () => {
    for (const id of ['W-MG', 'W-BR', 'W-SC']) {
      expect(falloffAt(getPart(id), 0), id).toBe(1);
    }
  });

  it('gives every long-range weapon a real dead zone', () => {
    for (const id of ['W-AC', 'W-CB', 'W-LAS', 'W-ION', 'W-RKT', 'W-RG']) {
      const { rangeMin, multAtMin } = getPart(id).weapon!.falloff;
      expect(rangeMin, id).toBeGreaterThan(0);
      // A penalty, never a silence: the shot lands, badly.
      expect(falloffAt(getPart(id), 0), id).toBeCloseTo(multAtMin!, 5);
      expect(falloffAt(getPart(id), 0), id).toBeGreaterThan(0);
      expect(falloffAt(getPart(id), rangeMin!), id).toBeCloseTo(1, 5);
    }
  });

  /** The reach premium is priced up close: the further a gun sees, the worse its brawl. */
  it('makes the longest reach the worst brawler', () => {
    const brawl = (id: string) => falloffAt(getPart(id), 10);
    expect(brawl('W-RG')).toBeLessThan(brawl('W-CB'));
    expect(brawl('W-CB')).toBeLessThan(brawl('W-AC'));
    expect(brawl('W-AC')).toBeLessThan(brawl('W-MG'));
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
