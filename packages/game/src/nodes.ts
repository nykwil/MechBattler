import {
  MODIFIERS,
  Pcg32,
  applyUnique,
  computeBurstDps,
  generateOpponent,
  getChassis,
  getPart,
  headlineWeapon,
  modifierIdsFor,
  LADDER_SPAWN_DISTANCES_M,
  computeRank,
  modDrawWeight,
  pickWeighted,
  uniquesForPart,
  LADDER_TEMPLATES,
  type Build,
} from '@mechbattler/sim';
import { GAME_CONTENT } from './content.js';
import type {
  GeneratedRunNode,
  RunOpponentChoice,
  ScrapyardOffer,
} from './types.js';

export const ELITE_PURSE_MULT = GAME_CONTENT.economy.elitePurseMultiplier;

const EPITHETS = ['Rusty', 'Feral', 'Grim', 'Vagrant', 'Ashen', 'Copper', 'Howling', 'Pale'];
// LADDER_SPAWN_DISTANCES_M lives in the sim now (the invariant sweep measures
// across it and the sim may not import this package); re-exported so no call
// site here or in the web app had to change.
export { LADDER_SPAWN_DISTANCES_M };

/**
 * Threat is the only strength signal on an opponent card, so it has to track the
 * build the generator actually produced. Rating it by budget fill instead made
 * threat 1 unreachable and left threat 2 and 3 with the same DPS distribution,
 * which is why two cards at the same node could differ by 40 points of win rate
 * with nothing on screen to tell them apart.
 */
export function opponentThreat(build: Build, elite: boolean): 1 | 2 | 3 {
  const hp = build.parts.reduce((sum, part) => {
    const definition = getPart(part.partId);
    return definition.isConduit || definition.isHeatPipe ? sum : sum + definition.hp;
  }, 0);
  // Chassis integrity counts. Reading only the equipment made a sparsely
  // fitted assault hull look like fodder — 700 points of structure against a
  // scout's 240 is most of what it takes to kill the thing, and a card that
  // hides that is lying to the player about the fight.
  const structure = getChassis(build.chassisId).maxIntegrity;
  const score = computeBurstDps(build).totalDps * 6 + hp * 0.1 + structure * 0.1;
  /*
   * Absolute thresholds, tuned around mid-ladder budgets. Scaling them by node
   * depth was tried Aug 2026 and reverted -- see docs/16. It fixes something
   * real (every card at nodes 0-4 rates threat 1, so the card offers a new
   * player no decision) but it puts harder-rated fights in front of shallow
   * runs, and the runs got shorter: CH-9 fell from three viable build directions
   * to two and the "a build cannot develop" warning returned. Worth revisiting
   * alongside whatever lengthens early runs, not before.
   */
  const base = score < 200 ? 1 : score < 275 ? 2 : 3;
  return Math.max(base, elite ? 2 : 1) as 1 | 2 | 3;
}

/** Rounded: budgets are spent against integer part tiers, so a fractional ramp
 *  rate has to land on a whole number before the generator sees it. */
export function nodeBudget(nodeIndex: number): number {
  return Math.round(
    GAME_CONTENT.run.ladderBudgetBase + GAME_CONTENT.run.ladderBudgetPerNode * nodeIndex,
  );
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

/**
 * Opponent doctrines: a frame family plus a fill pool that agrees with it.
 *
 * The ladder used to draw fill parts uniformly from *every* enabled part, on a
 * frame picked at random from every frame that fit the budget. That produces
 * incoherent mechs -- a sniper frame stuffed with flamers and a spare reactor --
 * and an incoherent mech is a weak mech whatever it cost. It is why the loop sat
 * at an 87% win rate while its opponents were nominally on budget.
 *
 * Coherence is the lever that does not cost a tier. Raising `ladderBudgetPerNode`
 * to 1.5 was measured and rejected: it shortened runs, cut distinct archetypes
 * from 10 to 6, and barely moved the win rate (docs/16). A doctrine makes the
 * same budget dangerous instead of making it bigger.
 *
 * They are also the reason to build differently. Each one attacks a different
 * axis the player can defend on, so "what beat me last time" has more than one
 * answer: outrange the lancer, outlast the furnace, out-armour the swarm, or
 * out-mobile the line.
 */
interface Doctrine {
  id: string;
  /** Shown on the intel card, so a recognisable threat can be prepared for. */
  label: string;
  templateIds: readonly string[];
  fillPartIds: readonly string[];
}

const DOCTRINES: readonly Doctrine[] = [
  {
    id: 'line',
    label: 'LINE',
    templateIds: ['mule-gunline', 'mule-runt', 'bastion-picket', 'bastion-tank'],
    // Mid-range and hard to move: it wants a firing line and armour to hold it.
    fillPartIds: ['W-AC', 'W-MG', 'U-ARM', 'U-ARM', 'U-RAD'],
  },
  {
    id: 'lancer',
    label: 'LANCER',
    templateIds: ['vulture-sniper', 'railgun-mule', 'mule-gunline'],
    // Reach and fire control. Punishes standing still in the open, and now that
    // a targeting computer buys down the lateral penalty specifically, it also
    // punishes crossing in front of it lazily.
    fillPartIds: ['W-CB', 'W-CB', 'U-TC1', 'U-RAD', 'U-ARM'],
  },
  {
    id: 'swarm',
    label: 'SWARM',
    templateIds: ['vulture-skirmisher', 'vulture-scrapper', 'mule-skirmisher', 'mule-runt'],
    // Fast and cheap. The lateral-target penalty is what makes this doctrine
    // frightening rather than merely quick -- a crosser is hit about a third of
    // the time, so a slow gunline cannot simply trade with it.
    fillPartIds: ['W-MG', 'W-MG', 'U-ACT', 'U-ARM'],
  },
  {
    id: 'furnace',
    label: 'FURNACE',
    templateIds: ['mule-laser-boat', 'mule-gunline', 'bastion-tank'],
    // Hitscan and heat. Never has to lead a target, and pours heat into one that
    // brought no cooling of its own.
    fillPartIds: ['W-LAS', 'W-SC', 'U-RAD', 'U-HS', 'U-ARM'],
  },
];

/**
 * Every part an opponent can actually put on the field: the doctrines' fill pools
 * plus everything already bolted to the frames they draw from.
 *
 * The content audit used to answer this with "every enabled part", which was true
 * when fill was drawn uniformly from the whole catalog and became a lie the
 * moment doctrines defined real pools. It decides whether a part is reachable by
 * `enemy-salvage`, so overstating it claims the player can salvage things no
 * enemy ever carries.
 */
export const ENEMY_FIELDABLE_PART_IDS: string[] = (() => {
  const ids = new Set<string>();
  for (const doctrine of DOCTRINES) {
    for (const id of doctrine.fillPartIds) ids.add(id);
    for (const frameId of doctrine.templateIds) {
      const frame = LADDER_TEMPLATES.find((t) => t.id === frameId);
      for (const part of frame?.build.parts ?? []) ids.add(part.partId);
    }
  }
  return [...ids].sort();
})();

/** Which chassis each ladder frame is built on, for the per-node chassis spread. */
const FRAME_CHASSIS = new Map(LADDER_TEMPLATES.map((t) => [t.id, t.build.chassisId]));

/**
 * `count` items drawn from `source` without replacement, wrapping if more are
 * asked for than exist.
 *
 * Both things a node spreads across its cards -- doctrine and chassis -- need
 * exactly this, and rolling each card independently instead has broken the run
 * twice. All three cards could come up the same doctrine, which stops the node
 * being a choice between different kinds of fight; and chassis exposure went
 * lumpy enough that a fresh profile measured 35 Mules and *zero* Bastions across
 * 40 fights, so CH-9 could never unlock however the run went. Chassis
 * reachability is a success criterion, and leaving it to emerge from budget
 * arithmetic failed repeatedly -- the generator falls back to the cheapest frame
 * that fits, and the cheapest frames are Mules.
 *
 * The shuffle consumes `rng` in a fixed order, so the caller's seed still
 * determines the whole node.
 */
function drawWithoutReplacement<T>(rng: Pcg32, source: readonly T[], count: number): T[] {
  const pool = [...source];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng.nextFloat() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return Array.from({ length: count }, (_, i) => pool[i % pool.length]!);
}

/** The chassis each card should be built on; the doctrine still decides what kind of fight it is. */
const CHASSIS_SPREAD = ['CH-2', 'CH-5', 'CH-7', 'CH-9'] as const;

export function ladderOpponents(runSeed: number, nodeIndex: number): RunOpponentChoice[] {
  const countRng = new Pcg32(runSeed * 31 + nodeIndex);
  const count = 2 + (countRng.nextFloat() < 0.5 ? 1 : 0);
  // Order matters: the doctrine draw consumes `countRng` before the chassis
  // draw does, and swapping them would reseed every node in every saved run.
  const doctrines = drawWithoutReplacement(countRng, DOCTRINES, count);
  const chassisTargets = drawWithoutReplacement(countRng, CHASSIS_SPREAD, count);
  return Array.from({ length: count }, (_, index) => {
    const cardSeed = (runSeed * 31 + nodeIndex) * 7 + index + 1;
    const rng = new Pcg32(cardSeed ^ 0x51ab);
    const elite = rng.nextFloat() < GAME_CONTENT.run.eliteChance;
    const budget = nodeBudget(nodeIndex) + (elite ? GAME_CONTENT.run.eliteBudgetBonus : 0);
    const doctrine = doctrines[index]!;
    // Doctrine first, chassis second: narrow to the frames that are both, and
    // fall back to the whole doctrine when it owns nothing on that chassis
    // rather than inventing an off-doctrine opponent.
    const onChassis = doctrine.templateIds.filter(
      (id) => FRAME_CHASSIS.get(id) === chassisTargets[index],
    );
    const generated = generateOpponent({
      budget,
      seed: cardSeed,
      fillPartIds: doctrine.fillPartIds,
      templateIds: onChassis.length > 0 ? onChassis : doctrine.templateIds,
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
        // Weighted by tier, one float — the same draw cost as the uniform
        // pick it replaced, so nothing downstream in this card reseeds.
        const modifierId = pickWeighted(pool, (id) => modDrawWeight(MODIFIERS[id]!.tier), rng)!;
        carrier.modifiers = [...(carrier.modifiers ?? []), modifierId];
        carries = `${MODIFIERS[modifierId]!.name} ${getPart(carrier.partId).name.split(' ')[0]}`;

        // A unique replaces that roll outright, on its own stream so the odds
        // can be retuned without shifting the epithet and spawn draws below.
        // It overwrites rather than adds: a unique *is* the roll (docs/04 §4b).
        const uniqueRng = new Pcg32(cardSeed ^ 0x0117e);
        const candidates = uniquesForPart(carrier.partId);
        if (candidates.length > 0 && uniqueRng.nextFloat() < GAME_CONTENT.run.uniqueChance) {
          const unique = pickWeighted(candidates, (u) => modDrawWeight(u.tier), uniqueRng)!;
          Object.assign(carrier, applyUnique(carrier, unique));
          carries = unique.name;
        }

        // The mod costs rank, so it has to come out of the same budget the
        // metal did. It is stamped here, after generateOpponent has already
        // spent that budget, so the fill pays for it: drop generated fill parts
        // -- never the template's own, which are the opponent's identity --
        // cheapest first, until the card is back inside its budget.
        //
        // Without this an elite received eliteBudgetBonus *and* a free mod, and
        // the mod was the more valuable of the two. It was also why counting
        // mods in computeRank moved the measured ladder by exactly nothing.
        //
        // It cannot always succeed: when the template alone fills the budget
        // there is no generated fill to drop, and the alternative would be
        // deleting the opponent's own identity to pay for a perk. Measured over
        // 200 seeds, 87.5% of modded cards land inside budget and the rest
        // overspend by at most one mod's tier. (It was 95% before the chassis
        // began costing rank: the frame now takes budget that generated fill
        // used to occupy, so there is less of it to drop.)
        for (let guard = 0; guard < 12 && computeRank(generated.build) > budget; guard++) {
          const fill = generated.build.parts
            .filter((part) => part.instanceId.startsWith('gen-'))
            .sort((a, b) => getPart(a.partId).tier - getPart(b.partId).tier);
          const drop = fill[0];
          if (!drop) break;
          generated.build = {
            ...generated.build,
            parts: generated.build.parts.filter((part) => part.instanceId !== drop.instanceId),
            powerPriority: generated.build.powerPriority.filter((id) => id !== drop.instanceId),
          };
        }
      }
    }

    const chassis = getChassis(generated.build.chassisId);
    const epithet = EPITHETS[Math.floor(rng.nextFloat() * EPITHETS.length)]!;
    const spawnDistanceM = LADDER_SPAWN_DISTANCES_M[Math.floor(rng.nextFloat() * LADDER_SPAWN_DISTANCES_M.length)]!;
    return {
      id: `node-${nodeIndex}-${index}`,
      name: `${elite ? 'Elite ' : ''}${epithet} ${generated.templateName}`,
      blurb: generated.blurb,
      threat: opponentThreat(generated.build, elite),
      confirmed,
      build: generated.build,
      elite,
      battleSeed: cardSeed ^ 0x7ea51e,
      spawnDistanceM,
      chassisLabel: `${chassis.name} · ${chassis.type} · ${doctrine.label}`,
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
