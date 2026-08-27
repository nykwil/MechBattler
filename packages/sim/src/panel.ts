/**
 * The frozen reference panel.
 *
 * THIS IS THE ONE THING THAT CANNOT BE MADE FULLY HONEST. Fitness is a win rate
 * against opponents built from the catalog being edited, so when a gun changes
 * the yardstick changes with it. The mitigation is not a fix: the panel is a
 * fixed set of template ids, and every report records `simContentHash()`.
 * Results are comparable while the catalog holds still; when it moves, the
 * report says so. Cross-content-version comparisons are indicative, not
 * measurements -- and anything that prints these numbers must say so.
 */
import type { Build } from './types.js';
import { TEMPLATES } from './templates.js';
import { evaluateMatchup } from './adaptation.js';
import { simContentHash } from './version.js';
import { LADDER_SPAWN_DISTANCES_M } from './ladder.js';

/**
 * Three opponents for the screen, chosen to span the range game rather than to
 * be representative: a fast light kiter, a mid-range gunline, and a slow heavy
 * that deletes things up close. A candidate that beats all three is worth the
 * full panel; most candidates never cost more than this.
 */
export const SCREEN_PANEL_IDS = ['vulture-skirmisher', 'mule-gunline', 'bastion-tank'] as const;

/** The confirm panel: the whole canonical roster. */
export const FULL_PANEL_IDS = TEMPLATES.map((t) => t.id);

export function panelBuilds(ids: readonly string[]): { id: string; build: Build }[] {
  return ids.map((id) => {
    const template = TEMPLATES.find((t) => t.id === id);
    if (!template) throw new Error(`Panel names an unknown template: ${id}`);
    return { id, build: template.build };
  });
}

/**
 * Base seed for a candidate's battles. Derived from the caller's seed alone --
 * never from evaluation order -- so a sweep reproduces exactly and parallelises
 * across workers. The sim is pure and holds no global state, which is what
 * makes that true rather than merely intended.
 */
const baseSeedFor = (seed: number): number => 9_000_000 + (seed >>> 0) % 100_000 * 97;

/** Screen: 3 opponents x 1 seed, about 0.45 s. */
export function screenFitness(build: Build, seed: number): number {
  const opponents = panelBuilds(SCREEN_PANEL_IDS);
  const total = opponents.reduce(
    (sum, o) => sum + evaluateMatchup(build, o.build, 1, baseSeedFor(seed)), 0);
  return total / opponents.length;
}

/** Confirm: the full panel at high seeds, for anything that claimed a cell. */
export function confirmFitness(
  build: Build, seed: number, seeds = 6,
): { overall: number; perOpponent: { id: string; winRate: number }[] } {
  const perOpponent = panelBuilds(FULL_PANEL_IDS).map((o) => ({
    id: o.id,
    winRate: evaluateMatchup(build, o.build, seeds, baseSeedFor(seed)),
  }));
  const overall = perOpponent.reduce((sum, o) => sum + o.winRate, 0) / Math.max(1, perOpponent.length);
  return { overall, perOpponent };
}

/** Goes at the top of every report. A report without it cannot be compared. */
export function panelStamp() {
  return {
    contentHash: simContentHash(),
    screenPanel: SCREEN_PANEL_IDS,
    fullPanel: FULL_PANEL_IDS,
    spawnDistancesM: LADDER_SPAWN_DISTANCES_M,
  };
}
