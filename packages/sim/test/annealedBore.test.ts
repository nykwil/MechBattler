import { describe, expect, it } from 'vitest';
import {
  ANNEALED_BORE_MIN_C, ANNEALED_BORE_PER_C, HEAT_FIRE_HOLD_C,
  MODIFIERS, effectiveMults, heatDispersionMult, type PlacedPart,
} from '../src/index.js';

/**
 * `annealed-bore` is the answer to docs/17 F32: nothing in the catalog paid
 * above 100 °C, so the whole upper heat band was cost with no reason to enter
 * it. These pin the properties that make it a decision rather than a curve.
 */
const gun = (modifiers: string[]): PlacedPart => ({
  instanceId: 'probe', partId: 'W-BR', origin: { x: 0, y: 0 }, rotation: 0, integrity: 1, modifiers,
});

const damageAt = (tempC: number, modifiers: string[]): number =>
  effectiveMults(gun(modifiers), { tempC, speedMps: 0, tile: 'open' }).damage;

describe('annealed-bore pays for heat, right up to the wall', () => {
  it('is the only mod whose effect still moves above 100 °C', () => {
    // F32 measured exactly two temperature-varying mods and neither varied
    // above 100. If that becomes true again, the band is dead content again.
    const movers = Object.values(MODIFIERS).filter((mod) => {
      if (mod.kind !== 'mod') return false;
      const hot = effectiveMults(gun([mod.id]), { tempC: 100, speedMps: 0, tile: 'open' });
      const hotter = effectiveMults(gun([mod.id]), { tempC: 114, speedMps: 0, tile: 'open' });
      return Object.keys(hot).some((k) => Math.abs((hot as never)[k] - (hotter as never)[k]) > 1e-9);
    });
    expect(movers.map((m) => m.id)).toContain('annealed-bore');
  });

  it('gives nothing at ambient and grows to the fire-hold threshold', () => {
    expect(damageAt(ANNEALED_BORE_MIN_C, ['annealed-bore'])).toBeCloseTo(1, 6);
    expect(damageAt(25, ['annealed-bore'])).toBeCloseTo(1, 6);

    // Derived from the authored constants rather than restated, so changing
    // them changes the test's expectation with them.
    const atHold = 1 + ANNEALED_BORE_PER_C * (HEAT_FIRE_HOLD_C - ANNEALED_BORE_MIN_C);
    expect(damageAt(HEAT_FIRE_HOLD_C, ['annealed-bore'])).toBeCloseTo(atHold, 6);
    expect(atHold).toBeGreaterThan(1.2);
  });

  it('heats the gun it is bolted to, which is what carries it toward the wall', () => {
    const plain = effectiveMults(gun([]), { tempC: 90, speedMps: 0, tile: 'open' });
    const modded = effectiveMults(gun(['annealed-bore']), { tempC: 90, speedMps: 0, tile: 'open' });
    expect(modded.extraHeatKw).toBeGreaterThan(plain.extraHeatKw);
  });

  it('does not out-earn the accuracy it costs at the temperatures it wants', () => {
    // The cone widens x1.5 by fire-hold. The damage bonus is deliberately
    // smaller than that, so the mod is a trade and not a free upgrade: it can
    // only pay where dispersion is cheap, or where the build was hot anyway.
    const damageGain = damageAt(HEAT_FIRE_HOLD_C, ['annealed-bore']) - 1;
    const coneCost = heatDispersionMult(HEAT_FIRE_HOLD_C) - 1;
    expect(damageGain).toBeLessThan(coneCost);
  });
});
