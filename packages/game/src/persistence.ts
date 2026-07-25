import type { Profile as LegacyProfile, RunRecord as LegacyRunRecord } from './legacy-types.js';
import { GAME_CONTENT } from './content.js';
import { buildToMech } from './domain.js';
import { generateRunNodes } from './nodes.js';
import {
  GAME_SAVE_VERSION,
  type LegacyStoredRun,
  type PartInstance,
  type PlayerProfile,
  type RunHistoryRecord,
  type RunInstance,
} from './types.js';

export function defaultProfile(): PlayerProfile {
  return {
    schemaVersion: GAME_SAVE_VERSION,
    unlockedChassisIds: [...GAME_CONTENT.initialChassisIds],
    unlockedPartIds: [...GAME_CONTENT.initialPartIds],
    completedChallengeIds: [],
    grandfatheredPartIds: [],
    history: [],
  };
}

export function migrateProfile(raw: unknown, legacyHistory: unknown = []): PlayerProfile {
  if (raw && typeof raw === 'object' && (raw as { schemaVersion?: number }).schemaVersion === GAME_SAVE_VERSION) {
    return structuredClone(raw as PlayerProfile);
  }
  const legacy = (raw && typeof raw === 'object' ? raw : {}) as Partial<LegacyProfile>;
  const legacyPartIds = legacy.unlockedParts ?? [];
  const unlockedPartIds = [...new Set([...GAME_CONTENT.initialPartIds, ...legacyPartIds])];
  const unlockedChassisIds = [
    ...new Set([...GAME_CONTENT.initialChassisIds, ...(legacy.unlockedChassis ?? [])]),
  ];
  const records = Array.isArray(legacyHistory) ? legacyHistory as LegacyRunRecord[] : [];
  const history: RunHistoryRecord[] = records.map((record, index) => ({
    runId: `legacy-${index}`,
    kitName: record.kitName,
    fightsWon: record.fightsWon,
    cause: record.cause,
    victorious: record.victorious,
    endedAt: record.endedAt,
  }));
  return {
    schemaVersion: GAME_SAVE_VERSION,
    unlockedChassisIds,
    unlockedPartIds,
    completedChallengeIds: [],
    grandfatheredPartIds: [...legacyPartIds],
    history,
  };
}

export function migrateRun(raw: unknown): RunInstance | null {
  if (!raw || typeof raw !== 'object') return null;
  if ((raw as { schemaVersion?: number }).schemaVersion === GAME_SAVE_VERSION) {
    const current = structuredClone(raw as RunInstance);
    current.generatedNodes ??= generateRunNodes(current.seed);
    current.earnedChassisIds ??= [];
    current.earnedPartIds ??= [];
    current.earnedChallengeIds ??= [];
    current.events ??= [];
    return current;
  }
  const legacy = raw as Partial<LegacyStoredRun>;
  if (!legacy.data || !legacy.build) return null;
  const bench: PartInstance[] = (legacy.data.benchPool ?? []).map((part, index) => ({
    id: `legacy-bench-${legacy.data!.seed}-${index}`,
    partId: part.partId,
    integrity: part.integrity,
    modifiers: part.modifiers,
    variant: part.variant,
    provenance: { source: 'legacy' },
  }));
  return {
    schemaVersion: GAME_SAVE_VERSION,
    id: `run-${legacy.data.seed.toString(16)}`,
    seed: legacy.data.seed,
    status: legacy.prep ? 'prep' : 'active',
    nodeIndex: legacy.data.nodeIndex,
    scrap: legacy.data.scrap,
    fightsWon: legacy.data.fightsWon,
    battlesCompleted: legacy.data.fightsWon,
    kitName: legacy.data.kitName,
    earnedChassisIds: [],
    earnedPartIds: [],
    earnedChallengeIds: [],
    generatedNodes: generateRunNodes(legacy.data.seed),
    mech: buildToMech(legacy.build, 'legacy'),
    bench,
    yardRerolled: legacy.data.yardRerolled,
    events: [],
  };
}
