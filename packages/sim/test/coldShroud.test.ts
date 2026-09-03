import { describe, expect, it } from 'vitest';
import {
  COLD_BORE_MAX_C, FEVER_CYCLE_MIN_C, MODIFIERS, effectiveMults,
} from '../src/modifiers.js';
import type { PlacedPart } from '../src/types.js';

/**
 * `cold-shroud` is docs/17 F70 and F71 put together: prevention rather than
 * absorption, on the one gate the player controls. What must hold is that the
 * two thresholds are the *same* ones the temperature mods use, and that the band
 * between them is neutral -- an author who moves `COLD_BORE_MAX_C` must not
 * silently open a gap where the shroud does nothing but weigh.
 */
const carrier = (): PlacedPart => ({
  partId: 'U-RISE2', instanceId: 'i1', cells: [], modifiers: ['cold-shroud'],
} as unknown as PlacedPart);

const profileAt = (tempC: number) =>
  effectiveMults(carrier(), { tempC, speedMps: 0, tile: 'open' }).targetProfile;

describe('cold-shroud masks while cold and betrays while hot', () => {
  it('hides below the cold-bore threshold', () => {
    expect(profileAt(25)).toBeCloseTo(0.75, 6);
    expect(profileAt(COLD_BORE_MAX_C - 0.01)).toBeCloseTo(0.75, 6);
  });

  it('is neutral across the whole band between the two thresholds', () => {
    for (let c = COLD_BORE_MAX_C; c < FEVER_CYCLE_MIN_C; c += 1) {
      expect(profileAt(c)).toBeCloseTo(1, 6);
    }
  });

  it('enlarges the profile at and above the fever threshold', () => {
    expect(profileAt(FEVER_CYCLE_MIN_C)).toBeCloseTo(1.2, 6);
    expect(profileAt(120)).toBeCloseTo(1.2, 6);
  });

  it('costs its mass at every temperature, including the ones that help nothing', () => {
    for (const c of [25, 45, 90]) {
      expect(effectiveMults(carrier(), { tempC: c, speedMps: 0, tile: 'open' }).massKg)
        .toBeCloseTo(1.1, 6);
    }
  });

  it('declares activity beside its own condition, never a retyped threshold', () => {
    const def = MODIFIERS['cold-shroud']!;
    expect(def.isActive!({ tempC: 25, speedMps: 0, tile: 'open' })).toBe(true);
    expect(def.isActive!({ tempC: FEVER_CYCLE_MIN_C, speedMps: 0, tile: 'open' })).toBe(false);
  });
});
