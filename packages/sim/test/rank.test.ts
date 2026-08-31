import { describe, expect, it } from 'vitest';
import { buildPartTier, computeRank, modDrawWeight, modifierTier } from '../src/rank.js';
import { assembleBuild } from '../src/workbench.js';
import { getChassis } from '../src/chassis.js';

describe('rank is the sum of every tier a mech carries', () => {
  it('counts a mod, where the old budget counted nothing', () => {
    const plain = assembleBuild({ chassisId: 'CH-5', parts: [{ partId: 'W-AC', count: 2 }] });
    const modded = assembleBuild({
      chassisId: 'CH-5',
      parts: [{ partId: 'W-AC', count: 2, modifiers: ['cold-bore'] }],
    });
    // Same metal either way: the difference is exactly the mods' tiers.
    expect(buildPartTier(modded.build)).toBe(buildPartTier(plain.build));
    const modCount = modded.build.parts.filter((p) => p.modifiers?.includes('cold-bore')).length;
    expect(modCount).toBeGreaterThan(0);
    expect(computeRank(modded.build) - computeRank(plain.build)).toBe(modCount * 3);
  });

  it('does not charge rank for routing', () => {
    // Wiring is structure tax, laid free by auto-wire (ladder.ts's rule).
    const report = assembleBuild({ chassisId: 'CH-9', parts: [{ partId: 'W-BR', count: 2 }] });
    const withConduit = {
      ...report.build,
      parts: [...report.build.parts, { ...report.build.parts[0]!, instanceId: 'x', partId: 'U-CON' }],
    };
    expect(computeRank(withConduit)).toBe(computeRank(report.build));
  });

  it('charges nothing for a quirk, which is not acquired', () => {
    expect(modifierTier('lucky')).toBe(0);
    expect(modifierTier('cold-bore')).toBe(3);
    expect(modifierTier('not-a-real-modifier')).toBe(0);
  });

  it('makes a tier-3 mod a quarter as likely as a tier-1', () => {
    expect(modDrawWeight(1)).toBe(1);
    expect(modDrawWeight(2)).toBe(0.5);
    expect(modDrawWeight(3)).toBe(0.25);
    expect(modDrawWeight(undefined)).toBe(1);
  });
});

describe('the frame itself costs rank', () => {
  it('charges more for a bigger hull carrying identical gear', () => {
    // A chassis used to cost nothing, which was the same hole mods had: rank
    // claims to say how much mech a build is, while the largest single thing
    // about it — 16 cells against 56 — was free. At equal rank a Mule simply
    // carried more gun than a Vulture, because the Vulture's smallness bought
    // it nothing.
    const small = assembleBuild({ chassisId: 'CH-2', parts: [{ partId: 'W-MG', count: 1 }], armourPlates: 0 });
    const large = assembleBuild({ chassisId: 'CH-9', parts: [{ partId: 'W-MG', count: 1 }], armourPlates: 0 });
    expect(computeRank(large.build)).toBeGreaterThan(computeRank(small.build));
  });

  it('keeps the frame out of the workshop’s placement allowance', () => {
    // buildPartTier is what launchGate/placementPermission/RunPanel spend.
    // Picking a bigger hull must not eat the budget for what goes IN it.
    const small = assembleBuild({ chassisId: 'CH-2', parts: [{ partId: 'W-MG', count: 1 }], armourPlates: 0 });
    const large = assembleBuild({ chassisId: 'CH-9', parts: [{ partId: 'W-MG', count: 1 }], armourPlates: 0 });
    const metal = (b: typeof small.build) =>
      b.parts.filter((p) => p.partId === 'W-MG').length;
    expect(metal(small.build)).toBe(metal(large.build));
    expect(buildPartTier(small.build) - buildPartTier(large.build))
      .toBe(computeRank(small.build) - computeRank(large.build)
        - (getChassis('CH-2').chassisTier - getChassis('CH-9').chassisTier));
  });

  it('prices every enabled frame', () => {
    for (const id of ['CH-2', 'CH-5', 'CH-9']) {
      expect(getChassis(id).chassisTier, id).toBeGreaterThanOrEqual(1);
    }
    // Bigger frames cost more: 16 / 32 / 56 cells.
    expect(getChassis('CH-2').chassisTier).toBeLessThan(getChassis('CH-5').chassisTier);
    expect(getChassis('CH-5').chassisTier).toBeLessThan(getChassis('CH-9').chassisTier);
  });
});
