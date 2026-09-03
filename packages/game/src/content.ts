import { BRANCH_PROBE_TEMPLATES, PARTS, STARTER_TEMPLATES, TEMPLATES } from '@mechbattler/sim';
import type { ChallengeDefinition, GameContent } from './types.js';

export const CHALLENGES: ChallengeDefinition[] = [
  {
    id: 'first-blood', name: 'First Blood',
    description: 'Win one battle.',
    criterion: { all: [{ kind: 'battle-won' }] },
    unlockPartIds: ['R-C40', 'W-AC', 'U-HS', 'U-TUR', 'U-SHELL', 'U-MANTLE', 'U-RISE2', 'U-RISE3', 'U-RISEL'],
  },
  {
    id: 'clean-machine', name: 'Clean Machine',
    description: 'Win without losing an installed part.',
    criterion: { all: [{ kind: 'battle-won' }, { kind: 'max-player-parts-lost', value: 0 }] },
    unlockPartIds: ['U-TC1', 'W-LAS', 'U-VENT', 'U-SIGHT'],
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
    unlockPartIds: ['U-ACT', 'U-DRIVE'],
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
    // The long-range gun is earned by playing long range: you did the damage
    // and they never reached you. `standoff` reuses the two criteria that
    // already exist rather than adding a range criterion, which would need new
    // plumbing on the battle report for one unlock.
    id: 'standoff', name: 'Standoff',
    description: 'Deal at least 200 damage and win without losing an installed part.',
    criterion: {
      all: [
        { kind: 'battle-won' },
        { kind: 'min-player-damage', value: 200 },
        { kind: 'max-player-parts-lost', value: 0 },
      ],
    },
    unlockPartIds: ['W-SR'],
  },
  {
    // The close-range hammer is earned the way it is used: you crossed the gap
    // and took the thing apart before it could matter. Like `standoff` this
    // reuses criteria that already exist rather than adding a range one --
    // a short duration plus real dismantling only happens up close.
    id: 'breach', name: 'Breach',
    description: 'Win within 45 seconds having destroyed at least three enemy parts.',
    criterion: {
      all: [
        { kind: 'battle-won' },
        { kind: 'duration-at-most', seconds: 45 },
        { kind: 'min-enemy-parts-destroyed', value: 3 },
      ],
    },
    unlockPartIds: ['W-AV'],
  },
  {
    // The long gun that cooks you is earned by cooking: you ran hot and you
    // stayed out of reach. `redline` already unlocks on peak temperature, so
    // this pairs that with the untouched-parts criterion `standoff` uses --
    // hot AND never closed with, which is the Kiln's whole fight.
    id: 'slow-burn', name: 'Slow Burn',
    description: 'Win at 115 °C or hotter without losing an installed part.',
    criterion: {
      all: [
        { kind: 'battle-won' },
        { kind: 'player-peak-temp-at-least', celsius: 115 },
        { kind: 'max-player-parts-lost', value: 0 },
      ],
    },
    unlockPartIds: ['W-KL'],
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
    unlockPartIds: ['W-ION', 'W-CV', 'W-LNC', 'W-SER'],
  },
];

export const INITIAL_PART_IDS = ['R-E25', 'W-MG', 'W-CB', 'U-CON', 'U-PIPE', 'U-RAD', 'U-ARM'];
export const ENABLED_PART_IDS = Object.keys(PARTS).filter((id) => id !== 'U-AMMO');
export const ENABLED_CHASSIS_IDS = ['CH-2', 'CH-5', 'CH-9'];
export const ONE_HOUR_PART_IDS = [
  ...INITIAL_PART_IDS,
  'R-C40', 'W-AC', 'U-HS', 'U-TUR', 'U-SHELL', 'U-MANTLE',
  'U-TC1', 'W-LAS', 'U-ACT',
];
export const GAMEPLAY_TEMPLATES = [...TEMPLATES, ...BRANCH_PROBE_TEMPLATES, ...STARTER_TEMPLATES];

export function getGameplayTemplate(id: string) {
  return GAMEPLAY_TEMPLATES.find((template) => template.id === id);
}

export const GAME_CONTENT: GameContent = {
  schemaVersion: 4,
  economy: {
    startingScrap: 30,
    // Held at 1.0/node. Steeper ramps were measured four times and rejected —
    // see docs/16 "the difficulty arc and diversity pull against each other".
    // 1.8 buys a properly declining curve and clears both win-rate warnings,
    // but costs an archetype, pushes the dominant one from 29% to 33%, drops
    // CH-9 from seven build directions to six, and shortens one-hour runs from
    // 3.89 battles to 2.72. Widening the economy first (a third scrapyard and a
    // softer repair reserve) was tried specifically to pay for the steeper
    // ladder and did not: shorter runs give a build less time to become
    // anything, whatever it can afford. 1.4 is worse than both ends at seven
    // archetypes and 50% dominance.
    // Purse raised Aug 2026 (5 -> 12 per node). Repair bills scale with how
    // damaged you get, which scales with depth, while income was nearly flat —
    // so scrap ran out around node 4 and the player simply stopped repairing.
    // Measured: repairs per fight fell 3.6 / 3.1 / 2.7 / 1.3 / 0.4 across nodes
    // 1-5 and win rate tracked it exactly, 0.90 / 0.90 / 0.82 / 0.44 / 0.11.
    // That is not repair pressure, it is running out of the ability to play.
    purseBase: 20,
    pursePerNode: 12,
    elitePurseMultiplier: 1.5,
    destroyedScrapMultiplier: 4,
    intactScrapMultiplier: 8,
    ownedScrapMultiplier: 8,
    scrapyardBuyMultiplier: 12,
    extractionWearMax: 0.2,
    repairCostPerPoint: 0.3,
    chassisRepairCostPerPoint: 0.2,
    // Price per tier of mod. A tier-1 convenience is 15 scrap, a tier-3
    // build-definer 45 — within a few scrap of every price that was authored
    // by hand before tier replaced rarity and scrapCost together.
    machinistTierCost: 15,
  },
  run: {
    length: 12,
    benchCap: 8,
    startingTierBudget: 14,
    modServiceEveryWins: 3,
    modOfferCount: 3,
    ladderBudgetBase: 3,
    ladderBudgetPerNode: 1,
    eliteChance: 0.25,
    eliteBudgetBonus: 4,
    // One elite in eight carries a named unique rather than a loose mod. Rare
    // enough that meeting one is an event; common enough that a 12-node run
    // usually shows you exactly one piece of legendary metal to chase.
    uniqueChance: 0.125,
    // 2 -> 3, Aug 2026. Only 41% of runs ever reached a scrapyard at all, so
    // the loop's purchasing step was absent from most of them — and buying is
    // the only way to get a part the opponents in front of you do not drop,
    // which makes it the diversity valve as well as the economy one.
    scrapyardCount: 3,
    scrapyardOfferCount: 4,
    scrapyardIntegrityMin: 0.55,
    scrapyardIntegrityMax: 0.95,
    balanceCheckpointDepths: [1, 4, 7, 10, 12],
    balanceMaxAttemptsPerNode: 2,
    // The difficulty curve, declared per checkpoint (Aug 25 2026). One flat
    // 0.35-0.65 band used to be applied at every depth, and measured 0.897 /
    // 0.238 / 0.000 at rounds 1 / 4 / 7 -- it called the opening broken and the
    // depth broken in the same words. An opening has to be winnable or nobody
    // reaches the content; a late node has to be able to end the run. The
    // targets below say that, so the warnings mean something: under them round
    // 1 is in band and rounds 4 and 7 still warn, which is the finding, not the
    // instrument. No budget or content dial moved to get here --
    // `ladderBudgetPerNode` stays 1.0 for the diversity reasons in docs/16.
    balanceTargetWinRateByDepth: {
      1: { min: 0.75, max: 0.92 },
      4: { min: 0.50, max: 0.70 },
      7: { min: 0.35, max: 0.55 },
      10: { min: 0.25, max: 0.45 },
      12: { min: 0.25, max: 0.45 },
    },
  },
  enabledChassisIds: ENABLED_CHASSIS_IDS,
  enabledPartIds: ENABLED_PART_IDS,
  initialPartIds: INITIAL_PART_IDS,
  initialChassisIds: ['CH-5'],
  scrapyardPartIds: ENABLED_PART_IDS.filter((id) => !PARTS[id]!.isConduit && !PARTS[id]!.isHeatPipe),
  starterKits: [
    { templateId: 'mule-needle', name: 'Mule Needle Skirmisher', blurb: 'Three barrels, mixed reach: hard to disarm, and it can grow either way.' },
    { templateId: 'vulture-skirmisher', name: 'Vulture Skirmisher', blurb: 'Fast, exposed hardpoints reward keeping a firing line.' },
    { templateId: 'probe-bastion-casemate', name: 'Bastion Casemate', blurb: 'Large armored frame built around a heat-spreading hull.' },
  ],
  challenges: CHALLENGES,
  progressionTargets: {
    oneHour: {
      battleCount: 8,
      chassisIds: ENABLED_CHASSIS_IDS,
      partIds: ONE_HOUR_PART_IDS,
    },
  },
};
