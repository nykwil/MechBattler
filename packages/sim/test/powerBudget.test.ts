import { describe, expect, it } from 'vitest';
import { PARTS, competesForPowerBudget, requiresPowerConnection } from '../src/index.js';

/**
 * `powerPriority` is the list the player drags to choose what browns out
 * first. Four places built that list and one disagreed, so the rule now lives
 * in the catalog -- but the rule that matters is the *simulation's*, and it is
 * narrower than "needs a wire".
 *
 * `Simulation` only ranks instances that requested a positive draw this tick,
 * and it derives that draw from `continuousKw` or a weapon's
 * `chargedEnergyPerShotKj`. Anything else is unrankable, so putting it on the
 * list gives the player a row that does nothing wherever they drag it.
 */
describe('what belongs on the power priority list', () => {
  it('is narrower than needing a power connection, and these are the parts that differ', () => {
    const differ = Object.values(PARTS)
      .filter((d) => competesForPowerBudget(d) !== requiresPowerConnection(d))
      .map((d) => d.id).sort();
    // Both capacitors, the cap-fed railgun, and every mechanically-fired gun:
    // each must reach the net to work at all -- fire control and the feed motor
    // earn the wire -- and none of them can ever be shed, because none of them
    // requests kilowatts the bus could refuse.
    expect(differ).toEqual(['P-CAP', 'P-CAP2', 'W-AC', 'W-BR', 'W-CB', 'W-MG', 'W-RG', 'W-RKT', 'W-SC']);
    for (const id of differ) expect(requiresPowerConnection(PARTS[id]!), id).toBe(true);
  });

  it('never claims a part the sim cannot compute a draw for', () => {
    for (const def of Object.values(PARTS)) {
      if (!competesForPowerBudget(def)) continue;
      // Mirrors simulation.ts's requestedKw branch exactly.
      const drawable = def.category === 'weapon'
        ? Boolean(def.draw?.continuousKw || def.draw?.chargedEnergyPerShotKj)
        : Boolean(def.draw?.continuousKw);
      expect(drawable, def.id).toBe(true);
    }
  });

  it('claims every part the sim can compute a draw for', () => {
    for (const def of Object.values(PARTS)) {
      const drawable = def.category === 'weapon'
        ? Boolean(def.draw?.continuousKw || def.draw?.chargedEnergyPerShotKj)
        : Boolean(def.draw?.continuousKw);
      expect(competesForPowerBudget(def), def.id).toBe(drawable);
    }
  });
});
