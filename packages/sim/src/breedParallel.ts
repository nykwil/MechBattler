/**
 * The breeding search, spread across worker threads.
 *
 * Kept OUT of `src/index.ts` on purpose: it imports `node:worker_threads`,
 * `node:fs` and `node:path`, and the web app bundles the sim. Anything reachable
 * from the index has to survive rollup in a browser. `scripts/breed.ts` imports
 * this module directly.
 */
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BuildArchive, describeBuild } from './archive.js';
import { Pcg32 } from './rng.js';
import {
  DEFAULT_SCREEN_BUDGET, EXHAUSTIVE_RANK, admit, crossover, enumerateGenomes,
  genomeKey, mutate, searchRank, type Genome, type Lock, type RankResult,
} from './breeding.js';

/**
 * Where the worker thread's code comes from.
 *
 * Workers run the COMPILED `dist`, never the TypeScript source. `new Worker`
 * takes a filesystem path rather than a module specifier, so the `.js`
 * extensions this package imports with are never rewritten for it, and tsx's
 * loader does not reach inside a worker under any of `--import tsx`,
 * `--import tsx/esm`, or an inherited NODE_OPTIONS -- every one of them fails
 * on the worker's own `import './breeding.js'`.
 *
 * Running dist means dist can be STALE, which would silently sweep with old
 * code and produce numbers that belong to no version of anything. So it is
 * checked: every source file must be older than the build. The fix is one
 * command and the error says so.
 */
function workerEntry(): string {
  const dist = fileURLToPath(new URL('../dist/breedWorker.js', import.meta.url));
  const srcDir = fileURLToPath(new URL('.', import.meta.url));
  if (!existsSync(dist)) {
    throw new Error('sim/dist is missing — run `npm run sim:build` before a parallel sweep, or pass --workers 1.');
  }
  const builtAt = statSync(dist).mtimeMs;
  const stale = readdirSync(srcDir)
    .filter((name) => name.endsWith('.ts'))
    .filter((name) => statSync(join(srcDir, name)).mtimeMs > builtAt);
  if (stale.length > 0) {
    throw new Error(
      `sim/dist is older than ${stale.join(', ')} — a parallel sweep would run stale code. `
      + 'Run `npm run sim:build`, or pass --workers 1 to run from source.');
  }
  return dist;
}

/**
 * A pool of long-lived worker threads that screen batches.
 *
 * The pool is spawned ONCE per (lock, chassis) ladder and reused for every
 * generation at every rank. Spawning a worker per generation was the first
 * attempt and it was slower than not parallelising at all: under `tsx` a fresh
 * worker recompiles the sim's whole module graph before running a single
 * battle, which costs more than the second or two of battles it was sent.
 */
class ScreenPool {
  private readonly workers: Worker[] = [];
  private nextTaskId = 0;
  private failure: Error | null = null;

  constructor(size: number, lock: Lock) {
    const entry = workerEntry();
    for (let i = 0; i < size; i++) {
      const worker = new Worker(entry, { workerData: { lock } });
      // A spawn failure fires before any task handler is attached. Without
      // this it is swallowed and the first `screen()` waits forever.
      worker.on('error', (error) => { this.failure = error as Error; });
      this.workers.push(worker);
    }
  }

  /**
   * Split a batch across the pool. The result is reassembled in the order it
   * was given, and every score depends only on its own candidate, so what
   * comes back is exactly what `screenBatch` would have returned serially.
   */
  async screen(genomes: Genome[], rank: number): Promise<(number | null)[]> {
    if (this.failure) throw this.failure;
    if (genomes.length === 0) return [];
    const size = Math.ceil(genomes.length / this.workers.length);
    const slices: { worker: Worker; genomes: Genome[] }[] = [];
    for (let i = 0, w = 0; i < genomes.length; i += size, w++) {
      slices.push({ worker: this.workers[w]!, genomes: genomes.slice(i, i + size) });
    }
    const results = await Promise.all(slices.map(({ worker, genomes: slice }) => {
      const id = this.nextTaskId++;
      return new Promise<(number | null)[]>((resolve, reject) => {
        const onMessage = (message: { id: number; scores: (number | null)[] }) => {
          if (message.id !== id) return;
          worker.off('message', onMessage);
          worker.off('error', reject);
          resolve(message.scores);
        };
        worker.on('message', onMessage);
        worker.once('error', reject);
        worker.postMessage({ id, genomes: slice, rank });
      });
    }));
    return results.flat();
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.terminate()));
  }
}

/**
 * `searchRank`, proposing a generation at a time so the battles in it can be
 * spread across threads. Same warm start, same exhaustive floor, same archive
 * rule.
 *
 * **`--workers` changes which builds are found, and this is expected.** Scoring
 * is untouched: a given genome scores identically on any thread count, because
 * every battle seed derives from the candidate itself (see `screenBatch`, which
 * is tested for exactly that). What differs is the SEARCH TRAJECTORY. The
 * serial climber updates its elites after each candidate; this one proposes
 * `workers * 4` before scoring any of them, so it explores wider and stales its
 * elites slightly. Measured on one lock at budget 120, serial reached 0.64 at
 * rank 10 having admitted 51 builds, and six workers reached 0.93 having
 * admitted 94 -- the wider batch was simply better, which is a property of
 * batching rather than of threads.
 *
 * So `workers` is part of an experiment's identity, alongside `seed` and
 * `budget`, and the report records it. Any fixed set of the three reproduces
 * exactly; comparing across different ones is comparing two experiments.
 */
export async function searchRankParallel(opts: {
  lock: Lock;
  chassisId: string;
  rank: number;
  seed: number;
  budget?: number;
  warmStart?: Genome[];
  workers?: number;
  pool?: ScreenPool;
}): Promise<RankResult> {
  const workers = opts.workers ?? 1;
  const pool = opts.pool;
  if (workers <= 1 || !pool) return searchRank(opts);

  const budget = opts.budget ?? DEFAULT_SCREEN_BUDGET;
  const rng = new Pcg32(opts.seed * 1000 + opts.rank);
  const archive = new BuildArchive();
  const seen = new Set<string>();
  const scored: { genome: Genome; fitness: number }[] = [];
  let evaluations = 0;
  let legalFound = 0;

  /**
   * Take the next distinct genomes off a proposal stream, up to what budget
   * allows.
   *
   * The attempt cap is load-bearing, not defensive: a hill climber whose elites
   * have all been explored proposes nothing but duplicates, and without a bound
   * this loop never returns. It hung a whole sweep.
   */
  const takeFresh = (propose: () => Genome | undefined, want: number): Genome[] => {
    const batch: Genome[] = [];
    let attempts = 0;
    const maxAttempts = Math.max(32, want * 8);
    while (batch.length < want && evaluations + batch.length < budget && attempts < maxAttempts) {
      attempts++;
      const genome = propose();
      if (!genome) break;
      const key = genomeKey(genome);
      if (seen.has(key)) continue;
      seen.add(key);
      batch.push(genome);
    }
    return batch;
  };

  const runBatch = async (batch: Genome[]): Promise<void> => {
    if (batch.length === 0) return;
    const scores = await pool.screen(batch, opts.rank);
    evaluations += batch.length;
    batch.forEach((genome, i) => {
      const fitness = scores[i];
      if (fitness === null || fitness === undefined) return;
      legalFound++;
      scored.push({ genome, fitness });
      // The build is re-developed here rather than shipped back from the
      // worker: development is ~22 ms and deterministic, and a Build crossing
      // a thread boundary would be a structured clone of a much larger object.
      const report = admit(genome, opts.lock, opts.rank);
      if (report) archive.insert({ build: report.build, descriptors: describeBuild(report.build), fitness, genome });
    });
  };

  const warm = [...(opts.warmStart ?? [])];
  await runBatch(takeFresh(() => warm.shift(), budget));
  if (opts.rank <= EXHAUSTIVE_RANK) {
    const all = enumerateGenomes(opts.lock, opts.chassisId);
    let cursor = 0;
    while (cursor < all.length && evaluations < budget) {
      await runBatch(takeFresh(() => all[cursor++], workers * 4));
    }
  }
  while (evaluations < budget) {
    const before = evaluations;
    const batch = takeFresh(() => {
      if (scored.length === 0) return mutate({ chassisId: opts.chassisId, parts: [], armourPlates: 0 }, opts.lock, rng);
      const elites = [...scored].sort((a, b) => b.fitness - a.fitness).slice(0, 8);
      const parent = elites[Math.floor(rng.nextFloat() * elites.length)]!.genome;
      if (elites.length > 1 && rng.nextFloat() < 0.3) {
        return crossover(parent, elites[Math.floor(rng.nextFloat() * elites.length)]!.genome, rng);
      }
      return mutate(parent, opts.lock, rng);
    }, workers * 4);
    await runBatch(batch);
    // A generation that proposed nothing new would otherwise spin forever.
    if (evaluations === before) evaluations += workers * 4;
  }

  const best = archive.best() ?? null;
  const ceiling = best?.fitness ?? (scored.length > 0 ? Math.max(...scored.map((s) => s.fitness)) : 0);
  return { rank: opts.rank, chassisId: opts.chassisId, archive, ceiling, best, evaluations, legalFound };
}

/** `searchLadder`, on workers. Same warm start from rank R-1's archive. */
export async function searchLadderParallel(opts: {
  lock: Lock;
  chassisId: string;
  ranks: number[];
  seed: number;
  budget?: number;
  workers?: number;
  onRank?: (result: RankResult) => void;
}): Promise<RankResult[]> {
  const results: RankResult[] = [];
  let warmStart: Genome[] = [];
  const workers = opts.workers ?? 1;
  // One pool for the whole ladder: spawning is the expensive part, and every
  // rank on this chassis screens against the same lock.
  const pool = workers > 1 ? new ScreenPool(workers, opts.lock) : undefined;
  try {
    for (const rank of [...opts.ranks].sort((a, b) => a - b)) {
      const result = await searchRankParallel({
        lock: opts.lock, chassisId: opts.chassisId, rank, seed: opts.seed,
        budget: opts.budget, workers, warmStart, pool,
      });
      results.push(result);
      opts.onRank?.(result);
      warmStart = result.archive.entries()
        .map((entry) => entry.genome)
        .filter((genome): genome is Genome => genome !== null);
    }
  } finally {
    await pool?.close();
  }
  return results;
}
