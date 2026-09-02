import { describe, expect, it } from 'vitest';
import { checkCoverage } from '../src/invariants.js';
import { BuildArchive } from '../src/archive.js';

/**
 * docs/17 F27. A mod that no offered part can carry is not a mod nobody wanted;
 * it is a mod nobody could take, and `checkCoverage` reported the two
 * identically. `sacrificial-casing` rides only `U-AMMO`, which the game excludes
 * while ammo is deferred, so it appeared in `deadMods` in every sweep of the
 * content pass while being unattachable by construction.
 *
 * This is exactly the distinction the function's own header says it exists to
 * make -- "gear that was never offered is reported separately as a gap in the
 * SWEEP" -- applied to the carrier as well as to the mod itself. A lock that
 * offers a mod but nothing it can ride has not offered it in any useful sense,
 * the same way a lock with a capacitor-fed gun and no bank has not offered a
 * weapon (F16).
 */
describe('a mod with no offered carrier is a gap in the sweep, not dead gear', () => {
  it('reports an unattachable mod as never offered rather than dead', () => {
    // A lock offering the mod, and a gun -- but not `U-AMMO`, its only carrier.
    const offered = ['W-AC', 'R-E25', 'sacrificial-casing'];
    const { deadMods, neverOffered } = checkCoverage([new BuildArchive()], offered);
    expect(deadMods).not.toContain('sacrificial-casing');
    expect(neverOffered).toContain('sacrificial-casing');
  });

  it('still calls a mod dead when its carrier was offered and it went unused', () => {
    // `insulated-mount` rides weapons, and `W-AC` is a weapon in the lock.
    const offered = ['W-AC', 'R-E25', 'insulated-mount'];
    const { deadMods, neverOffered } = checkCoverage([new BuildArchive()], offered);
    expect(deadMods).toContain('insulated-mount');
    expect(neverOffered).not.toContain('insulated-mount');
  });

  it('treats it as unattachable against the whole catalog too', () => {
    const { deadMods, neverOffered } = checkCoverage([new BuildArchive()]);
    // This assertion originally expected `sacrificial-casing` to be dead here,
    // on the assumption that the whole-catalog case contains `U-AMMO`. It does
    // not: `U-AMMO` is in `COVERAGE_EXEMPT_PARTS` precisely because it is a
    // deliberate placeholder, so the mod has no carrier in any sweep, and
    // "never offered" is the honest answer in both cases rather than only the
    // narrow one.
    expect(deadMods).not.toContain('sacrificial-casing');
    expect(neverOffered).toContain('sacrificial-casing');
  });

  it('does not quietly empty the dead list', () => {
    // The fence must not become a way of reporting nothing. Every other mod
    // still has a carrier in the catalog and still reports normally.
    const { deadMods } = checkCoverage([new BuildArchive()]);
    expect(deadMods.length).toBeGreaterThan(10);
    expect(deadMods).toContain('insulated-mount');
  });
});
