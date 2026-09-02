/**
 * The breeding lock pool is hand-written, so new content silently falls out of
 * it. `W-SR` did: the sweep after it shipped reported it in zero archive cells,
 * which is indistinguishable from dead gear in the output and meant the
 * opposite — it was never offered. I3 already distinguishes "offered but never
 * wanted" from "never offered by any lock"; this makes the second case a build
 * failure for content that ought to be in the pool at all.
 */
import { describe, expect, it } from 'vitest';
import { MIDGAME_POOL } from '../src/breeding.js';
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
