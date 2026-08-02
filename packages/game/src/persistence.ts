import { getChassis, getPart, validateWholeBuildPlacement, type Build } from '@mechbattler/sim';
import { GAME_CONTENT, getGameplayTemplate } from './content.js';
import { generateRunNodes } from './nodes.js';
import {
  GAME_SAVE_VERSION,
  type PlayerProfile,
  type RunInstance,
  type SavedMech,
} from './types.js';

const SAVED_MECH_LIMIT = 24;

function legalStarterBlueprint(
  unlockedChassisIds: string[],
  unlockedPartIds: string[],
): SavedMech[] {
  const starter = GAME_CONTENT.starterKits.find((kit) => {
    const template = getGameplayTemplate(kit.templateId);
    return Boolean(template)
      && unlockedChassisIds.includes(template!.build.chassisId)
      && template!.build.parts.every((part) => unlockedPartIds.includes(part.partId));
  });
  const template = starter && getGameplayTemplate(starter.templateId);
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
  // v4 deliberately resets older profiles and runs. The active roster now has
  // three regional chassis, so legacy flat coordinates are not equivalent.
  void legacyHistory;
  return defaultProfile();
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
    routes: structuredClone(build.routes ?? []),
    chassisIntegrity: 1,
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
  let allPartsKnown = true;
  for (const part of build.parts) {
    if (!profile.unlockedPartIds.includes(part.partId)) {
      errors.push(`Part ${part.partId} is not owned`);
      continue;
    }
    try {
      getPart(part.partId);
    } catch {
      errors.push(`Unknown part ${part.partId}`);
      allPartsKnown = false;
    }
  }
  if (allPartsKnown) {
    for (const issue of validateWholeBuildPlacement(chassis, build)) {
      if (issue.target === 'part') {
        errors.push(`Illegal placement for ${issue.instanceId}: ${issue.reason}`);
      } else {
        errors.push(
          `Illegal ${issue.route?.kind ?? 'route'} at ${issue.route?.regionId ?? 'body'}:${issue.route?.x},${issue.route?.y}: ${issue.reason}`,
        );
      }
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
    current.mech.routes ??= [];
    current.mech.chassisIntegrity ??= 1;
    return current;
  }
  return null;
}
