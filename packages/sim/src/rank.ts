/**
 * Rank: one number for how much mech a build is.
 *
 *   rank(build) = Σ tier(part) + Σ tier(modifier)
 *                 excluding conduits and heat pipes, which are free routing
 *
 * Half of this is old. `computeBudget` and `buildTierBudget` both summed part
 * tiers, and the ladder has always generated opponents from that sum. What is
 * new is that **mods count**. Before this, a build carrying Fever cycle, Cold
 * bore and Gyrostabilized had the same budget as the same build with none, and
 * an elite received `eliteBudgetBonus` *plus* a free mod that cost nothing.
 *
 * Rank is a HYPOTHESIS, not a fact. An armour plate is tier 1, the same as a
 * machine gun, so "high rank" can mean "heavily plated and weak" -- a plausible
 * mechanism for docs/17 F2's -0.637 budget-to-win-rate correlation. The
 * breeding sweep reports the ceiling at each rank precisely so that this
 * function can be found wrong. Do not weight it pre-emptively; measure first.
 */
import type { Build } from './types.js';
import { getPart } from './catalog.js';
import { MODIFIERS } from './modifiers.js';

/** Rank a single modifier contributes. Quirks and variants are not acquired: zero. */
export function modifierTier(modifierId: string): number {
  const def = MODIFIERS[modifierId];
  return def?.kind === 'mod' ? def.tier ?? 1 : 0;
}

/**
 * Relative draw weight for a mod or unique of this tier, at every roll site.
 * `2 ^ (1 - tier)` gives 1 / 0.5 / 0.25, roughly the 4:2:1 spread the named
 * rarities had before tier replaced them.
 */
export function modDrawWeight(tier: number | undefined): number {
  return 2 ** (1 - (tier ?? 1));
}

/**
 * Tier of the metal alone, ignoring mods. This is what the WORKSHOP's start
 * budget gate spends (launchGate, placementPermission, RunPanel): fitting a mod
 * must not push a legal build over its placement allowance and start refusing
 * launches. The player's *measured* rank still includes mods -- that is
 * `computeRank` -- but the two are deliberately different questions.
 */
export function buildPartTier(build: Build): number {
  return build.parts.reduce((sum, part) => {
    const def = getPart(part.partId);
    return def.isConduit || def.isHeatPipe ? sum : sum + def.tier;
  }, 0);
}

/** The full rank: metal plus mods. */
export function computeRank(build: Build): number {
  return build.parts.reduce((sum, part) => {
    const def = getPart(part.partId);
    const metal = def.isConduit || def.isHeatPipe ? 0 : def.tier;
    const mods = (part.modifiers ?? []).reduce((acc, id) => acc + modifierTier(id), 0);
    return sum + metal + mods;
  }, 0);
}
