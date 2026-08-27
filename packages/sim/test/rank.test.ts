import { describe, expect, it } from 'vitest';
import { buildPartTier, computeRank, modDrawWeight, modifierTier } from '../src/rank.js';
import { assembleBuild } from '../src/workbench.js';

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
