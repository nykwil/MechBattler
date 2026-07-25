/**
 * Versioned persistent profile adapter. Progression rules live in the pure
 * @mechbattler/game package; this hook only owns browser storage and React.
 */
import { useCallback, useState } from 'react';
import { CHASSIS, getPart, type BattleReport, type Build } from '@mechbattler/sim';
import {
  GAME_CONTENT,
  applyChallengeProgress,
  deleteSavedMech,
  defaultProfile,
  migrateProfile,
  saveMech as saveProfileMech,
  summarizeBattleForChallenges,
  type PlayerProfile,
  type RunHistoryRecord,
  type SavedMech,
} from '@mechbattler/game';

const PROFILE_KEY = 'mechbattler-profile-v2';
const LEGACY_PROFILE_KEY = 'mechbattler-profile';
const LEGACY_HISTORY_KEY = 'mechbattler-history';
export const HISTORY_MAX = 10;

export type Profile = PlayerProfile;

export interface RunRecord {
  /** Stable run identity keeps a restored memorial from being recorded twice. */
  runId: string;
  kitName: string;
  fightsWon: number;
  cause: string;
  victorious: boolean;
  endedAt: string;
  finalBuild?: Build;
  unlockedPartIds?: string[];
}

export interface UnlockGains {
  /** Chassis names newly unlocked. */
  chassis: string[];
  /** Part names newly unlocked by completed combat challenges. */
  parts: string[];
  /** Challenge names newly completed. */
  challenges: string[];
  chassisIds: string[];
  partIds: string[];
  challengeIds: string[];
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadProfile(): PlayerProfile {
  const current = readJson(PROFILE_KEY);
  if (current) return migrateProfile(current);
  return migrateProfile(readJson(LEGACY_PROFILE_KEY), readJson(LEGACY_HISTORY_KEY));
}

function save(profile: PlayerProfile): void {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch { /* non-fatal */ }
}

export function useProfile() {
  const [profile, setProfile] = useState<PlayerProfile>(loadProfile);

  /** Chassis remain discovery unlocks: defeat a frame to earn it for future starts. */
  const unlockChassisFrom = useCallback((build: Build): UnlockGains => {
    const gains: UnlockGains = {
      chassis: [], parts: [], challenges: [], chassisIds: [], partIds: [], challengeIds: [],
    };
    if (profile.unlockedChassisIds.includes(build.chassisId)) return gains;
    const next = {
      ...profile,
      unlockedChassisIds: [...profile.unlockedChassisIds, build.chassisId],
    };
    gains.chassis.push(CHASSIS[build.chassisId]?.name ?? build.chassisId);
    gains.chassisIds.push(build.chassisId);
    setProfile(next);
    save(next);
    return gains;
  }, [profile]);

  /** Evaluate all declarative battle challenges exactly once. */
  const recordBattleProgress = useCallback((report: BattleReport, enemyBuild: Build): UnlockGains => {
    const summary = summarizeBattleForChallenges(report, enemyBuild);
    const result = applyChallengeProgress(profile, GAME_CONTENT.challenges, summary);
    const challengeNames = result.gains.challengeIds.map(
      (id) => GAME_CONTENT.challenges.find((challenge) => challenge.id === id)?.name ?? id,
    );
    const gains: UnlockGains = {
      chassis: [],
      parts: result.gains.partIds.map((id) => getPart(id).name),
      challenges: challengeNames,
      chassisIds: [],
      partIds: result.gains.partIds,
      challengeIds: result.gains.challengeIds,
    };
    if (result.gains.challengeIds.length > 0) {
      setProfile(result.profile);
      save(result.profile);
    }
    return gains;
  }, [profile]);

  /** Atomic outcome registration avoids one unlock write overwriting another. */
  const recordBattleOutcome = useCallback((report: BattleReport, enemyBuild: Build): UnlockGains => {
    const challengeResult = applyChallengeProgress(
      profile,
      GAME_CONTENT.challenges,
      summarizeBattleForChallenges(report, enemyBuild),
    );
    const chassisIds = new Set(challengeResult.profile.unlockedChassisIds);
    const chassis: string[] = [];
    if (report.winner === 0 && !chassisIds.has(enemyBuild.chassisId)) {
      chassisIds.add(enemyBuild.chassisId);
      chassis.push(CHASSIS[enemyBuild.chassisId]?.name ?? enemyBuild.chassisId);
    }
    const next = { ...challengeResult.profile, unlockedChassisIds: [...chassisIds] };
    const gains: UnlockGains = {
      chassis,
      parts: challengeResult.gains.partIds.map((id) => getPart(id).name),
      challenges: challengeResult.gains.challengeIds.map(
        (id) => GAME_CONTENT.challenges.find((challenge) => challenge.id === id)?.name ?? id,
      ),
      chassisIds: chassis.length > 0 ? [enemyBuild.chassisId] : [],
      partIds: challengeResult.gains.partIds,
      challengeIds: challengeResult.gains.challengeIds,
    };
    if (gains.chassis.length > 0 || gains.parts.length > 0 || gains.challenges.length > 0) {
      setProfile(next);
      save(next);
    }
    return gains;
  }, [profile]);

  /** Append a finished run to the memorial (newest first, capped). */
  const pushHistory = useCallback((record: RunRecord): void => {
    setProfile((previous) => {
      const historyRecord: RunHistoryRecord = {
        runId: record.runId,
        kitName: record.kitName,
        fightsWon: record.fightsWon,
        cause: record.cause,
        victorious: record.victorious,
        endedAt: record.endedAt,
        finalMech: record.finalBuild ? {
          chassisId: record.finalBuild.chassisId,
          parts: record.finalBuild.parts.map((part) => ({
            id: part.instanceId,
            partId: part.partId,
            integrity: part.integrity,
            modifiers: part.modifiers,
            variant: part.variant,
            provenance: { source: 'legacy' },
            origin: part.origin,
            rotation: part.rotation,
          })),
          powerPriority: record.finalBuild.powerPriority,
        } : undefined,
        unlockedPartIds: record.unlockedPartIds,
      };
      if (previous.history.some((entry) => entry.runId === historyRecord.runId)) {
        return previous;
      }
      const next = { ...previous, history: [historyRecord, ...previous.history].slice(0, HISTORY_MAX) };
      save(next);
      return next;
    });
  }, []);

  const saveMech = useCallback((name: string, build: Build, id?: string): SavedMech => {
    const result = saveProfileMech(profile, { id, name, build });
    setProfile(result.profile);
    save(result.profile);
    return result.savedMech;
  }, [profile]);

  const removeSavedMech = useCallback((id: string): void => {
    const next = deleteSavedMech(profile, id);
    setProfile(next);
    save(next);
  }, [profile]);

  return {
    profile,
    unlockChassisFrom,
    recordBattleProgress,
    recordBattleOutcome,
    history: profile.history,
    pushHistory,
    saveMech,
    removeSavedMech,
    resetProfile: () => {
      const next = defaultProfile();
      setProfile(next);
      save(next);
    },
  };
}
