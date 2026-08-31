/**
 * The three invariants, and the one headline number.
 *
 * These read archives. They run no search -- which matters, because it means
 * the thresholds can be re-argued and re-checked without re-breeding anything.
 *
 * EVERY RESULT IS A LOWER BOUND. A search finds *a* ceiling, not *the* ceiling:
 * failing to find a strong rank-3 build is not proof that none exists. So
 * **I1 failing is stronger evidence than I1 passing**, and anything that prints
 * these numbers must say "best found".
 */
import type { Build } from './types.js';
import type { RankResult } from './breeding.js';
import type { BuildArchive } from './archive.js';
import { PARTS } from './catalog.js';
import { MODIFIERS } from './modifiers.js';
import { LADDER_SPAWN_DISTANCES_M } from './ladder.js';
import { buildIdentity } from './panel.js';
import { runBattle } from './combat.js';

/**
 * Provisional. Written down so the first sweep has something to disagree with,
 * and expected to disagree with all four.
 */
export const I1_THRESHOLD_PLUS2 = 0.75;
export const I1_THRESHOLD_PLUS1 = 0.6;
export const I2_MAX_SPREAD = 0.08;
export const K_COIN_FLIP = 0.5;

/** Excluded from the dead-gear check by declaration: a deliberate placeholder. */
export const COVERAGE_EXEMPT_PARTS = new Set(['U-AMMO']);

/**
 * Best-versus-best across every spawn distance in `LADDER_SPAWN_DISTANCES_M`
 * and both spawn sides.
 *
 * Not every pairing: an individual high-rank sniper losing to a low-rank
 * brawler that starts inside its minimum range is the range game working
 * correctly, and monotonicity is not a claim about that.
 */
export function bestVsBest(a: Build, b: Build, seeds = 4): number {
  let wins = 0;
  let fights = 0;
  for (const spawnDistanceM of LADDER_SPAWN_DISTANCES_M) {
    for (let s = 0; s < seeds; s++) {
      for (const flip of [false, true]) {
        const report = runBattle({
          builds: flip ? [b, a] : [a, b],
          seed: 5_000_000 + spawnDistanceM * 1000 + s,
          spawnDistanceM,
          recordFrames: false,
        });
        fights++;
        if (report.winner !== 'draw' && (report.winner === 0) === !flip) wins++;
      }
    }
  }
  return fights === 0 ? 0 : wins / fights;
}

export interface I1Finding {
  chassisId: string;
  lowRank: number;
  highRank: number;
  gap: 1 | 2;
  winRate: number;
  threshold: number;
  pass: boolean;
  /**
   * The two ranks produced the SAME mech, so this was a mirror match and the
   * 50% it returned says nothing about monotonicity. Not a failure -- it means
   * the extra rank bought nothing the search could find, which is a statement
   * about saturation and is reported as one.
   */
  mirror: boolean;
}

/**
 * I1: the best build at rank R+2 should beat the best at rank R at least 75% of
 * the time, and at R+1 at least 60%.
 *
 * A pair whose two elites are the SAME mech is a mirror match: it returns 50%
 * whatever the content does, and it is reported as `mirror` rather than
 * counted as a failure. That case is real information -- the higher rank bought
 * nothing the search could find -- but it belongs to saturation, not to
 * monotonicity.
 *
 * `gap` counts positions in the rank list, not rank points -- a sweep over
 * 6,8,10 has a "+1" of two rank points. The report prints both ranks so the
 * distinction is never lost.
 */
export function checkRankMonotonicity(results: RankResult[], seeds = 4): I1Finding[] {
  const sorted = [...results].sort((x, y) => x.rank - y.rank);
  const findings: I1Finding[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (const gap of [1, 2] as const) {
      const low = sorted[i];
      const high = sorted[i + gap];
      if (!low?.best || !high?.best) continue;
      const threshold = gap === 2 ? I1_THRESHOLD_PLUS2 : I1_THRESHOLD_PLUS1;
      // A mirror match returns exactly 50% by construction, and both thresholds
      // sit above 50%, so without this check every saturated rank pair counted
      // as a monotonicity failure. In the first corrected sweep that was 10 of
      // 30 pairs and 10 of 13 reported failures -- the invariant was mostly
      // measuring its own inability to find a better build.
      const mirror = buildIdentity(high.best.build) === buildIdentity(low.best.build);
      const winRate = mirror ? 0.5 : bestVsBest(high.best.build, low.best.build, seeds);
      findings.push({
        chassisId: high.chassisId, lowRank: low.rank, highRank: high.rank,
        gap, winRate, threshold, mirror, pass: mirror || winRate >= threshold,
      });
    }
  }
  return findings;
}

/**
 * The rank at which a chassis stops being able to spend more: the lowest rank
 * whose ceiling neither of the next two improves on, or where no legal build
 * exists at all. Null means the ceiling was still climbing at the top of the
 * range searched, so saturation lies beyond it.
 *
 * A first-class output in its own right. Asserting parity above saturation
 * would be asserting something impossible -- the Vulture has 16 cells against
 * the Bastion's 56 -- so this is what makes I2 a fair comparison rather than a
 * complaint about geometry.
 */
export function saturationRank(results: RankResult[]): number | null {
  const sorted = [...results].sort((a, b) => a.rank - b.rank);
  // "Could build nothing at all" is checked over the whole range first. The
  // plateau scan below needs two ranks of lookahead and so cannot see the top
  // two, which is exactly where a chassis runs out of cells -- it reported
  // "still climbing" for a chassis that had stopped being able to build.
  const barren = sorted.find((r) => r.legalFound === 0);
  if (barren) return barren.rank;
  for (let i = 0; i < sorted.length; i++) {
    const here = sorted[i]!;
    const next = sorted.slice(i + 1, i + 3);
    if (next.length < 2) break;
    if (next.every((r) => r.ceiling <= here.ceiling)) return here.rank;
  }
  return null;
}

export interface I2Finding {
  rank: number;
  spread: number;
  best: string;
  worst: string;
  pass: boolean;
  /** Chassis left out of this rank's comparison because they had saturated. */
  aboveSaturation: string[];
}

/** I2: at the same rank, no two chassis ceilings differ by more than 8 points. */
export function checkChassisParity(byChassis: Map<string, RankResult[]>): I2Finding[] {
  const saturation = new Map([...byChassis].map(([id, rs]) => [id, saturationRank(rs)]));
  const ranks = [...new Set([...byChassis.values()].flat().map((r) => r.rank))].sort((a, b) => a - b);
  const findings: I2Finding[] = [];
  for (const rank of ranks) {
    const included: { id: string; ceiling: number }[] = [];
    const aboveSaturation: string[] = [];
    for (const [id, results] of byChassis) {
      const at = results.find((r) => r.rank === rank);
      if (!at) continue;
      const sat = saturation.get(id);
      if (sat !== null && sat !== undefined && rank > sat) { aboveSaturation.push(id); continue; }
      included.push({ id, ceiling: at.ceiling });
    }
    if (included.length < 2) continue;
    const best = included.reduce((top, c) => (c.ceiling > top.ceiling ? c : top));
    const worst = included.reduce((low, c) => (c.ceiling < low.ceiling ? c : low));
    const spread = best.ceiling - worst.ceiling;
    findings.push({ rank, spread, best: best.id, worst: worst.id, pass: spread <= I2_MAX_SPREAD, aboveSaturation });
  }
  return findings;
}

/**
 * I3: every part and mod the sweep actually OFFERED should appear in at least
 * one archive elite.
 *
 * `offered` is the union of every lock's pool, and it matters. Measured against
 * the whole catalog instead, a one-lock smoke run reported 23 parts and 13 mods
 * as dead content when the truth was that they had never been available to any
 * build -- an answer that would be alarming, wrong, and identical after every
 * possible content change. Gear that was never offered is reported separately
 * as a gap in the SWEEP, which is a fact about coverage of the experiment
 * rather than about the gear.
 *
 * Omit `offered` to check against the whole catalog, which is only meaningful
 * for a sweep wide enough to have offered all of it.
 */
export function checkCoverage(archives: BuildArchive[], offered?: Iterable<string>): {
  deadParts: string[];
  deadMods: string[];
  neverOffered: string[];
  usage: Map<string, number>;
} {
  const usage = new Map<string, number>();
  for (const archive of archives) {
    for (const entry of archive.entries()) {
      for (const part of entry.build.parts) {
        usage.set(part.partId, (usage.get(part.partId) ?? 0) + 1);
        for (const modId of part.modifiers ?? []) usage.set(modId, (usage.get(modId) ?? 0) + 1);
      }
    }
  }
  const available = offered ? new Set(offered) : undefined;
  const wasOffered = (id: string) => !available || available.has(id);

  const allParts = Object.keys(PARTS).filter((id) => !COVERAGE_EXEMPT_PARTS.has(id));
  const allMods = Object.values(MODIFIERS).filter((def) => def.kind === 'mod').map((def) => def.id);

  const deadParts = allParts.filter((id) => wasOffered(id) && !usage.has(id));
  const deadMods = allMods.filter((id) => wasOffered(id) && !usage.has(id));
  const neverOffered = [...allParts, ...allMods].filter((id) => !wasOffered(id));
  return { deadParts, deadMods, neverOffered, usage };
}

/**
 * The headline: take the best build at `fromRank`, fight it against the best
 * builds above it, and report the smallest k at which its win rate falls to a
 * coin flip or below.
 *
 * That k is how many ranks of enemy a well-built mech is worth, and it is
 * exactly what `ladderBudgetPerNode` should be set from -- a dial that has been
 * argued over four times with no way to settle it.
 *
 * CAVEAT THAT MUST APPEAR IN THE REPORT: both sides are flown by the same
 * autopilot, so this measures correct BUILDING, not correct PILOTING. A human
 * who kites better than the autopilot is worth more than k; one who does not is
 * worth less.
 */
export function ranksOfCorrectBuilding(
  results: RankResult[], fromRank: number, seeds = 4,
): { k: number | null; ladder: { rank: number; winRate: number }[] } {
  const sorted = [...results].sort((a, b) => a.rank - b.rank);
  const base = sorted.find((r) => r.rank === fromRank);
  if (!base?.best) return { k: null, ladder: [] };
  const ladder: { rank: number; winRate: number }[] = [];
  let k: number | null = null;
  for (const above of sorted.filter((r) => r.rank > fromRank)) {
    if (!above.best) continue;
    const winRate = bestVsBest(base.best.build, above.best.build, seeds);
    ladder.push({ rank: above.rank, winRate });
    if (k === null && winRate <= K_COIN_FLIP) k = above.rank - fromRank;
  }
  return { k, ladder };
}
