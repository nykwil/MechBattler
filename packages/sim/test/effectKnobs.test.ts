import { describe, expect, it } from 'vitest';
import { EFFECT_KNOBS, ModBuilder, neutralMults } from '../src/modifiers.js';

/**
 * `EFFECT_KNOBS` is checked against `keyof EffectiveMults` at compile time, so
 * a knob added without a declared stacking rule cannot build. What the compiler
 * cannot check is the *values*: `neutralMults()` is kept as an object literal
 * because `new ModBuilder()` calls it per modified part per tick and a
 * 23-key loop is measurably worse than a literal on that path. These pin the
 * literal to the registry so the speed does not cost correctness.
 */
describe('EFFECT_KNOBS is the registry the rest is derived from', () => {
  const neutral = neutralMults();

  it('declares exactly the knobs EffectiveMults has, no more', () => {
    expect(Object.keys(EFFECT_KNOBS).sort()).toEqual(Object.keys(neutral).sort());
  });

  it('every declared neutral matches the hand-written literal', () => {
    for (const [field, spec] of Object.entries(EFFECT_KNOBS)) {
      expect(neutral[field as keyof typeof neutral], field).toBe(spec.neutral);
    }
  });

  it('a resolved builder with nothing set is the neutral', () => {
    expect(new ModBuilder().resolve()).toEqual(neutral);
  });
});

describe('the three buckets', () => {
  it('additive sources sum once rather than compounding', () => {
    // Two -30% sources give 0.4, not 0.7 * 0.7 = 0.49.
    expect(new ModBuilder().inc('damage', -0.3).inc('damage', -0.3).resolve().damage)
      .toBeCloseTo(0.4, 10);
  });

  it('multiplicative sources compound', () => {
    expect(new ModBuilder().scale('damage', 0.7).scale('damage', 0.7).resolve().damage)
      .toBeCloseTo(0.49, 10);
  });

  it('max takes the strongest source, so copies buy nothing', () => {
    const once = new ModBuilder().best('orderLatencyS', 0.8).resolve().orderLatencyS;
    const twice = new ModBuilder()
      .best('orderLatencyS', 0.8).best('orderLatencyS', 0.8).resolve().orderLatencyS;
    expect(twice).toBe(once);
    // Order-independent: the weaker source never wins, whichever ran first.
    expect(new ModBuilder().best('orderLatencyS', 0.4).best('orderLatencyS', 0.8).resolve().orderLatencyS)
      .toBe(0.8);
    expect(new ModBuilder().best('orderLatencyS', 0.8).best('orderLatencyS', 0.4).resolve().orderLatencyS)
      .toBe(0.8);
  });

  it('sum accumulates, because kW of heat is a quantity not a rate', () => {
    expect(new ModBuilder().add('extraHeatKw', 1.5).add('extraHeatKw', 0.5).resolve().extraHeatKw)
      .toBeCloseTo(2, 10);
  });
});
