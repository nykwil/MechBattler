import { describe, expect, it } from 'vitest';
import { buildTierBudget, generateOpponent, headlineWeapon } from '../src/ladder.js';
import { getChassis } from '../src/chassis.js';
import { getPart } from '../src/catalog.js';
import { checkPlacement } from '../src/grid.js';
import { validateBuild } from '../src/validation.js';
import { runBattle } from '../src/combat.js';

describe('budget-driven opponent generation (docs/10 M4, docs/04 §5)', () => {
  it('is deterministic per seed and varies across seeds', () => {
    const a = generateOpponent({ budget: 18, seed: 7 });
    const b = generateOpponent({ budget: 18, seed: 7 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const seeds = [1, 2, 3, 4, 5, 6].map((s) => JSON.stringify(generateOpponent({ budget: 14, seed: s }).build));
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it('respects the budget (wiring excluded) and every placement is legal', () => {
    for (const budget of [8, 14, 20, 30]) {
      for (const seed of [1, 42, 99]) {
        const gen = generateOpponent({ budget, seed });
        expect(buildTierBudget(gen.build)).toBeLessThanOrEqual(budget);
        expect(gen.spentTier).toBeLessThanOrEqual(budget);
        // Re-validate every part against the others: no illegal placements.
        const chassis = getChassis(gen.build.chassisId);
        for (const p of gen.build.parts) {
          const others = gen.build.parts.filter((x) => x.instanceId !== p.instanceId);
          expect(checkPlacement(chassis, others, p, getPart(p.partId))).toBeNull();
        }
        // No hard build errors (unpowered weapons, etc.) — warnings are fine.
        const errors = validateBuild(chassis, gen.build).filter((i) => i.severity === 'error');
        expect(errors).toEqual([]);
      }
    }
  });

  it('a bigger budget buys a meatier mech', () => {
    const small = generateOpponent({ budget: 8, seed: 5 });
    const big = generateOpponent({ budget: 30, seed: 5 });
    expect(buildTierBudget(big.build)).toBeGreaterThan(buildTierBudget(small.build));
  });

  it('generated opponents actually fight (battle runs to a decision)', () => {
    const gen = generateOpponent({ budget: 14, seed: 11 });
    const foe = generateOpponent({ budget: 14, seed: 12 });
    const report = runBattle({ builds: [gen.build, foe.build], seed: 3 });
    expect(['chassis-failure', 'mission-kill', 'judges']).toContain(report.reason);
    expect(headlineWeapon(gen.build)).not.toBeNull();
  });
});
