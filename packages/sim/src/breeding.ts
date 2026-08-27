/**
 * Breeding: locks, genomes and the operators that move between them.
 *
 * The genome is a WISH -- the input `assembleBuild` already takes -- and
 * `assembleBuild` is the developmental step: it places parts by the workshop's
 * own rules, wires the build, and reports what would not fit. So an illegal
 * genome cannot exist, and no evaluation is ever spent on something the game
 * would reject.
 */
import type { AssemblyReport } from './workbench.js';
import { assembleBuild } from './workbench.js';
import { MODIFIERS } from './modifiers.js';
import { getPart } from './catalog.js';
import { modDrawWeight } from './rank.js';
import { Pcg32, pickWeighted } from './rng.js';

/**
 * What "midgame" is meant to contain. DECLARED, not harvested: there is no
 * meta-endgame yet, so this is a design statement in the same spirit as
 * `ONE_HOUR_PART_IDS`. It lives here rather than beside that constant because
 * `packages/sim` may not import `packages/game`.
 *
 * Routing (U-CON, U-PIPE) is deliberately absent: auto-wire lays it free, and a
 * lock that happened to omit a conduit would forbid wiring rather than restrict
 * gear. U-AMMO is absent by declaration -- it is a deliberate placeholder.
 */
export const MIDGAME_POOL = {
  parts: [
    'R-C40', 'R-C90', 'R-E25', 'R-E60',
    'W-MG', 'W-AC', 'W-LAS', 'W-RKT', 'W-CB', 'W-BR', 'W-SC', 'W-ION', 'W-RG',
    'U-RAD', 'U-HS', 'U-ARM', 'U-TC1', 'U-ACT', 'U-TUR', 'U-SHELL',
    'U-RISE2', 'U-RISE3', 'U-RISEL',
    'P-CAP', 'P-CAP2',
  ] as readonly string[],
  mods: Object.values(MODIFIERS).filter((m) => m.kind === 'mod').map((m) => m.id) as readonly string[],
};

export const LOCK_PART_COUNT = 8;
export const LOCK_MOD_COUNT = 3;

export interface Lock {
  seed: number;
  parts: readonly string[];
  mods: readonly string[];
}

/** Draw without replacement, consuming one nextFloat per pick. */
function drawSome<T>(pool: readonly T[], count: number, weightOf: (item: T) => number, rng: Pcg32): T[] {
  const remaining = [...pool];
  const taken: T[] = [];
  while (taken.length < count && remaining.length > 0) {
    const pick = pickWeighted(remaining, weightOf, rng)!;
    taken.push(pick);
    remaining.splice(remaining.indexOf(pick), 1);
  }
  return taken;
}

/**
 * A lock stands in for the fact that a run hands you a fraction of the catalog
 * rather than all of it.
 *
 * Parts are drawn UNIFORMLY on purpose: this measures whether any *gear* is
 * bad, not whether the loot tables are bad. Mods are drawn on their tier
 * weight, because tier is what scarcity means now. Three mods because that is
 * what a run actually grants -- one machinist service after each of wins 3, 6
 * and 9 -- so a lock stays inside the envelope a player could reach.
 */
export function drawLock(seed: number, opts: { partCount?: number; modCount?: number } = {}): Lock {
  const rng = new Pcg32(seed);
  const parts = drawSome(MIDGAME_POOL.parts, opts.partCount ?? LOCK_PART_COUNT, () => 1, rng);
  const mods = drawSome(MIDGAME_POOL.mods, opts.modCount ?? LOCK_MOD_COUNT,
    (id) => modDrawWeight(MODIFIERS[id]?.tier), rng);
  return { seed, parts, mods };
}

export interface Genome {
  chassisId: string;
  parts: { partId: string; count: number; modifiers?: string[] }[];
  armourPlates: number;
}

/** Order-independent identity, so the search never re-evaluates the same mech. */
export function genomeKey(genome: Genome): string {
  const parts = genome.parts
    .map((p) => `${p.partId}:${p.count}:${[...(p.modifiers ?? [])].sort().join('+')}`)
    .sort()
    .join(',');
  return `${genome.chassisId}|${parts}|a${genome.armourPlates}`;
}

/**
 * Develop a genome into a mech. The lock restricts both the wish and what
 * completion may reach for, and `rankCap` caps what completion may spend --
 * without it a rank-6 candidate would be quietly completed into a rank-14 one
 * and the ladder would measure nothing.
 */
export function develop(genome: Genome, lock: Lock, rankCap: number): AssemblyReport {
  return assembleBuild({
    chassisId: genome.chassisId,
    parts: genome.parts.map((p) => ({ partId: p.partId, count: p.count, modifiers: p.modifiers })),
    pool: lock.parts,
    armourPlates: genome.armourPlates,
    budget: rankCap,
  });
}

const clone = (g: Genome): Genome => ({
  chassisId: g.chassisId,
  parts: g.parts.map((p) => ({ ...p, modifiers: p.modifiers ? [...p.modifiers] : undefined })),
  armourPlates: g.armourPlates,
});

/** Mods this part can legally carry, out of the lock. One mod per part is the rule. */
function legalModsFor(partId: string, lock: Lock): string[] {
  const def = getPart(partId);
  return lock.mods.filter((id) => MODIFIERS[id]?.appliesTo(def));
}

/**
 * One change: add, drop or swap a part; nudge a count; add, move or remove a
 * mod; or nudge the armour.
 *
 * Legality is left to `develop`. The operators only respect the two rules the
 * substrate will not resolve for them -- one mod per part, and a mod must
 * apply to the part it is on.
 */
export function mutate(genome: Genome, lock: Lock, rng: Pcg32): Genome {
  const next = clone(genome);
  const roll = Math.floor(rng.nextFloat() * 6);
  const pickPart = () => (next.parts.length === 0 ? undefined
    : next.parts[Math.floor(rng.nextFloat() * next.parts.length)]);

  if (roll === 0 || next.parts.length === 0) {
    const partId = lock.parts[Math.floor(rng.nextFloat() * lock.parts.length)]!;
    const existing = next.parts.find((p) => p.partId === partId);
    if (existing) existing.count += 1;
    else next.parts.push({ partId, count: 1 });
  } else if (roll === 1) {
    next.parts.splice(Math.floor(rng.nextFloat() * next.parts.length), 1);
  } else if (roll === 2) {
    const target = pickPart()!;
    target.partId = lock.parts[Math.floor(rng.nextFloat() * lock.parts.length)]!;
    // A swapped part keeps only the mods that still apply to what it now is.
    const legal = new Set(legalModsFor(target.partId, lock));
    target.modifiers = target.modifiers?.filter((id) => legal.has(id));
  } else if (roll === 3) {
    const target = pickPart()!;
    target.count = Math.max(1, target.count + (rng.nextFloat() < 0.5 ? -1 : 1));
  } else if (roll === 4) {
    const target = pickPart()!;
    const legal = legalModsFor(target.partId, lock);
    if (legal.length === 0 || (target.modifiers?.length && rng.nextFloat() < 0.4)) {
      target.modifiers = undefined;
    } else {
      target.modifiers = [legal[Math.floor(rng.nextFloat() * legal.length)]!];
    }
  } else {
    next.armourPlates = Math.max(0, next.armourPlates + (rng.nextFloat() < 0.5 ? -1 : 1));
  }
  return next;
}

/** Splice two part lists. The chassis is `a`'s: a chassis is not a gene here. */
export function crossover(a: Genome, b: Genome, rng: Pcg32): Genome {
  const pool = [...a.parts, ...b.parts];
  const parts: Genome['parts'] = [];
  for (const part of pool) {
    if (rng.nextFloat() < 0.5) continue;
    const existing = parts.find((p) => p.partId === part.partId);
    if (existing) existing.count += part.count;
    else parts.push({ ...part, modifiers: part.modifiers ? [...part.modifiers] : undefined });
  }
  return {
    chassisId: a.chassisId,
    parts,
    armourPlates: rng.nextFloat() < 0.5 ? a.armourPlates : b.armourPlates,
  };
}
