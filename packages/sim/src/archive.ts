/**
 * The archive: what variety a lock actually supports.
 *
 * Not for finding the ceiling -- that is a max, and the search tracks it
 * directly. This is the anti-convergence measurement. A cell filling with one
 * build means the lock supports one mech; six cells at comparable fitness means
 * it supports six. No separate diversity metric is needed.
 *
 * Every descriptor is READ FROM THE SIM. An instrument must not hardcode what
 * the sim computes: the battle diagnostics substituted constants for
 * fire-control lag, weapon modifiers, terrain cover, target profile and target
 * speed in turn, and each was found only while reviewing the fix for the last.
 */
import type { Build } from './types.js';
import type { Genome } from './breeding.js';
import { getChassis } from './chassis.js';
import { getPart } from './catalog.js';
import { computeHeatBalance, computeIdealRangeBand, computeSpeedProfile } from './derivedStats.js';
import { computeRank } from './rank.js';

/**
 * Bucket edges. Range follows the catalog's own bands -- the Maul is full
 * damage to 15 m and dead at 45; the Longshot's sweet spot starts at 50. The
 * weight and heat splits are provisional in the same way the invariant
 * thresholds are, and the first sweep is expected to argue with them.
 */
export const RANGE_CLOSE_M = 45;
export const RANGE_LONG_M = 100;
export const WEIGHT_LIGHT = 0.5;
export const WEIGHT_MEDIUM = 0.8;

export type RangeBucket = 'close' | 'mid' | 'long';
export type WeightBucket = 'light' | 'medium' | 'heavy';
export type HeatBucket = 'cold' | 'redliner';
export type KillMethod = 'heat' | 'power' | 'damage';

export interface BuildDescriptors {
  /** Midpoint of the sim's own ideal band, metres. */
  rangeM: number;
  range: RangeBucket;
  /** massT / chassis.ratedMassT -- how much of the frame's rating is spent. */
  loadFactor: number;
  weight: WeightBucket;
  heatMarginKw: number;
  heat: HeatBucket;
  kill: KillMethod;
  rank: number;
}

export function describeBuild(build: Build): BuildDescriptors {
  const chassis = getChassis(build.chassisId);
  const band = computeIdealRangeBand(build);
  const rangeM = (band.bandStart + band.bandEnd) / 2;
  const speed = computeSpeedProfile(chassis, build);
  const loadFactor = speed.massT / chassis.ratedMassT;
  const heatMarginKw = computeHeatBalance(chassis, build).marginKw;

  // Kill method reads the weapon fields the sim actually consults: a soaker
  // that cooks the enemy (enemyHeatKj), a gun that drains their capacitors
  // (capDrainKj), or plain damage. Whichever the guns mostly do.
  let heatKj = 0;
  let drainKj = 0;
  for (const part of build.parts) {
    const weapon = getPart(part.partId).weapon;
    if (!weapon) continue;
    heatKj += weapon.enemyHeatKj ?? 0;
    drainKj += weapon.capDrainKj ?? 0;
  }

  return {
    rangeM,
    range: rangeM < RANGE_CLOSE_M ? 'close' : rangeM > RANGE_LONG_M ? 'long' : 'mid',
    loadFactor,
    weight: loadFactor <= WEIGHT_LIGHT ? 'light' : loadFactor <= WEIGHT_MEDIUM ? 'medium' : 'heavy',
    heatMarginKw,
    heat: heatMarginKw < 0 ? 'redliner' : 'cold',
    kill: heatKj > drainKj && heatKj > 0 ? 'heat' : drainKj > 0 ? 'power' : 'damage',
    rank: computeRank(build),
  };
}

/**
 * Cell identity: range x weight, each split cold/redliner. Eighteen slots,
 * readable as a 3x3.
 *
 * Kill method and the exact heat number are LABELS, shown on a gallery entry
 * and in the compare view -- the search does not have to fill a cell for each,
 * because "is there an ion build" is a coverage question and coverage is
 * measured separately.
 */
export function cellKey(d: BuildDescriptors): string {
  return `${d.range}/${d.weight}/${d.heat}`;
}

export const ALL_CELL_KEYS: string[] = (['close', 'mid', 'long'] as RangeBucket[]).flatMap((range) =>
  (['light', 'medium', 'heavy'] as WeightBucket[]).flatMap((weight) =>
    (['cold', 'redliner'] as HeatBucket[]).map((heat) => `${range}/${weight}/${heat}`)));

export interface ArchiveEntry {
  build: Build;
  descriptors: BuildDescriptors;
  /** Win rate against the panel it was measured on. */
  fitness: number;
  genome: Genome | null;
}

export class BuildArchive {
  private readonly grid = new Map<string, ArchiveEntry>();

  /** True when the entry claimed or improved a cell. A tie does not displace. */
  insert(entry: ArchiveEntry): boolean {
    const key = cellKey(entry.descriptors);
    const held = this.grid.get(key);
    if (held && held.fitness >= entry.fitness) return false;
    this.grid.set(key, entry);
    return true;
  }

  cells(): Map<string, ArchiveEntry> { return new Map(this.grid); }
  entries(): ArchiveEntry[] { return [...this.grid.values()]; }

  best(): ArchiveEntry | undefined {
    return this.entries().reduce<ArchiveEntry | undefined>(
      (top, e) => (!top || e.fitness > top.fitness ? e : top), undefined);
  }

  /** Cells nobody filled. "No hot heavy brawler exists" is the finding. */
  emptyCells(): string[] { return ALL_CELL_KEYS.filter((key) => !this.grid.has(key)); }
}
