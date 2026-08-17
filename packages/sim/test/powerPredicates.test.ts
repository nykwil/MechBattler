import { describe, expect, it } from 'vitest';
import { PARTS, participatesInPowerNetwork, requiresPowerConnection } from '../src/catalog.js';

/**
 * `needsPower` was authored three times -- `validation.ts`, `autowire.ts` and
 * the workshop's `Plate.tsx` -- and the workshop's copy tested a different rule
 * (`continuousKw || chargedEnergyPerShotKj || reactor`). Diffed across the
 * catalog it silently excluded `W-RG` and both capacitors, so a disconnected
 * railgun or capacitor rendered as "connectivity does not apply" while
 * `validation.ts` rejected the build for exactly that part.
 *
 * These pin the rule to the catalog rather than to a call site, so a new part
 * that reaches the net by some third route fails here instead of in a player's
 * workshop.
 */
describe('power-connection predicates (one rule, not three)', () => {
  it('every part that declares a draw requires the net', () => {
    for (const def of Object.values(PARTS)) {
      if (def.draw) expect(requiresPowerConnection(def), def.id).toBe(true);
    }
  });

  it('catches the parts that reach the net without a continuous draw', () => {
    // The three the workshop's private copy used to miss. W-RG is cap-fed and
    // the capacitors declare no `draw` at all, so any rule written in terms of
    // `continuousKw`/`chargedEnergyPerShotKj` alone gets all three wrong.
    for (const id of ['W-RG', 'P-CAP', 'P-CAP2']) {
      expect(requiresPowerConnection(PARTS[id]!), id).toBe(true);
    }
    expect(PARTS['W-RG']!.draw?.continuousKw).toBeUndefined();
    expect(PARTS['P-CAP']!.draw).toBeUndefined();
  });

  it('every weapon and capacitor requires the net by category', () => {
    for (const def of Object.values(PARTS)) {
      if (def.category === 'weapon' || def.category === 'capacitor') {
        expect(requiresPowerConnection(def), def.id).toBe(true);
      }
    }
  });

  it('participation is a superset that adds exactly the reactors', () => {
    for (const def of Object.values(PARTS)) {
      if (requiresPowerConnection(def)) {
        expect(participatesInPowerNetwork(def), def.id).toBe(true);
      }
    }
    const extra = Object.values(PARTS).filter(
      (def) => participatesInPowerNetwork(def) && !requiresPowerConnection(def),
    );
    expect(extra.map((def) => def.id).sort()).toEqual(['R-C40', 'R-C90', 'R-E25', 'R-E60']);
  });

  it('inert structure is neither -- it should render dim, not live/dead', () => {
    // Plate armour and the ammo bin have no electrical story at all; colouring
    // them green or red would claim a connection that means nothing.
    for (const id of ['U-ARM', 'U-AMMO']) {
      expect(participatesInPowerNetwork(PARTS[id]!), id).toBe(false);
    }
  });
});
