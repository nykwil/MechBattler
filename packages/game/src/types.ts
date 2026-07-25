import type { Build, PlacedPart, Rotation } from '@mechbattler/sim';

export const GAME_SAVE_VERSION = 2;

export interface PartProvenance {
  source: 'starter' | 'salvage' | 'scrapyard' | 'legacy';
  nodeIndex?: number;
  opponentName?: string;
}

export interface PartInstance {
  id: string;
  partId: string;
  integrity: number;
  modifiers?: string[];
  variant?: PlacedPart['variant'];
  provenance: PartProvenance;
}

export interface InstalledPart extends PartInstance {
  origin: { x: number; y: number };
  rotation: Rotation;
}

export interface MechInstance {
  chassisId: string;
  parts: InstalledPart[];
  powerPriority: string[];
}

export interface SalvageCandidate extends PartInstance {
  /** Enemy-wreck placement retained so the actual defeated mech can be shown. */
  origin: { x: number; y: number };
  rotation: Rotation;
  destroyed: boolean;
  scrapValue: number;
}

export interface RunOpponentChoice {
  id: string;
  name: string;
  blurb: string;
  threat: 1 | 2 | 3;
  confirmed: string[];
  build: Build;
  elite: boolean;
  battleSeed: number;
  spawnDistanceM: number;
  chassisLabel: string;
  headline: string | null;
  carries?: string;
}

export interface ScrapyardOffer {
  partId: string;
  integrity: number;
  price: number;
}

export interface GeneratedRunNode {
  index: number;
  kind: 'fight' | 'scrapyard';
  opponents?: RunOpponentChoice[];
  scrapyardOffers?: {
    initial: ScrapyardOffer[];
    reroll: ScrapyardOffer[];
  };
}

export interface PendingSalvage {
  opponentName: string;
  opponentChassisId: string;
  purse: number;
  candidates: SalvageCandidate[];
  unlocks?: {
    chassis: string[];
    parts: string[];
    challenges: string[];
  };
  unlockIds?: {
    chassis: string[];
    parts: string[];
    challenges: string[];
  };
}

export interface PendingModService {
  afterWin: number;
  offerIds: string[];
  applied: boolean;
}

export type RunEvent =
  | { type: 'battle'; nodeIndex: number; won: boolean; reason: string }
  | { type: 'part-lost'; nodeIndex: number; partId: string; partInstanceId: string }
  | { type: 'salvage'; nodeIndex: number; takenIds: string[]; scrapGained: number }
  | { type: 'repair'; nodeIndex: number; partInstanceId: string; integrity: number; cost: number }
  | { type: 'scrap'; nodeIndex: number; partInstanceId: string; scrapGained: number }
  | { type: 'refit'; nodeIndex: number; partInstanceId: string; installed: boolean }
  | { type: 'scrapyard'; nodeIndex: number; partInstanceId: string; cost: number }
  | { type: 'mod'; nodeIndex: number; partInstanceId: string; modifierId: string }
  | { type: 'unlock'; challengeId: string; partIds: string[] };

export interface RunInstance {
  schemaVersion: typeof GAME_SAVE_VERSION;
  id: string;
  seed: number;
  status: 'prep' | 'active' | 'over';
  nodeIndex: number;
  scrap: number;
  fightsWon: number;
  battlesCompleted: number;
  kitName: string;
  earnedChassisIds: string[];
  earnedPartIds: string[];
  earnedChallengeIds: string[];
  /** Choices are generated once from the seed, then saved verbatim. */
  generatedNodes: GeneratedRunNode[];
  mech: MechInstance;
  bench: PartInstance[];
  pendingSalvage?: PendingSalvage;
  pendingModService?: PendingModService;
  yardRerolled?: boolean;
  cause?: string;
  victorious?: boolean;
  events: RunEvent[];
}

export interface RunHistoryRecord {
  runId: string;
  kitName: string;
  fightsWon: number;
  cause: string;
  victorious: boolean;
  endedAt: string;
  finalMech?: MechInstance;
  unlockedPartIds?: string[];
}

export interface PlayerProfile {
  schemaVersion: typeof GAME_SAVE_VERSION;
  unlockedChassisIds: string[];
  unlockedPartIds: string[];
  completedChallengeIds: string[];
  grandfatheredPartIds: string[];
  history: RunHistoryRecord[];
}

export type ChallengePredicate =
  | { kind: 'battle-won' }
  | { kind: 'max-player-parts-lost'; value: number }
  | { kind: 'duration-at-most'; seconds: number }
  | { kind: 'min-enemy-parts-destroyed'; value: number }
  | { kind: 'player-peak-temp-at-least'; celsius: number }
  | { kind: 'min-player-sheds'; value: number }
  | { kind: 'min-player-damage'; value: number }
  | { kind: 'enemy-has-capacitor' }
  | { kind: 'enemy-capacitor-destroyed' };

export interface ChallengeDefinition {
  id: string;
  name: string;
  description: string;
  criterion: { all: ChallengePredicate[] } | { any: ChallengePredicate[] };
  unlockPartIds: string[];
}

export interface StarterKitDefinition {
  templateId: string;
  name: string;
  blurb: string;
}

export interface EconomyConfig {
  startingScrap: number;
  purseBase: number;
  pursePerNode: number;
  elitePurseMultiplier: number;
  destroyedScrapMultiplier: number;
  intactScrapMultiplier: number;
  ownedScrapMultiplier: number;
  scrapyardBuyMultiplier: number;
  extractionWearMax: number;
  repairCostPerPoint: number;
  machinistBaseCost: number;
}

export interface RunConfig {
  length: number;
  benchCap: number;
  startingTierBudget: number;
  modServiceEveryWins: number;
  modOfferCount: number;
  ladderBudgetBase: number;
  ladderBudgetPerNode: number;
  eliteChance: number;
  eliteBudgetBonus: number;
  scrapyardCount: number;
  scrapyardOfferCount: number;
  scrapyardIntegrityMin: number;
  scrapyardIntegrityMax: number;
}

export interface GameContent {
  schemaVersion: number;
  economy: EconomyConfig;
  run: RunConfig;
  enabledPartIds: string[];
  initialPartIds: string[];
  initialChassisIds: string[];
  scrapyardPartIds: string[];
  enemyFillPartIds: string[];
  starterKits: StarterKitDefinition[];
  challenges: ChallengeDefinition[];
}

export interface BattleChallengeSummary {
  won: boolean;
  durationS: number;
  playerPartsLost: number;
  enemyPartsDestroyed: number;
  playerPeakTempC: number;
  playerShedCount: number;
  playerDamage: number;
  enemyHasCapacitor: boolean;
  enemyCapacitorDestroyed: boolean;
}

export interface LegacyStoredRun {
  data: {
    seed: number;
    nodeIndex: number;
    scrap: number;
    fightsWon: number;
    kitName: string;
    benchPool?: Array<{
      partId: string;
      integrity: number;
      modifiers?: string[];
      variant?: PlacedPart['variant'];
    }>;
    yardRerolled?: boolean;
  };
  build: Build;
  prep?: boolean;
}
