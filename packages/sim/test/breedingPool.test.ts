/**
 * The breeding lock pool is hand-written, so new content silently falls out of
 * it. `W-SR` did: the sweep after it shipped reported it in zero archive cells,
 * which is indistinguishable from dead gear in the output and meant the
 * opposite — it was never offered. I3 already distinguishes "offered but never
 * wanted" from "never offered by any lock"; this makes the second case a build
 * failure for content that ought to be in the pool at all.
 */
import { describe, expect, it } from 'vitest';
import { MIDGAME_POOL, drawLock } from '../src/breeding.js';
import { PARTS, getPart } from '../src/catalog.js';

const inPool = new Set(MIDGAME_POOL.parts);

describe('the breeding pool keeps up with the catalog', () => {
  it('offers every weapon in the catalog', () => {
    const missing = Object.values(PARTS)
      .filter((def) => def.category === 'weapon' && def.id !== 'U-AMMO')
      .map((def) => def.id)
      .filter((id) => !inPool.has(id));
    expect(missing, 'weapons the breeder can never draw').toEqual([]);
  });

  it('offers every reactor and capacitor', () => {
    const missing = Object.values(PARTS)
      .filter((def) => def.reactor || def.capacitor)
      .map((def) => def.id)
      .filter((id) => !inPool.has(id));
    expect(missing, 'power parts the breeder can never draw').toEqual([]);
  });

  it('names only parts that exist', () => {
    for (const id of MIDGAME_POOL.parts) expect(() => getPart(id), id).not.toThrow();
  });
});

describe('a lock is always buildable', () => {
  it('never offers a capacitor-fed gun without a bank to feed it', () => {
    // Measured before the fix: all three locks that offered W-SR had no
    // capacitor and both that offered W-RG had one, so the sweep's verdict on
    // the two guns was a property of the draw and nothing else.
    const offenders: string[] = [];
    for (let seed = 1; seed <= 400; seed++) {
      const lock = drawLock(seed);
      const capFed = lock.parts.filter((id) => getPart(id).draw?.capFedEnergyPerShotKj);
      const banks = lock.parts.filter((id) => getPart(id).capacitor);
      if (capFed.length > 0 && banks.length === 0) offenders.push(`seed ${seed}: ${capFed.join(',')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('still seeds a reactor and a weapon in every lock', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const lock = drawLock(seed);
      expect(lock.parts.some((id) => getPart(id).reactor), `seed ${seed}`).toBe(true);
      expect(lock.parts.some((id) => getPart(id).category === 'weapon'), `seed ${seed}`).toBe(true);
    }
  });
});
