import { describe, expect, it } from 'vitest';
import { MIDGAME_POOL, enumerateGenomes, type Lock } from '../src/breeding.js';
import { MODIFIERS } from '../src/modifiers.js';
import { getPart } from '../src/catalog.js';

/**
 * docs/17 F19. Eleven of fourteen mods had never appeared on a single build in
 * any sweep, and the split was exact: every mod whose `appliesTo` refuses every
 * weapon was absent, with no exceptions.
 *
 * The cause was here rather than in the mods. `enumerateGenomes` seeded mods
 * onto one-part genomes only, and a one-part genome scores above zero only when
 * that part is a gun -- the completer adds reactors, radiators, banks and
 * armour, but never a weapon, and a weaponless build surrenders by mission-kill
 * about three seconds in. So the only viable modded shape the seed population
 * could contain was one weapon plus one mod, and a mod that rides a radiator, a
 * riser, a plate, a bank or a servo could only reach a scoring build by
 * mutating out of a population it never appeared in.
 *
 * These assert the shape, not a win rate: a mod on a support part, on a genome
 * that also carries a gun, has to be something the enumeration can propose.
 */
const isWeapon = (id: string) => getPart(id).category === 'weapon';

/** A lock holding one gun, one plate, and a mod that cannot ride a gun. */
function supportModLock(): Lock {
  const frameOnlyMod = Object.values(MODIFIERS).find(
    (m) => m.kind === 'mod'
      && m.appliesTo(getPart('U-ARM'))
      && !MIDGAME_POOL.parts.filter(isWeapon).some((id) => m.appliesTo(getPart(id))),
  );
  // If this ever fails, the catalog has no support-only mod left and F19's
  // whole class is gone -- which is a finding, not a broken fixture.
  expect(frameOnlyMod, 'catalog has no support-only mod to test with').toBeDefined();
  return { seed: 1, parts: ['W-AC', 'U-ARM'], mods: [frameOnlyMod!.id] };
}

describe('the seed population can propose a mod on a support part (docs/17 F19)', () => {
  it('offers a support-part mod on a genome that also carries a weapon', () => {
    const lock = supportModLock();
    const modId = lock.mods[0]!;
    const genomes = enumerateGenomes(lock, 'CH-5');

    const armed = genomes.filter((g) => g.parts.some((p) => isWeapon(p.partId)));
    const armedAndModded = armed.filter((g) =>
      g.parts.some((p) => !isWeapon(p.partId) && (p.modifiers ?? []).includes(modId)));

    expect(armed.length).toBeGreaterThan(0);
    expect(armedAndModded.length).toBeGreaterThan(0);
  });

  it('still enumerates the unmodded pair, so the fix only adds shapes', () => {
    const lock = supportModLock();
    const genomes = enumerateGenomes(lock, 'CH-5');
    const barePair = genomes.filter((g) =>
      g.parts.length === 2 && g.parts.every((p) => (p.modifiers ?? []).length === 0));
    expect(barePair.length).toBeGreaterThan(0);
  });

  it('never proposes a mod on a part that mod cannot legally ride', () => {
    const lock = supportModLock();
    for (const genome of enumerateGenomes(lock, 'CH-5')) {
      for (const part of genome.parts) {
        for (const modId of part.modifiers ?? []) {
          expect(MODIFIERS[modId]!.appliesTo(getPart(part.partId))).toBe(true);
        }
      }
    }
  });
});
