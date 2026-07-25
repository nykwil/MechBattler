import { TEMPLATES, checkPlacement, getChassis, getPart, type Build } from '@mechbattler/sim';
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
  type SavedMech,
} from './types.js';

const SAVED_MECH_LIMIT = 24;

function legalStarterBlueprint(
  unlockedChassisIds: string[],
  unlockedPartIds: string[],
): SavedMech[] {
  const starter = GAME_CONTENT.starterKits.find((kit) => {
    const template = TEMPLATES.find((candidate) => candidate.id === kit.templateId);
    return Boolean(template)
      && unlockedChassisIds.includes(template!.build.chassisId)
      && template!.build.parts.every((part) => unlockedPartIds.includes(part.partId));
  });
  const template = starter && TEMPLATES.find((candidate) => candidate.id === starter.templateId);
  return starter && template ? [{
    id: `factory-${starter.templateId}`,
    name: starter.name,
    build: structuredClone(template.build),
  }] : [];
}

export function defaultProfile(): PlayerProfile {
  const unlockedChassisIds = [...GAME_CONTENT.initialChassisIds];
  const unlockedPartIds = [...GAME_CONTENT.initialPartIds];
  return {
    schemaVersion: GAME_SAVE_VERSION,
    unlockedChassisIds,
    unlockedPartIds,
    completedChallengeIds: [],
    grandfatheredPartIds: [],
    savedMechs: legalStarterBlueprint(unlockedChassisIds, unlockedPartIds),
    history: [],
  };
}

export function migrateProfile(raw: unknown, legacyHistory: unknown = []): PlayerProfile {
  if (raw && typeof raw === 'object' && (raw as { schemaVersion?: number }).schemaVersion === GAME_SAVE_VERSION) {
    const current = structuredClone(raw as PlayerProfile);
    current.savedMechs ??= legalStarterBlueprint(current.unlockedChassisIds, current.unlockedPartIds);
    return current;
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
    savedMechs: legalStarterBlueprint(unlockedChassisIds, unlockedPartIds),
    history,
  };
}

function pristineBlueprint(build: Build): Build {
  return {
    chassisId: build.chassisId,
    parts: build.parts.map((part) => ({
      instanceId: part.instanceId,
      partId: part.partId,
      origin: { ...part.origin },
      rotation: part.rotation,
      integrity: 1,
    })),
    powerPriority: [...build.powerPriority],
  };
}

/** Reject saved designs that contain unavailable or illegally placed content. */
export function savedMechErrors(profile: PlayerProfile, build: Build): string[] {
  const errors: string[] = [];
  if (!profile.unlockedChassisIds.includes(build.chassisId)) {
    errors.push(`Chassis ${build.chassisId} is not owned`);
    return errors;
  }
  const chassis = getChassis(build.chassisId);
  const placed = [];
  const ids = new Set<string>();
  for (const part of build.parts) {
    if (!profile.unlockedPartIds.includes(part.partId)) {
      errors.push(`Part ${part.partId} is not owned`);
      continue;
    }
    if (ids.has(part.instanceId)) errors.push(`Duplicate part instance ${part.instanceId}`);
    ids.add(part.instanceId);
    try {
      const issue = checkPlacement(chassis, placed, part, getPart(part.partId));
      if (issue) errors.push(`Illegal placement for ${part.instanceId}: ${issue.reason}`);
      else placed.push(part);
    } catch {
      errors.push(`Unknown part ${part.partId}`);
    }
  }
  return errors;
}

/**
 * Add or overwrite a saved mech. Physical run state (damage, variants and
 * run-only mods) is deliberately stripped so this remains a loadout blueprint.
 */
export function saveMech(
  profile: PlayerProfile,
  input: { id?: string; name: string; build: Build },
): { profile: PlayerProfile; savedMech: SavedMech } {
  const name = input.name.trim().slice(0, 40);
  if (!name) throw new Error('Saved mech name is required');
  const build = pristineBlueprint(input.build);
  const errors = savedMechErrors(profile, build);
  if (errors.length > 0) throw new Error(errors.join('; '));
  const existing = input.id
    ? profile.savedMechs.find((candidate) => candidate.id === input.id)
    : undefined;
  const id = existing?.id ?? `mech-${profile.savedMechs.reduce((next, candidate) => {
    const match = /^mech-(\d+)$/.exec(candidate.id);
    return match ? Math.max(next, Number(match[1]) + 1) : next;
  }, 1)}`;
  const savedMech = { id, name, build };
  const savedMechs = existing
    ? profile.savedMechs.map((candidate) => candidate.id === id ? savedMech : candidate)
    : [...profile.savedMechs, savedMech].slice(-SAVED_MECH_LIMIT);
  return { profile: { ...profile, savedMechs }, savedMech };
}

export function deleteSavedMech(profile: PlayerProfile, id: string): PlayerProfile {
  return { ...profile, savedMechs: profile.savedMechs.filter((candidate) => candidate.id !== id) };
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
