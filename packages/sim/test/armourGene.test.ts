import { describe, expect, it } from 'vitest';
import { mutate, type Genome, type Lock } from '../src/breeding.js';
import { Pcg32 } from '../src/rng.js';

/**
 * docs/17 F24. `mid/heavy/redliner` and `long/heavy/redliner` are reachable with
 * today's catalog -- `CH-2 W-KL:1` with eight plates is rank 13 and lands in the
 * second, well inside the breeder's 8-20 range -- and the breeder never found
 * either. The gene is why: armour mutated by exactly +/-1 with a floor at 0, so
 * it is a reflecting random walk, and a walk of that shape does not travel.
 * Measured before the fix, over 400 walks: 0% reached eight plates in forty
 * mutations, best seen was seven.
 *
 * Selection makes it worse rather than better. Every intermediate plate count is
 * mass with no benefit until the build crosses the 0.8 weight boundary, and
 * crossing it does not itself pay -- so the steps toward a heavy build are all
 * downhill, which is F16's fitness valley in a third coordinate.
 *
 * This asserts travel, not a win rate: the search has to be able to PROPOSE the
 * plate counts the heavy cells need.
 */
const LOCK: Lock = { seed: 1, parts: ['W-KL', 'R-E25', 'U-ARM', 'W-MG'], mods: [] };
const START: Genome = { chassisId: 'CH-2', parts: [{ partId: 'W-KL', count: 1 }], armourPlates: 0 };

function walk(seed: number, steps: number): number {
  const rng = new Pcg32(seed);
  let g = START;
  for (let i = 0; i < steps; i++) g = mutate(g, LOCK, rng);
  return g.armourPlates;
}

describe('the armour gene can reach the plate counts the heavy cells need', () => {
  it('reaches eight plates from zero within forty mutations, often enough to matter', () => {
    const walks = 400;
    let reached = 0;
    for (let t = 1; t <= walks; t++) if (walk(t, 40) >= 8) reached++;
    // Pre-fix this was exactly 0 of 400. A tenth is not a tuned threshold; it is
    // "the search proposes this shape sometimes" rather than "never".
    expect(reached / walks).toBeGreaterThan(0.1);
  });

  it('still spends most steps nearby, so the walk is widened and not replaced', () => {
    // A gene that only ever teleports loses the local search that finds 2 or 3
    // plates, which is where most builds actually sit.
    const deltas: number[] = [];
    const rng = new Pcg32(99);
    let g: Genome = { ...START, armourPlates: 6 };
    for (let i = 0; i < 600; i++) {
      const before = g.armourPlates;
      g = mutate(g, LOCK, rng);
      if (g.armourPlates !== before) deltas.push(Math.abs(g.armourPlates - before));
    }
    expect(deltas.length).toBeGreaterThan(20);
    expect(deltas.filter((d) => d === 1).length / deltas.length).toBeGreaterThan(0.5);
  });

  it('never proposes a negative plate count', () => {
    for (let t = 1; t <= 200; t++) expect(walk(t, 60)).toBeGreaterThanOrEqual(0);
  });
});
