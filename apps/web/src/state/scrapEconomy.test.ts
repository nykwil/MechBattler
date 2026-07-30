import { describe, expect, it } from 'vitest';
import { getPart } from '@mechbattler/sim';
import { generateRunNodes } from '@mechbattler/game';
import { benchSellValue } from './runState.js';

/**
 * The scrapyard must not be a scrap printer. Buying a part and selling it back has
 * to cost the player something, or a run can farm an unlimited purse from a node
 * that is supposed to be a spending decision.
 *
 * Checked against the real generator rather than a restatement of the formula: the
 * invariant does not live in either half, it lives in the relationship between the
 * yard's buy multiplier and the bench's sell multiplier, and either can be changed
 * without the other noticing.
 */
describe('the scrapyard cannot mint scrap', () => {
  const offers = Array.from({ length: 40 }, (_, seed) =>
    generateRunNodes(seed + 1)
      .filter((node) => node.kind === 'scrapyard')
      // Both stock lists: a reroll is still a purchase, so it must not mint either.
      .flatMap((node) => [
        ...(node.scrapyardOffers?.initial ?? []),
        ...(node.scrapyardOffers?.reroll ?? []),
      ]))
    .flat();

  it('generates offers to check', () => {
    expect(offers.length).toBeGreaterThan(20);
  });

  it('never sells back for more than it cost', () => {
    for (const offer of offers) {
      const value = benchSellValue(getPart(offer.partId).tier, offer.integrity);
      expect(
        value,
        `${offer.partId} at ${Math.round(offer.integrity * 100)}% cost ${offer.price}, sells for ${value}`,
      ).toBeLessThan(offer.price);
    }
  });

  it('holds at the worst integrity the yard can roll, for every tier', () => {
    // The generator's floor today is 0.55. The margin is what makes the invariant
    // safe, so assert it well below that rather than only where offers happen to
    // land -- a lowered floor should fail here, not in a player's run.
    for (const tier of [1, 2, 3]) {
      for (const integrity of [0.55, 0.4, 0.25, 0.15]) {
        const price = Math.max(1, Math.ceil(tier * 12 * integrity));
        expect(
          benchSellValue(tier, integrity),
          `tier ${tier} at ${integrity}`,
        ).toBeLessThanOrEqual(price);
      }
    }
  });
});
