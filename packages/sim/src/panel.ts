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
import { DEFAULT_TIMEOUT_S, runBattle } from './combat.js';
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

/**
 * How much of the screen score a decisive win is worth. The remaining 0.95 is
 * the win rate, so the largest swing decisiveness can produce (0.05) is far
 * below the smallest gap between two distinct win rates (1/3 across three
 * opponents). It can therefore NEVER reorder builds that differ on wins -- it
 * only separates builds that do not.
 */
const DECISIVENESS_WEIGHT = 0.05;

/**
 * Screen: 3 opponents x 1 seed, about 0.45 s.
 *
 * Win rate alone SATURATES, and that is not a small problem. Measured on a rich
 * lock, a rank-6 build already beat all three panel opponents 3/3, and so did
 * every build from rank 6 to rank 20 -- a flat ceiling of 1.000 across
 * fourteen ranks. A fitness that cannot tell a rank-6 mech from a rank-20 one
 * gives the hill climber nothing to climb, makes "the best build at rank R"
 * an arbitrary pick among ties, and would have made the ceiling curve -- the
 * graph that is supposed to say whether rank means anything -- flat by
 * construction rather than by measurement.
 *
 * So a decisive win counts for slightly more than a narrow one: how much hull
 * the winner had left, and how quickly it finished. Both are read from the
 * battle report the sim already produces, and the weight is capped below the
 * win-rate quantum so the primary ordering is never disturbed.
 */
export function screenFitness(build: Build, seed: number): number {
  const opponents = panelBuilds(SCREEN_PANEL_IDS);
  const baseSeed = baseSeedFor(seed);
  let wins = 0;
  let decisiveness = 0;
  for (const opponent of opponents) {
    const report = runBattle({ builds: [build, opponent.build], seed: baseSeed, recordFrames: false });
    const won = report.winner === 0;
    if (won) wins++;
    // Hull left is the candidate's own, win or lose, so "lost narrowly" still
    // beats "was deleted".
    const hullFrac = report.mechs[0]!.chassisIntegrityFrac;
    // A fight that ended sooner was more one-sided. Normalised against the
    // sim's own timeout rather than a number typed here.
    const speed = won ? 1 - Math.min(1, report.durationS / DEFAULT_TIMEOUT_S) : 0;
    decisiveness += (hullFrac + speed) / 2;
  }
  const winRate = wins / opponents.length;
  const quality = decisiveness / opponents.length;
  // Stays a number in [0, 1]. It is NOT a win rate, and nothing prints it as
  // one: the reported ceiling comes from `confirmFitness`, which is.
  return winRate * (1 - DECISIVENESS_WEIGHT) + DECISIVENESS_WEIGHT * quality;
}

/**
 * Battles per opponent in the confirm pass. Seven opponents at this many seeds
 * is the sample every reported ceiling rests on, and `confirmNoiseBand` says
 * what that sample can and cannot resolve.
 *
 * Calibrated, not guessed. One fixed build, measured at six seeds, at each
 * sample size:
 *
 *   seeds   spread   sd    battles/elite
 *       3   24 pts   9.3             21     <- the value that produced F6
 *       8   20 pts   6.4             56
 *      16   13 pts   4.2            112
 *      24    8 pts   3.0            168
 *      40    6 pts   2.0            280
 *
 * 40 is the default: it is the first size whose band (6 points) is clear of the
 * 8-point spread `I2_MAX_SPREAD` is asked to police, and it costs about a
 * minute per elite. **A definitive I2 verdict wants more still** -- resolving 8
 * points with room to spare needs a band near 4, which is ~90 seeds and ~2
 * minutes an elite. Pass `--confirm-seeds 90` when the answer has to be
 * defensible rather than indicative.
 */
export const CONFIRM_SEEDS = 40;

/**
 * Half-width of the 95% interval on a confirmed win rate, in win-rate units.
 *
 * A win rate is a mean over `opponents x seeds` Bernoulli battles, so its
 * standard error is at most `0.5 / sqrt(n)` -- worst case at p = 0.5, which is
 * the honest one to quote for a report that mostly cares about builds near even.
 * Two standard errors is the band.
 *
 * This exists so the report can print it. A table of percentages with no error
 * term is what let a 5-point difference be written up as a trend.
 *
 * Checked against measurement rather than trusted: predicted 22 / 13 / 9.5 /
 * 7.7 / 6.0 points at 3 / 8 / 16 / 24 / 40 seeds, observed 24 / 20 / 13 / 8 / 6.
 * Conservative at the small end, which is the right direction for a guard.
 */
export function confirmNoiseBand(seeds = CONFIRM_SEEDS): number {
  return 2 * (0.5 / Math.sqrt(FULL_PANEL_IDS.length * Math.max(1, seeds)));
}

/**
 * A build's own identity, as a number. Two identical builds must measure
 * identically wherever they appear, and the ONLY way to guarantee that is to
 * derive their battle seeds from what they are rather than from where they were
 * found. `screenFitness` gets this via the genome key; a confirmed elite has no
 * genome to hand, so it is hashed from the build itself.
 *
 * The first sweep passed the RANK here instead, and it produced a false
 * finding: the same build measured 43% at rank 10 and 66% at rank 18, and that
 * difference was written up as a declining ceiling curve. It was two different
 * seeds.
 */
function buildSeed(build: Build): number {
  const key = build.chassisId + '|' + build.parts
    .map((p) => `${p.partId}:${[...(p.modifiers ?? [])].sort().join('+')}:${JSON.stringify(p.variant ?? null)}`)
    .sort()
    .join(',');
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Confirm: the full panel, for anything that claimed an archive cell.
 *
 * `seeds` is battles per opponent, and it buys precision that the report then
 * has to respect -- see `confirmNoiseBand`. Seven opponents at 3 seeds is 21
 * battles and swings a build's measured win rate by around 20 points, which is
 * more than any difference worth reporting.
 */
export function confirmFitness(
  build: Build, seeds = CONFIRM_SEEDS,
): { overall: number; perOpponent: { id: string; winRate: number }[] } {
  const baseSeed = baseSeedFor(buildSeed(build));
  const perOpponent = panelBuilds(FULL_PANEL_IDS).map((o) => ({
    id: o.id,
    winRate: evaluateMatchup(build, o.build, seeds, baseSeed),
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
