import { describe, expect, it } from 'vitest';
import {
  COLD_BORE_MAX_C, FEVER_CYCLE_MIN_C, HULL_DOWN_MAX_MPS,
  MODIFIERS, PARTS, effectiveMults,
  type ModifierCtx, type PartDef, type PlacedPart,
} from '../src/index.js';

/**
 * A modifier's condition used to be restated in `diversity.ts` so the balance
 * harness could report how often a perk fired. It drifted: hull-down was
 * measured against 0.5 m/s where the perk uses 1.5, which under-reported it
 * sevenfold and printed it as a dead perk. `isActive` now lives beside `apply`
 * sharing one constant; these are what stop the two from parting again.
 */
const TILES = ['open', 'forest', 'hill', 'water'] as const;
const ctxGrid = (): ModifierCtx[] => {
  const out: ModifierCtx[] = [];
  for (const tempC of [0, 25, 39, 40, 41, 55, 80, 120]) {
    for (const speedMps of [0, 0.4, 0.5, 1.0, 1.49, 1.5, 3, 8]) {
      for (const tile of TILES) out.push({ tempC, speedMps, tile });
    }
  }
  return out;
};

const carrierFor = (def: { appliesTo: (d: PartDef) => boolean }): PartDef | undefined =>
  Object.values(PARTS).find((part) => def.appliesTo(part));

const placedWith = (partId: string, modifierId: string): PlacedPart => ({
  instanceId: 'probe', partId,
  origin: { regionId: 'body', x: 0, y: 0 }, rotation: 0, integrity: 1,
  modifiers: [modifierId],
});

describe('every declared activation predicate tracks a real effect', () => {
  const declared = Object.entries(MODIFIERS).filter(([, def]) => def.isActive);

  it('there are some to check', () => {
    expect(declared.length).toBeGreaterThanOrEqual(4);
  });

  for (const [id, def] of declared) {
    it(`${id}: says yes somewhere, no somewhere, and the mults follow`, () => {
      const carrier = carrierFor(def);
      expect(carrier, `${id} applies to no shipped part`).toBeDefined();
      const placed = placedWith(carrier!.id, id);

      const grid = ctxGrid();
      const active = grid.filter((ctx) => def.isActive!(ctx, carrier!));
      const idle = grid.filter((ctx) => !def.isActive!(ctx, carrier!));

      // A predicate that is always true (or always false) over the whole
      // plausible range is not measuring a condition -- it should have been
      // left off, or the perk is unreachable.
      expect(active.length, `${id} never active`).toBeGreaterThan(0);
      expect(idle.length, `${id} never idle`).toBeGreaterThan(0);

      // And saying "active" has to correspond to the mults actually differing,
      // which is the half a retyped threshold gets wrong: 0.5 vs 1.5 both
      // partition the grid, only one of them tracks `apply`.
      const mults = (ctx: ModifierCtx) => JSON.stringify(effectiveMults(placed, ctx));
      const activeShapes = new Set(active.map(mults));
      const idleShapes = new Set(idle.map(mults));
      const overlap = [...activeShapes].filter((shape) => idleShapes.has(shape));
      expect(overlap, `${id}: same mults on both sides of its own predicate`).toEqual([]);
    });
  }
});

/**
 * The boundaries themselves, written out. The generic test above proves the
 * predicate tracks *a* boundary; these pin *which* one, and are what fails if
 * a constant is edited in one of its two homes.
 */
describe('the declared boundaries are the documented ones', () => {
  const at = (id: string, ctx: Partial<ModifierCtx>) =>
    MODIFIERS[id]!.isActive!(
      { tempC: 25, speedMps: 0, tile: 'open', ...ctx },
      carrierFor(MODIFIERS[id]!)!,
    );

  it('hull-down is the 1.5 m/s perk, not the 0.5 m/s one', () => {
    expect(HULL_DOWN_MAX_MPS).toBe(1.5);
    expect(at('hull-down', { speedMps: 0 })).toBe(true);
    // The reading the harness used to take. A mech at 1.0 m/s is hull-down and
    // was counted as moving.
    expect(at('hull-down', { speedMps: 1.0 })).toBe(true);
    expect(at('hull-down', { speedMps: 1.49 })).toBe(true);
    expect(at('hull-down', { speedMps: HULL_DOWN_MAX_MPS })).toBe(false);
    expect(at('hull-down', { speedMps: 4 })).toBe(false);
  });

  it('cold-bore ends at 40 °C and fever-cycle starts at 50 °C', () => {
    expect(at('cold-bore', { tempC: COLD_BORE_MAX_C - 1 })).toBe(true);
    expect(at('cold-bore', { tempC: COLD_BORE_MAX_C })).toBe(false);
    expect(at('fever-cycle', { tempC: FEVER_CYCLE_MIN_C })).toBe(false);
    expect(at('fever-cycle', { tempC: FEVER_CYCLE_MIN_C + 1 })).toBe(true);
    // The band between them is neither, which is what makes them a choice.
    expect(at('cold-bore', { tempC: 45 })).toBe(false);
    expect(at('fever-cycle', { tempC: 45 })).toBe(false);
  });

  it('gyrostabilized declares nothing, because it is unconditional', () => {
    expect(MODIFIERS['gyrostabilized']!.isActive).toBeUndefined();
  });
});
