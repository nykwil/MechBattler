import {
  MODIFIERS,
  Pcg32,
  generateOpponent,
  getChassis,
  getPart,
  headlineWeapon,
  modifierIdsFor,
} from '@mechbattler/sim';
import { GAME_CONTENT } from './content.js';
import type {
  GeneratedRunNode,
  RunOpponentChoice,
  ScrapyardOffer,
} from './types.js';

export const ELITE_PURSE_MULT = GAME_CONTENT.economy.elitePurseMultiplier;

const EPITHETS = ['Rusty', 'Feral', 'Grim', 'Vagrant', 'Ashen', 'Copper', 'Howling', 'Pale'];
const SPAWN_DISTANCES_M = [60, 100, 160];

export function nodeBudget(nodeIndex: number): number {
  return GAME_CONTENT.run.ladderBudgetBase + GAME_CONTENT.run.ladderBudgetPerNode * nodeIndex;
}

export function scrapyardNodeIndexes(runSeed: number): number[] {
  const rng = new Pcg32(runSeed ^ 0x9e3779b9);
  const yards = new Set<number>();
  const available = Math.max(0, GAME_CONTENT.run.length - 2);
  const count = Math.min(GAME_CONTENT.run.scrapyardCount, available);
  while (yards.size < count) {
    yards.add(2 + Math.floor(rng.nextFloat() * available));
  }
  return [...yards].sort((a, b) => a - b);
}

export function nodeKind(runSeed: number, nodeIndex: number): GeneratedRunNode['kind'] {
  return scrapyardNodeIndexes(runSeed).includes(nodeIndex) ? 'scrapyard' : 'fight';
}

export function ladderOpponents(runSeed: number, nodeIndex: number): RunOpponentChoice[] {
  const countRng = new Pcg32(runSeed * 31 + nodeIndex);
  const count = 2 + (countRng.nextFloat() < 0.5 ? 1 : 0);
  return Array.from({ length: count }, (_, index) => {
    const cardSeed = (runSeed * 31 + nodeIndex) * 7 + index + 1;
    const rng = new Pcg32(cardSeed ^ 0x51ab);
    const elite = rng.nextFloat() < GAME_CONTENT.run.eliteChance;
    const budget = nodeBudget(nodeIndex) + (elite ? GAME_CONTENT.run.eliteBudgetBonus : 0);
    const generated = generateOpponent({
      budget,
      seed: cardSeed,
      fillPartIds: GAME_CONTENT.enemyFillPartIds,
    });
    const real = generated.build.parts.filter((part) => {
      const definition = getPart(part.partId);
      return !definition.isConduit && !definition.isHeatPipe;
    });
    const confirmed: string[] = [];
    const seen = new Set<string>();
    for (let tries = 0; tries < 12 && confirmed.length < 2 && real.length > 0; tries++) {
      const placed = real[Math.floor(rng.nextFloat() * real.length)]!;
      const definition = getPart(placed.partId);
      if (seen.has(definition.id)) continue;
      seen.add(definition.id);
      confirmed.push(`${definition.id} ${definition.name.split(' ')[0]}`);
    }

    let carries: string | undefined;
    if (elite) {
      const carriers = real.filter((part) =>
        modifierIdsFor(getPart(part.partId)).some((id) => MODIFIERS[id]!.kind === 'mod'));
      if (carriers.length > 0) {
        const carrier = carriers[Math.floor(rng.nextFloat() * carriers.length)]!;
        const pool = modifierIdsFor(getPart(carrier.partId))
          .filter((id) => MODIFIERS[id]!.kind === 'mod');
        const modifierId = pool[Math.floor(rng.nextFloat() * pool.length)]!;
        carrier.modifiers = [...(carrier.modifiers ?? []), modifierId];
        carries = `${MODIFIERS[modifierId]!.name} ${getPart(carrier.partId).name.split(' ')[0]}`;
      }
    }

    const chassis = getChassis(generated.build.chassisId);
    const epithet = EPITHETS[Math.floor(rng.nextFloat() * EPITHETS.length)]!;
    const spawnDistanceM = SPAWN_DISTANCES_M[Math.floor(rng.nextFloat() * SPAWN_DISTANCES_M.length)]!;
    const fillFraction = generated.spentTier / Math.max(budget, 1);
    return {
      id: `node-${nodeIndex}-${index}`,
      name: `${elite ? 'Elite ' : ''}${epithet} ${generated.templateName}`,
      blurb: generated.blurb,
      threat: (elite ? 3 : fillFraction > 0.85 ? 2 : 1) as 1 | 2 | 3,
      confirmed,
      build: generated.build,
      elite,
      battleSeed: cardSeed ^ 0x7ea51e,
      spawnDistanceM,
      chassisLabel: `${chassis.name} · ${chassis.type}`,
      headline: headlineWeapon(generated.build)?.name ?? null,
      carries,
    };
  });
}

export function scrapyardOffers(
  runSeed: number,
  nodeIndex: number,
  rerolled: boolean,
): ScrapyardOffer[] {
  const rng = new Pcg32((runSeed * 131 + nodeIndex) ^ (rerolled ? 0x5eed : 0));
  const pool = GAME_CONTENT.scrapyardPartIds.filter(
    (id) => getPart(id).tier <= Math.max(2, Math.floor(nodeBudget(nodeIndex) / 2)),
  );
  return Array.from({ length: GAME_CONTENT.run.scrapyardOfferCount }, () => {
    const partId = pool[Math.floor(rng.nextFloat() * pool.length)]!;
    const definition = getPart(partId);
    const integrity = GAME_CONTENT.run.scrapyardIntegrityMin
      + rng.nextFloat() * (
        GAME_CONTENT.run.scrapyardIntegrityMax - GAME_CONTENT.run.scrapyardIntegrityMin
      );
    return {
      partId,
      integrity,
      price: Math.max(
        1,
        Math.ceil(definition.tier * GAME_CONTENT.economy.scrapyardBuyMultiplier * integrity),
      ),
    };
  });
}

/** Generate every choice up front so a save is independent of later generator changes. */
export function generateRunNodes(runSeed: number): GeneratedRunNode[] {
  return Array.from({ length: GAME_CONTENT.run.length }, (_, offset): GeneratedRunNode => {
    const index = offset + 1;
    if (nodeKind(runSeed, index) === 'scrapyard') {
      return {
        index,
        kind: 'scrapyard',
        scrapyardOffers: {
          initial: scrapyardOffers(runSeed, index, false),
          reroll: scrapyardOffers(runSeed, index, true),
        },
      };
    }
    return { index, kind: 'fight', opponents: ladderOpponents(runSeed, index) };
  });
}
