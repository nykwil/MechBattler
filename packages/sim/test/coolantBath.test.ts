import { describe, expect, it } from 'vitest';
import { assembleBuild, runBattle, TEMPLATES, type Build } from '../src/index.js';

/**
 * The pilot's willingness to stand in water must be *derived*, not typed.
 *
 * It used to be `if (t === 'water' && runningHot) u += 2` behind a
 * `hottestC >= 100` gate (docs/17 F31). Both halves were wrong in the same way:
 * the gate was open on 1.155% of mech-ticks and on one of seven canonical
 * templates, and the constant ignored the mech's radiators, `WATER_RADIATOR_MULT`
 * and any mod on either — so `tidecooler`, whose entire effect is to double
 * radiator output in water, could not change how often the pilot went there. A
 * mod that cannot influence the decision it exists to reward is dead by
 * construction.
 *
 * These pin the two properties that fix depends on. If someone puts a constant
 * back, the second one fails.
 */
function hotBuild(chassisId: string, mod?: string): Build {
  // The Kiln dumps 15 kW into the hull and draws nothing, so this is the
  // archetype a coolant bath is for.
  return assembleBuild({
    chassisId,
    parts: [
      { partId: 'W-KL', count: 2 },
      { partId: 'U-RAD', count: 1, ...(mod ? { modifiers: [mod] } : {}) },
    ],
  }).build;
}

/** Mean hottest-cell temperature while actually standing in water. */
function meanTempWhileWading(build: Build, seeds: number[]): { meanC: number; wetTicks: number } {
  let sum = 0;
  let wetTicks = 0;
  for (const opponent of TEMPLATES.slice(0, 3)) {
    for (const seed of seeds) {
      const report = runBattle({ builds: [build, opponent.build], seed, recordFrames: true });
      for (const frame of report.frames) {
        const me = frame.mechs[0];
        if (me.tile !== 'water') continue;
        sum += me.hottestCellC;
        wetTicks += 1;
      }
    }
  }
  return { meanC: wetTicks > 0 ? sum / wetTicks : 0, wetTicks };
}

describe('the coolant bath is derived from the sim, not typed', () => {
  it('sends a genuinely hot mech to water far more than the arena offers it', () => {
    // Water is ~4.4% of the arena. A cold mech ignores it (measured 0.67x its
    // share across the canonical roster); a hot one should seek it.
    const build = hotBuild('CH-5');
    let ticks = 0;
    let wet = 0;
    for (const opponent of TEMPLATES.slice(0, 3)) {
      for (const seed of [1, 2, 3]) {
        const report = runBattle({ builds: [build, opponent.build], seed, recordFrames: true });
        for (const frame of report.frames) {
          ticks += 1;
          if (frame.mechs[0].tile === 'water') wet += 1;
        }
      }
    }
    expect(ticks).toBeGreaterThan(0);
    expect(wet / ticks).toBeGreaterThan(0.1);
  });

  it('cools a wading mech measurably more when its radiator carries a Tidecooler', () => {
    // This is the property a constant cannot have. The mod doubles the radiator
    // channel in a water context; the bath must therefore be worth more with it.
    const seeds = [1, 2, 3, 4];
    const plain = hotBuild('CH-5');
    const modded = hotBuild('CH-5', 'tidecooler');

    // docs/17 F18: assert the attachment actually took, or a declining
    // `appliesTo` measures identically to an effect that does nothing.
    expect(
      modded.parts.some((part) => (part.modifiers ?? []).includes('tidecooler')),
      'tidecooler did not attach to the radiator',
    ).toBe(true);

    const withoutMod = meanTempWhileWading(plain, seeds);
    const withMod = meanTempWhileWading(modded, seeds);
    expect(withoutMod.wetTicks).toBeGreaterThan(0);
    expect(withMod.wetTicks).toBeGreaterThan(0);
    expect(withMod.meanC).toBeLessThan(withoutMod.meanC);
  });
});
