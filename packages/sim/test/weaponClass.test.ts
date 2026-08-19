import { describe, expect, it } from 'vitest';
import { PARTS, type WeaponClass } from '../src/index.js';

/**
 * `weaponClass` is the axis the player reads as "energy gun or ammo gun". No
 * rule branches on it yet -- it exists first so that any rule which later does
 * has one place to ask.
 *
 * It is declared rather than inferred because both plausible inferences are
 * wrong on the shipped catalog: `draw` says the railgun is an energy weapon
 * (it is cap-fed, and it still throws a slug) and says the flamer is the same
 * kind of thing as a machine gun (both continuous draw). Matching part ids is
 * the other way to get this wrong, and `simulation.ts:729` still does it for
 * cook-off.
 */
const EXPECTED: Record<string, WeaponClass> = {
  'W-MG': 'ballistic',
  'W-AC': 'ballistic',
  'W-CB': 'ballistic',
  'W-BR': 'ballistic',
  // Pays an energy cost on top of the projectile it still has to carry.
  'W-RG': 'ballistic',
  'W-LAS': 'energy',
  'W-ION': 'energy',
  'W-RKT': 'missile',
  'W-SC': 'chemical',
};

const weapons = () => Object.values(PARTS).filter((d) => d.weapon);

describe('every weapon declares what it consumes', () => {
  it('covers exactly the shipped weapons, so a new gun cannot slip through', () => {
    // The field is required on WeaponSpec, so a missing one is a compile error
    // rather than a test failure. What this catches is a new weapon added to
    // the catalog without anyone deciding which class it belongs to -- the
    // decision that the four-class split exists to force.
    expect(weapons().map((d) => d.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('is the class each weapon was deliberately assigned', () => {
    for (const def of weapons()) {
      expect(def.weapon!.weaponClass, def.id).toBe(EXPECTED[def.id]);
    }
  });

  it('cannot be derived from `draw`, which is why it is declared', () => {
    // If either of these ever became true, the field would be redundant and
    // worth deleting. Both are false today, and that is the whole argument.
    const byDraw = (id: string) => {
      const d = PARTS[id]!;
      return d.draw?.continuousKw ? 'looks-ballistic' : 'looks-energy';
    };
    // Cap-fed, and ballistic anyway.
    expect(byDraw('W-RG')).toBe('looks-energy');
    expect(PARTS['W-RG']!.weapon!.weaponClass).toBe('ballistic');
    // Continuous draw, exactly like the machine gun, and not ballistic.
    expect(byDraw('W-SC')).toBe(byDraw('W-MG'));
    expect(PARTS['W-SC']!.weapon!.weaponClass).not.toBe(PARTS['W-MG']!.weapon!.weaponClass);
  });

  it('gives every class at least one weapon', () => {
    const seen = new Set(weapons().map((d) => d.weapon!.weaponClass));
    // A class with no members is a class that has not earned its keep; the
    // four-way split is a bet, and this is where it shows if it stops paying.
    expect([...seen].sort()).toEqual(['ballistic', 'chemical', 'energy', 'missile']);
  });
});
