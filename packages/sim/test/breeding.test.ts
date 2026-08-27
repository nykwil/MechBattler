import { describe, expect, it } from 'vitest';
import {
  LOCK_MOD_COUNT, LOCK_PART_COUNT, MIDGAME_POOL,
  crossover, develop, drawLock, genomeKey, mutate, type Genome,
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
