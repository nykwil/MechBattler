import { buildTierBudget, getPart, type Build } from '@mechbattler/sim';
import { START_BUDGET } from '../state/runState.js';

/**
 * Whether a build is fit to fight.
 *
 * Distinct from `placementPermission`, which answers whether a part may be placed:
 * this answers whether what has been placed is enough to launch. The full gate was
 * written out twice (App's action bar and the run panel's Launch button) and its
 * weapon/reactor half three times more, for free play and for the intel sheet's
 * warning, so five copies had to agree that a mech needs a gun and a reactor.
 *
 * Four of them tested `partId.startsWith('W-')` / `'R-'`; the fifth (the intel
 * sheet) tested a truthy `.weapon` / `.reactor` payload instead. The catalog's real
 * `category` field agrees with both today -- 9 weapons, 4 reactors, no id and no
 * payload disagreeing with its category -- so reading the category is the same
 * answer as either without depending on either convention holding.
 */
export type LaunchBlocker = 'over-tier-budget' | 'no-reactor' | 'no-weapon';

/** A mech with no gun cannot win, in a run or in free play. */
export function hasWeapon(build: Build): boolean {
  return build.parts.some((part) => getPart(part.partId).category === 'weapon');
}

/** No reactor means nothing on the bus comes up. */
export function hasReactor(build: Build): boolean {
  return build.parts.some((part) => getPart(part.partId).category === 'reactor');
}

/**
 * Why this build cannot launch a run, worst first.
 *
 * Ordered so a caller showing one message shows the same one the run panel always
 * has: over budget, then the missing reactor, then the missing weapon.
 */
export function launchBlockers(build: Build): LaunchBlocker[] {
  const blockers: LaunchBlocker[] = [];
  if (buildTierBudget(build) > START_BUDGET) blockers.push('over-tier-budget');
  if (!hasReactor(build)) blockers.push('no-reactor');
  if (!hasWeapon(build)) blockers.push('no-weapon');
  return blockers;
}

/** The prep gate: within the starting tier budget, with a reactor and a gun. */
export function canLaunch(build: Build): boolean {
  return launchBlockers(build).length === 0;
}
