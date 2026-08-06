import { describe, expect, it } from 'vitest';
import { falloffAt, getPart } from '../src/index.js';

/**
 * Four-band falloff: empty under min, fade min→idealMin, solid idealMin→idealMax,
 * fade idealMax→max to ×0 — the same curve the arena cone draws.
 */
describe('minimum range', () => {
  const rocket = getPart('W-RKT');
  const rail = getPart('W-RG');
  const carbine = getPart('W-CB');

  /**
   * Which weapons own the knife fight is a design statement, so it is asserted
   * rather than left to whoever edits the catalog next. The brawlers keep
   * idealMin at 0; every gun that trades on reach and precision pays for it up
   * close, which is what makes standing at your ideal band a decision.
   */
  it('leaves the true point-blank weapons fully effective at contact', () => {
    for (const id of ['W-BR', 'W-SC']) {
      expect(falloffAt(getPart(id), 0), id).toBe(1);
    }
  });

  it('gives every long-range weapon an empty muzzle under its idealMin', () => {
    for (const id of ['W-MG', 'W-AC', 'W-CB', 'W-LAS', 'W-ION', 'W-RKT', 'W-RG']) {
      const { idealMin, min } = getPart(id).weapon!.falloff;
      expect(idealMin, id).toBeGreaterThan(0);
      expect(falloffAt(getPart(id), 0), id).toBe(0);
      expect(falloffAt(getPart(id), idealMin), id).toBeCloseTo(1, 5);
      if ((min ?? 0) > 0) {
        expect(falloffAt(getPart(id), (min ?? 0) - 0.01), id).toBe(0);
      }
    }
  });

  /** The reach premium is priced up close: the further a gun sees, the worse its brawl. */
  it('makes the longest reach the worst brawler', () => {
    const brawl = (id: string) => falloffAt(getPart(id), 10);
    expect(brawl('W-RG')).toBeLessThan(brawl('W-CB'));
    expect(brawl('W-CB')).toBeLessThan(brawl('W-AC'));
    // Stitcher is full by 10 m (min = idealMin); the autocannon is only halfway there.
    expect(brawl('W-AC')).toBeLessThan(brawl('W-MG'));
  });

  it('Stitcher sweet spot is 10–40 m with a hard floor at 10', () => {
    const mg = getPart('W-MG');
    const { min, idealMin, idealMax, max } = mg.weapon!.falloff;
    expect(min).toBe(10);
    expect(idealMin).toBe(10);
    expect(idealMax).toBe(40);
    expect(max).toBe(90);
    expect(falloffAt(mg, 0)).toBe(0);
    expect(falloffAt(mg, 9.9)).toBe(0);
    expect(falloffAt(mg, 10)).toBeCloseTo(1, 5);
    expect(falloffAt(mg, 40)).toBe(1);
    expect(falloffAt(mg, 90)).toBe(0);
    expect(falloffAt(mg, 65)).toBeCloseTo(0.5, 5);
  });

  it('carbine plateau is solid from idealMin through idealMax (35–60), empty at contact', () => {
    const { idealMin, idealMax } = carbine.weapon!.falloff;
    expect(idealMin).toBe(35);
    expect(idealMax).toBe(60);
    expect(falloffAt(carbine, 0)).toBe(0);
    expect(falloffAt(carbine, idealMin)).toBeCloseTo(1, 5);
    expect(falloffAt(carbine, 50)).toBe(1);
    expect(falloffAt(carbine, idealMax)).toBe(1);
  });

  it('ramps smoothly from empty contact up to idealMin when min is 0', () => {
    const half = falloffAt(rail, rail.weapon!.falloff.idealMin / 2);
    expect(half).toBeGreaterThan(falloffAt(rail, 0));
    expect(half).toBeLessThan(falloffAt(rail, rail.weapon!.falloff.idealMin));
  });

  it('hands back to the far fade above idealMax and hits zero at max', () => {
    expect(falloffAt(rail, 60)).toBe(1);
    expect(falloffAt(rail, 80)).toBe(1);
    expect(falloffAt(rail, 240)).toBe(0);
    expect(falloffAt(rail, 160)).toBeCloseTo(0.5, 5);
  });

  it('rocket pod is empty at contact and full at its 30 m idealMin', () => {
    const { idealMin } = rocket.weapon!.falloff;
    expect(idealMin).toBe(30);
    expect(falloffAt(rocket, 0)).toBe(0);
    expect(falloffAt(rocket, idealMin)).toBeCloseTo(1, 5);
  });
});
