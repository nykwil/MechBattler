/**
 * Web compatibility facade for the headless, seeded run-content generator.
 * The authoritative algorithms and dials live in @mechbattler/game so saves,
 * automation, tests, and React all inspect the same generated choices.
 */
export {
  ELITE_PURSE_MULT,
  ladderOpponents,
  nodeBudget,
  nodeKind,
  scrapyardOffers,
} from '@mechbattler/game';

export type {
  GeneratedRunNode,
  RunOpponentChoice,
  ScrapyardOffer as YardOffer,
} from '@mechbattler/game';
