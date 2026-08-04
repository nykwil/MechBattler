import { describe, expect, it } from 'vitest';
import {
  MOVE_JITTER_MRAD_PER_MPS,
  getChassis,
  weaponSigmaMrad,
  weaponSigmaRad,
} from '../src/index.js';

/**
 * The aim-error formula used to be written out in four places: shot resolution,
 * DPS planning, the arena's spread mark and the diagnostics overlay. The two in
 * the UI had already lost the chassis `moveJitterMult` term, so a moving Vulture
 * was drawn with a spread nearly three times wider than the shot it marked.
 *
 * These pin the terms an instrument could drop silently. They are cheap, and the
 * bug they guard against is invisible in a screenshot -- the mark still renders,
 * it is just the wrong size.
 */
describe('weaponSigmaRad (the single aim-error formula)', () => {
  const base = { dispersionMrad: 4, speedMps: 0 };

  it('is the catalog dispersion when standing still with no modifiers', () => {
    expect(weaponSigmaMrad(base)).toBe(4);
    expect(weaponSigmaRad(base)).toBeCloseTo(0.004, 12);
  });

  it('adds motion jitter in proportion to the shooter’s speed', () => {
    expect(weaponSigmaMrad({ ...base, speedMps: 6 }))
      .toBeCloseTo(4 + MOVE_JITTER_MRAD_PER_MPS * 6, 12);
  });

  it('lets a steady frame buy the jitter down, and only the jitter', () => {
    const steady = getChassis('CH-2').moveJitterMult;
    expect(steady, 'the Vulture is the frame this term exists for').toBeLessThan(1);

    const still = weaponSigmaMrad({ ...base, chassisMoveJitterMult: steady });
    expect(still, 'a standstill has no jitter to reduce').toBe(4);

    const moving = weaponSigmaMrad({ ...base, speedMps: 6, chassisMoveJitterMult: steady });
    expect(moving).toBeCloseTo(4 + MOVE_JITTER_MRAD_PER_MPS * 6 * steady!, 12);
    // The whole point: dropping the term overstates a moving scout's spread.
    expect(moving).toBeLessThan(weaponSigmaMrad({ ...base, speedMps: 6 }));
  });

  it('scales each term by the multiplier that owns it', () => {
    const mults = { dispersionMrad: 0.5, moveJitter: 0.5 };
    expect(weaponSigmaMrad({ ...base, speedMps: 6, mults }))
      .toBeCloseTo(4 * 0.5 + MOVE_JITTER_MRAD_PER_MPS * 6 * 0.5, 12);
  });

  it('keeps the radian form exactly one thousandth of the mrad form', () => {
    const inputs = { dispersionMrad: 7, speedMps: 3.5, chassisMoveJitterMult: 0.35 };
    expect(weaponSigmaRad(inputs)).toBe(weaponSigmaMrad(inputs) * 0.001);
  });
});
