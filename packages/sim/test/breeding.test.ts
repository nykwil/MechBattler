import { describe, expect, it } from 'vitest';
import {
  LOCK_MOD_COUNT, LOCK_PART_COUNT, MIDGAME_POOL,
  crossover, develop, drawLock, genomeKey, mutate, type Genome,
  DEFAULT_SCREEN_BUDGET, screenBatch, searchLadder, searchRank,
} from '../src/breeding.js';
import { computeRank } from '../src/rank.js';
import { getPart } from '../src/catalog.js';
import { Pcg32 } from '../src/rng.js';

describe('a lock is a seeded slice of the midgame pool', () => {
  it('draws the declared size, without duplicates, from the pool', () => {
    const lock = drawLock(42);
    expect(lock.parts).toHaveLength(LOCK_PART_COUNT);
    expect(lock.mods).toHaveLength(LOCK_MOD_COUNT);
    expect(new Set(lock.parts).size).toBe(LOCK_PART_COUNT);
    expect(new Set(lock.mods).size).toBe(LOCK_MOD_COUNT);
    for (const id of lock.parts) expect(MIDGAME_POOL.parts).toContain(id);
    for (const id of lock.mods) expect(MIDGAME_POOL.mods).toContain(id);
  });

  it('draws the same lock from the same seed, and a different one otherwise', () => {
    expect(drawLock(42)).toEqual(drawLock(42));
    expect(drawLock(42)).not.toEqual(drawLock(43));
  });
});

describe('development cannot produce an illegal mech', () => {
  it('keeps every genome inside its lock and its rank cap', () => {
    const lock = drawLock(7);
    const rng = new Pcg32(7);
    let genome: Genome = { chassisId: 'CH-5', parts: [], armourPlates: 0 };
    for (let i = 0; i < 40; i++) {
      genome = mutate(genome, lock, rng);
      const report = develop(genome, lock, 20);
      expect(computeRank(report.build)).toBeLessThanOrEqual(20);
      for (const part of report.build.parts) {
        const def = getPart(part.partId);
        if (def.isConduit || def.isHeatPipe) continue;
        expect(lock.parts, `${part.partId} escaped the lock`).toContain(part.partId);
        for (const modId of part.modifiers ?? []) expect(lock.mods).toContain(modId);
      }
    }
  });

  it('develops the same genome into the same build twice', () => {
    const lock = drawLock(7);
    const genome: Genome = { chassisId: 'CH-9', parts: [{ partId: lock.parts[0]!, count: 1 }], armourPlates: 2 };
    expect(JSON.stringify(develop(genome, lock, 30).build))
      .toBe(JSON.stringify(develop(genome, lock, 30).build));
  });
});

describe('operators', () => {
  it('mutation changes something', () => {
    const lock = drawLock(11);
    const rng = new Pcg32(11);
    const genome: Genome = { chassisId: 'CH-5', parts: [{ partId: lock.parts[0]!, count: 1 }], armourPlates: 1 };
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) seen.add(genomeKey(mutate(genome, lock, rng)));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('crossover keeps the chassis of the first parent and draws parts from both', () => {
    const lock = drawLock(11);
    const rng = new Pcg32(3);
    const a: Genome = { chassisId: 'CH-5', parts: [{ partId: lock.parts[0]!, count: 2 }], armourPlates: 0 };
    const b: Genome = { chassisId: 'CH-9', parts: [{ partId: lock.parts[1]!, count: 1 }], armourPlates: 4 };
    const child = crossover(a, b, rng);
    expect(child.chassisId).toBe('CH-5');
    for (const part of child.parts) expect([lock.parts[0], lock.parts[1]]).toContain(part.partId);
  });

  it('gives two identical genomes the same key regardless of part order', () => {
    const one: Genome = { chassisId: 'CH-5', parts: [{ partId: 'W-AC', count: 1 }, { partId: 'W-MG', count: 2 }], armourPlates: 1 };
    const two: Genome = { chassisId: 'CH-5', parts: [{ partId: 'W-MG', count: 2 }, { partId: 'W-AC', count: 1 }], armourPlates: 1 };
    expect(genomeKey(one)).toBe(genomeKey(two));
  });
});

describe('the search climbs a tier ladder', () => {
  // A stub scorer: no battles, so these run in milliseconds and test the
  // SEARCH rather than the sim. It rewards rank, which makes the ceiling
  // predictable without asserting anything about combat.
  const scorerFor = (lock: ReturnType<typeof drawLock>) =>
    (genome: Genome, rank: number): number | null => {
      const report = develop(genome, lock, rank);
      return report.legal ? Math.min(1, computeRank(report.build) / 40) : null;
    };

  it('never returns a build over its rank cap', () => {
    const lock = drawLock(5);
    const result = searchRank({ lock, chassisId: 'CH-5', rank: 12, seed: 1, budget: 60 });
    for (const entry of result.archive.entries()) {
      expect(computeRank(entry.build)).toBeLessThanOrEqual(12);
    }
    expect(result.ceiling).toBeGreaterThanOrEqual(0);
  }, 300_000);

  it('spends no more than its budget', () => {
    const lock = drawLock(5);
    const result = searchRank({ lock, chassisId: 'CH-5', rank: 12, seed: 1, budget: 40, score: scorerFor(lock) });
    expect(result.evaluations).toBeLessThanOrEqual(40);
  });

  it('reproduces exactly from the same seed', () => {
    const lock = drawLock(5);
    const opts = { lock, chassisId: 'CH-9', rank: 14, seed: 3, budget: 50, score: scorerFor(lock) };
    const a = searchRank({ ...opts });
    const b = searchRank({ ...opts });
    expect(a.ceiling).toBe(b.ceiling);
    expect(a.evaluations).toBe(b.evaluations);
    expect(a.legalFound).toBe(b.legalFound);
  });

  // The ONLY test here that runs real battles. searchLadder has no `score`
  // injection point, because the warm start is the thing being tested and the
  // archive it hands forward only exists on the production path. Budget 12 x 3
  // ranks is ~35 screens. Keep it small; do not raise it to feel more sure.
  it('warm-starts each rank from the one below it', () => {
    const lock = drawLock(5);
    const seen: number[] = [];
    const results = searchLadder({
      lock, chassisId: 'CH-5', ranks: [8, 10, 12], seed: 2, budget: 12,
      onRank: (r) => seen.push(r.rank),
    });
    expect(seen).toEqual([8, 10, 12]);
    expect(results).toHaveLength(3);
    // Rank 10 was seeded from rank 8's archive, so it cannot do worse than the
    // rank-8 ceiling: a rank-8 build is a legal rank-10 build.
    expect(results[1]!.ceiling).toBeGreaterThanOrEqual(results[0]!.ceiling);
  }, 300_000);

  it('records that a lock produced nothing legal, rather than throwing', () => {
    // A lock of pure armour: no weapon, no reactor, no mech.
    const barren = { seed: 0, parts: ['U-ARM'], mods: [] };
    const result = searchRank({ lock: barren, chassisId: 'CH-2', rank: 3, seed: 1, budget: 20 });
    expect(result.legalFound).toBe(0);
    expect(result.best).toBeNull();
    expect(result.ceiling).toBe(0);
  }, 120_000);

  it('has a default budget worth stating', () => {
    expect(DEFAULT_SCREEN_BUDGET).toBe(600);
  });
});

describe('a batch of candidates can be screened off the main thread', () => {
  // The property that has to hold for threading to be sound is NOT that a
  // parallel sweep finds the same builds as a serial one -- it does not, and
  // is not meant to: proposing a generation before scoring it explores wider
  // than updating elites after every candidate. What has to hold is that a
  // given genome scores the same no matter where or when it is scored.
  it('scores a batch identically to scoring it in any other order', () => {
    const lock = drawLock(5);
    const genomes: Genome[] = lock.parts.slice(0, 3).map((partId) => ({
      chassisId: 'CH-5', parts: [{ partId, count: 1 }], armourPlates: 0,
    }));
    const batched = screenBatch(genomes, lock, 14);
    expect(screenBatch(genomes, lock, 14)).toEqual(batched);
    // Order within the batch must not change any score — that is exactly what
    // makes the work distributable, and it holds only because every battle
    // seed derives from the candidate rather than from when it was evaluated.
    expect(screenBatch([...genomes].reverse(), lock, 14)).toEqual([...batched].reverse());
  }, 300_000);
});

describe('the sim index stays safe to bundle for a browser', () => {
  it('reaches nothing that imports a node builtin', async () => {
    // The web app bundles @mechbattler/sim, so anything reachable from the
    // index has to survive rollup in a browser. Putting the worker pool in
    // breeding.ts broke `web:build` with "node:worker_threads" unresolved;
    // it lives in breedParallel.ts now, which the index deliberately omits.
    const { readFileSync, readdirSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
    const index = readFileSync(`${srcDir}index.ts`, 'utf8');
    const exported = [...index.matchAll(/from '\.\/([\w.]+)\.js'/g)].map((m) => m[1]!);

    const seen = new Set<string>();
    const walk = (name: string) => {
      if (seen.has(name)) return;
      seen.add(name);
      let source: string;
      try { source = readFileSync(`${srcDir}${name}.ts`, 'utf8'); } catch { return; }
      expect(source, `${name}.ts is reachable from index.ts and imports a node builtin`)
        .not.toMatch(/from 'node:/);
      for (const m of source.matchAll(/from '\.\/([\w.]+)\.js'/g)) walk(m[1]!);
    };
    for (const name of exported) walk(name);

    expect(seen.has('breeding')).toBe(true);
    expect(seen.has('breedParallel')).toBe(false);
    // And the thing being guarded against really does use node builtins.
    expect(readdirSync(srcDir)).toContain('breedParallel.ts');
    expect(readFileSync(`${srcDir}breedParallel.ts`, 'utf8')).toMatch(/from 'node:worker_threads'/);
  });
});
