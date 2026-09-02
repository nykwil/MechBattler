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
import { BuildArchive, describeBuild, type ArchiveEntry } from './archive.js';
import { screenFitness } from './panel.js';
import { computeRank } from './rank.js';

/**
 * What "midgame" is meant to contain. DECLARED, not harvested: there is no
 * meta-endgame yet, so this is a design statement in the same spirit as
 * `ONE_HOUR_PART_IDS`. It lives here rather than beside that constant because
 * `packages/sim` may not import `packages/game`.
 *
 * Routing (U-CON, U-PIPE) is deliberately absent: auto-wire lays it free, and a
 * lock that happened to omit a conduit would forbid wiring rather than restrict
 * gear. U-AMMO is absent by declaration -- it is a deliberate placeholder.
 *
 * Hand-written, and therefore a registry new content has to be added to: `W-SR`
 * shipped without it, so no lock could draw it and the next sweep reported the
 * gun in zero archive cells -- which reads exactly like dead gear and means the
 * opposite. `breedingPool.test.ts` now fails if an enabled weapon, reactor or
 * capacitor is missing from this list, because "never offered" and "never
 * wanted" are opposite findings that the report cannot tell apart on its own.
 */
export const MIDGAME_POOL = {
  parts: [
    'R-C40', 'R-C90', 'R-E25', 'R-E60',
    'W-MG', 'W-AC', 'W-LAS', 'W-RKT', 'W-CB', 'W-BR', 'W-AV', 'W-SC', 'W-ION', 'W-RG', 'W-SR',
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
 *
 * One departure from pure uniformity: a lock is guaranteed one reactor and one
 * weapon. Measured over 2000 uniform draws, 21% of 8-part locks could not build
 * a mech at all -- 19.8% had no reactor among the pool's four, 1.3% no weapon
 * among its nine -- and a dead lock still costs a full budget on every chassis
 * at every rank while producing nothing. A run always starts you with a reactor
 * and a gun, so a lock without them was never a realistic slice; it was a
 * drawing artefact. Which reactor and which weapon stay uniform, so the
 * question "is any gear bad" is untouched.
 */
export function drawLock(seed: number, opts: { partCount?: number; modCount?: number } = {}): Lock {
  const rng = new Pcg32(seed);
  const count = opts.partCount ?? LOCK_PART_COUNT;
  const reactors = MIDGAME_POOL.parts.filter((id) => getPart(id).reactor);
  const weapons = MIDGAME_POOL.parts.filter((id) => getPart(id).category === 'weapon');
  const seeded = [
    ...drawSome(reactors, Math.min(1, count), () => 1, rng),
    ...drawSome(weapons, Math.min(1, Math.max(0, count - 1)), () => 1, rng),
  ];
  const rest = MIDGAME_POOL.parts.filter((id) => !seeded.includes(id));
  const parts = [...seeded, ...drawSome(rest, Math.max(0, count - seeded.length), () => 1, rng)];

  // A capacitor-fed gun cannot fire without a bank, and `assembleBuild` will not
  // reach past the lock to find one -- correctly, on the same principle that
  // makes "the lock has no reactor in it" a finding about the lock rather than
  // an excuse. But that quietly turns a legal weapon into an unbuildable one
  // whenever the draw misses the bank, and the draw missed every single time:
  // all three locks offering `W-SR` had no capacitor while both offering `W-RG`
  // had one, which is the whole reason one read as live gear and the other as
  // dead (docs/17 F16). The lock already seeds a reactor and a weapon so that
  // it is buildable at all; this is the same guarantee for the same reason.
  if (parts.length > seeded.length
    && parts.some((id) => getPart(id).draw?.capFedEnergyPerShotKj)
    && !parts.some((id) => getPart(id).capacitor)) {
    const banks = MIDGAME_POOL.parts.filter((id) => getPart(id).capacitor);
    const bank = drawSome(banks, 1, () => 1, rng)[0];
    // Never the seeded reactor or weapon, which occupy the first slots.
    if (bank) parts[parts.length - 1] = bank;
  }
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

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

/**
 * Screens per (chassis, rank). One screen is ~0.45 s -- 3 opponents at one seed
 * -- so 600 is roughly four and a half minutes single-threaded. The script
 * exposes `--budget` so a smoke run costs seconds.
 */
export const DEFAULT_SCREEN_BUDGET = 600;

/**
 * Below this rank the space is small enough to walk completely, which yields a
 * *guaranteed* ceiling rather than a lucky one -- and that is precisely where
 * the rank-monotonicity invariant is anchored.
 */
export const EXHAUSTIVE_RANK = 8;

export interface RankResult {
  rank: number;
  chassisId: string;
  archive: BuildArchive;
  /** Best win rate FOUND. Not the best that exists -- a search finds a ceiling, not the ceiling. */
  ceiling: number;
  best: ArchiveEntry | null;
  evaluations: number;
  legalFound: number;
}

/** Every one- and two-part wish the lock allows, at a couple of armour weights. */
export function enumerateGenomes(lock: Lock, chassisId: string): Genome[] {
  const out: Genome[] = [];
  for (const a of lock.parts) {
    for (const count of [1, 2]) {
      for (const modifiers of [undefined, ...legalModsFor(a, lock).map((id) => [id])]) {
        for (const armourPlates of [0, 2]) {
          out.push({ chassisId, parts: [{ partId: a, count, modifiers }], armourPlates });
        }
      }
    }
  }
  for (const a of lock.parts) {
    for (const b of lock.parts) {
      if (a >= b) continue;
      // The bare pair, then the same pair carrying one mod on one side.
      //
      // docs/17 F19: mods used to be enumerated on one-part genomes only, and a
      // one-part genome scores above zero only when that part is a gun -- the
      // completer adds reactors, radiators, banks and armour, but never a
      // weapon, and a weaponless build surrenders by mission-kill about three
      // seconds in. So the only viable modded shape the seed population could
      // contain was one weapon plus one mod, every mod that cannot ride a
      // weapon was absent from all 189 archive builds, and two of six locks in
      // the last sweep drew three support-only mods and could not use one.
      //
      // One mod at a time rather than the cross product: this is a seed
      // population, and combining them is what `mutate` and `crossover` are
      // for. That holds the pair enumeration at 1 + |mods(a)| + |mods(b)|
      // variants -- at most 7 with LOCK_MOD_COUNT 3 -- so the whole
      // enumeration stays inside DEFAULT_SCREEN_BUDGET.
      const placements: { modA?: string[]; modB?: string[] }[] = [
        {},
        ...legalModsFor(a, lock).map((id) => ({ modA: [id] })),
        ...legalModsFor(b, lock).map((id) => ({ modB: [id] })),
      ];
      for (const { modA, modB } of placements) {
        for (const armourPlates of [0, 2]) {
          out.push({
            chassisId,
            parts: [
              { partId: a, count: 1, modifiers: modA },
              { partId: b, count: 1, modifiers: modB },
            ],
            armourPlates,
          });
        }
      }
    }
  }
  return out;
}

/** FNV-1a over the genome key: a stable, order-independent battle seed. */
function hashKey(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Develop a candidate and decide whether it is admissible, without scoring it.
 * The one place that decision lives, so the serial and parallel paths cannot
 * drift apart.
 */
export function admit(genome: Genome, lock: Lock, rank: number): AssemblyReport | null {
  const report = develop(genome, lock, rank);
  if (!report.legal) return null;
  if (computeRank(report.build) > rank) return null;
  // `no-weapons` is only a *warning* to the workshop -- a player may park a
  // half-built mech in the bay. It is disqualifying here. Without it the search
  // fills its archive with things like a single heat sink: legal, scores
  // nothing, and holding a cell a real build then cannot have.
  if (report.issues.some((issue) => issue.code === 'no-weapons')) return null;
  return report;
}

/**
 * Screen a batch of genomes.
 *
 * Pure: no shared state, and no dependence on the order of the batch -- which
 * is exactly what makes it safe to hand a slice of the work to a worker thread.
 * Returns null for a genome that did not develop into an admissible mech.
 */
export function screenBatch(genomes: Genome[], lock: Lock, rank: number): (number | null)[] {
  return genomes.map((genome) => {
    const report = admit(genome, lock, rank);
    return report === null ? null : screenFitness(report.build, hashKey(genomeKey(genome)));
  });
}

/**
 * Find the best build at one rank on one chassis.
 *
 * `score` exists so tests can drive the search without battles; production
 * leaves it out and pays for `screenFitness`. It returns null for a genome that
 * did not develop into a legal mech.
 */
export function searchRank(opts: {
  lock: Lock;
  chassisId: string;
  rank: number;
  seed: number;
  budget?: number;
  warmStart?: Genome[];
  score?: (genome: Genome, rank: number) => number | null;
}): RankResult {
  const budget = opts.budget ?? DEFAULT_SCREEN_BUDGET;
  const rng = new Pcg32(opts.seed * 1000 + opts.rank);
  const archive = new BuildArchive();
  const seen = new Set<string>();
  const scored: { genome: Genome; fitness: number }[] = [];
  let evaluations = 0;
  let legalFound = 0;

  const evaluate = (genome: Genome): void => {
    const key = genomeKey(genome);
    if (seen.has(key) || evaluations >= budget) return;
    seen.add(key);
    evaluations++;
    if (opts.score) {
      const fitness = opts.score(genome, opts.rank);
      if (fitness === null) return;
      legalFound++;
      scored.push({ genome, fitness });
      return;
    }
    const report = admit(genome, opts.lock, opts.rank);
    if (report === null) return;
    legalFound++;
    // The battle seed derives from the candidate, never from the order it was
    // evaluated: a parallel sweep has to reproduce a serial one exactly.
    const fitness = screenFitness(report.build, hashKey(key));
    scored.push({ genome, fitness });
    archive.insert({ build: report.build, descriptors: describeBuild(report.build), fitness, genome });
  };

  // Warm start first: rank R-1's elites are the best guesses rank R has.
  for (const genome of opts.warmStart ?? []) evaluate(genome);
  if (opts.rank <= EXHAUSTIVE_RANK) {
    for (const genome of enumerateGenomes(opts.lock, opts.chassisId)) evaluate(genome);
  }
  // Then hill-climb from whatever is best so far.
  while (evaluations < budget) {
    const before = evaluations;
    if (scored.length === 0) {
      evaluate(mutate({ chassisId: opts.chassisId, parts: [], armourPlates: 0 }, opts.lock, rng));
    } else {
      const elites = [...scored].sort((a, b) => b.fitness - a.fitness).slice(0, 8);
      const parent = elites[Math.floor(rng.nextFloat() * elites.length)]!.genome;
      if (elites.length > 1 && rng.nextFloat() < 0.3) {
        const other = elites[Math.floor(rng.nextFloat() * elites.length)]!.genome;
        evaluate(crossover(parent, other, rng));
      } else {
        evaluate(mutate(parent, opts.lock, rng));
      }
    }
    // A run of duplicate genomes would otherwise spin here forever.
    if (evaluations === before) evaluations++;
  }

  const best = archive.best() ?? null;
  const ceiling = best?.fitness ?? (scored.length > 0 ? Math.max(...scored.map((s) => s.fitness)) : 0);
  return { rank: opts.rank, chassisId: opts.chassisId, archive, ceiling, best, evaluations, legalFound };
}

/**
 * Walk the ladder. Rank R seeds from rank R-1's archive, which is both the
 * cheapest warm start available -- a rank-6 build is usually a rank-5 build plus
 * a part -- and a mirror of the invariant being tested: the ladder is
 * constructed, then checked.
 */
export function searchLadder(opts: {
  lock: Lock;
  chassisId: string;
  ranks: number[];
  seed: number;
  budget?: number;
  onRank?: (result: RankResult) => void;
}): RankResult[] {
  const results: RankResult[] = [];
  let warmStart: Genome[] = [];
  for (const rank of [...opts.ranks].sort((a, b) => a - b)) {
    const result = searchRank({
      lock: opts.lock, chassisId: opts.chassisId, rank, seed: opts.seed,
      budget: opts.budget, warmStart,
    });
    results.push(result);
    opts.onRank?.(result);
    warmStart = result.archive.entries()
      .map((entry) => entry.genome)
      .filter((genome): genome is Genome => genome !== null);
  }
  return results;
}
