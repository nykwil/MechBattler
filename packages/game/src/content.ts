import { PARTS } from '@mechbattler/sim';
import type { ChallengeDefinition, GameContent } from './types.js';

export const CHALLENGES: ChallengeDefinition[] = [
  {
    id: 'first-blood', name: 'First Blood',
    description: 'Win one battle.',
    criterion: { all: [{ kind: 'battle-won' }] },
    unlockPartIds: ['R-C40', 'W-AC', 'U-HS'],
  },
  {
    id: 'clean-machine', name: 'Clean Machine',
    description: 'Win without losing an installed part.',
    criterion: { all: [{ kind: 'battle-won' }, { kind: 'max-player-parts-lost', value: 0 }] },
    unlockPartIds: ['U-TC1', 'W-LAS'],
  },
  {
    id: 'blitz', name: 'Blitz',
    description: 'Win within 30 seconds without losing an installed part.',
    criterion: {
      all: [
        { kind: 'battle-won' },
        { kind: 'duration-at-most', seconds: 30 },
        { kind: 'max-player-parts-lost', value: 0 },
      ],
    },
    unlockPartIds: ['U-ACT'],
  },
  {
    id: 'dismantler', name: 'Dismantler',
    description: 'Destroy at least four enemy non-wiring parts in one victory.',
    criterion: { all: [{ kind: 'battle-won' }, { kind: 'min-enemy-parts-destroyed', value: 4 }] },
    unlockPartIds: ['W-RKT', 'W-BR'],
  },
  {
    id: 'redline', name: 'Redline',
    description: 'Win after your mech reaches at least 115 °C.',
    criterion: { all: [{ kind: 'battle-won' }, { kind: 'player-peak-temp-at-least', celsius: 115 }] },
    unlockPartIds: ['R-C90', 'W-SC'],
  },
  {
    id: 'brownout-survivor', name: 'Brownout Survivor',
    description: 'Win after at least three player power-shed transitions.',
    criterion: { all: [{ kind: 'battle-won' }, { kind: 'min-player-sheds', value: 3 }] },
    unlockPartIds: ['R-E60', 'P-CAP'],
  },
  {
    id: 'heavy-hitter', name: 'Heavy Hitter',
    description: 'Deal at least 150 damage in one victory.',
    criterion: { all: [{ kind: 'battle-won' }, { kind: 'min-player-damage', value: 150 }] },
    unlockPartIds: ['P-CAP2', 'W-RG'],
  },
  {
    id: 'counterbattery', name: 'Counterbattery',
    description: 'Defeat a capacitor-equipped enemy and destroy one of its capacitors.',
    criterion: {
      all: [
        { kind: 'battle-won' },
        { kind: 'enemy-has-capacitor' },
        { kind: 'enemy-capacitor-destroyed' },
      ],
    },
    unlockPartIds: ['W-ION'],
  },
];

export const INITIAL_PART_IDS = ['R-E25', 'W-MG', 'W-CB', 'U-CON', 'U-PIPE', 'U-RAD', 'U-ARM'];
export const ENABLED_PART_IDS = Object.keys(PARTS).filter((id) => id !== 'U-AMMO');

export const GAME_CONTENT: GameContent = {
  schemaVersion: 3,
  economy: {
    startingScrap: 30,
    purseBase: 20,
    pursePerNode: 5,
    elitePurseMultiplier: 1.5,
    destroyedScrapMultiplier: 4,
    intactScrapMultiplier: 8,
    ownedScrapMultiplier: 8,
    scrapyardBuyMultiplier: 12,
    extractionWearMax: 0.2,
    repairCostPerPoint: 0.4,
    machinistBaseCost: 25,
    chassisRecoveryBaseCost: 20,
    chassisRecoveryPerCell: 2,
  },
  run: {
    length: 12,
    benchCap: 8,
    startingTierBudget: 14,
    modServiceEveryWins: 3,
    modOfferCount: 3,
    ladderBudgetBase: 6,
    ladderBudgetPerNode: 2,
    eliteChance: 0.25,
    eliteBudgetBonus: 4,
    scrapyardCount: 2,
    scrapyardOfferCount: 4,
    scrapyardIntegrityMin: 0.55,
    scrapyardIntegrityMax: 0.95,
    balanceCheckpointDepths: [1, 4, 7, 10, 12],
    balanceMaxAttemptsPerNode: 2,
    balanceTargetWinRateMin: 0.35,
    balanceTargetWinRateMax: 0.65,
  },
  enabledPartIds: ENABLED_PART_IDS,
  initialPartIds: INITIAL_PART_IDS,
  initialChassisIds: ['CH-2'],
  scrapyardPartIds: ENABLED_PART_IDS.filter((id) => !PARTS[id]!.isConduit && !PARTS[id]!.isHeatPipe),
  enemyFillPartIds: ENABLED_PART_IDS.filter((id) => !PARTS[id]!.isConduit && !PARTS[id]!.isHeatPipe),
  starterKits: [
    { templateId: 'vulture-skirmisher', name: 'Vulture Skirmisher', blurb: 'Fast, cool, shallow — a carbine scout with close-in teeth.' },
    { templateId: 'mule-gunline', name: 'Mule Gunline', blurb: 'The tutorial-shaped build: one autocannon, one firing line.' },
    { templateId: 'mule-laser-boat', name: 'Mule Tinkerer', blurb: 'Hybrid reactors and a heat-pipe highway — a heat puzzle from fight 1.' },
  ],
  challenges: CHALLENGES,
};
