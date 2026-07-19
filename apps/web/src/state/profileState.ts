/**
 * The persistent player profile (docs/04 §7, docs/10 M6): the one carryover
 * across runs. Unlocks are horizontal — beating a mech riding a locked
 * chassis unlocks the chassis; beating locked parts unlocks them as
 * *starting* parts. Unlocks shape run start only (custom-frame prep, kit
 * availability); in-run acquisition is never gated. Plus the run-history
 * memorial (last N runs).
 */
import { useCallback, useState } from 'react';
import { CHASSIS, PARTS, TEMPLATES, getPart, type Build } from '@mechbattler/sim';
import { STARTER_KITS } from './runState.js';

const PROFILE_KEY = 'mechbattler-profile';
const HISTORY_KEY = 'mechbattler-history';
export const HISTORY_MAX = 10;

export interface Profile {
  unlockedChassis: string[];
  unlockedParts: string[];
}

export interface RunRecord {
  kitName: string;
  fightsWon: number;
  cause: string;
  victorious: boolean;
  endedAt: string; // ISO date
}

export interface UnlockGains {
  /** Chassis names newly unlocked. */
  chassis: string[];
  /** Part names newly unlocked. */
  parts: string[];
}

/** A fresh profile: the starter kits' chassis and parts, wiring always free. */
export function defaultProfile(): Profile {
  const chassis = new Set<string>();
  const parts = new Set<string>(['U-CON', 'U-PIPE']);
  for (const kit of STARTER_KITS) {
    const t = TEMPLATES.find((x) => x.id === kit.templateId);
    if (!t) continue;
    chassis.add(t.build.chassisId);
    for (const p of t.build.parts) parts.add(p.partId);
  }
  return { unlockedChassis: [...chassis], unlockedParts: [...parts] };
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function useProfile() {
  const [profile, setProfile] = useState<Profile>(() => loadJson(PROFILE_KEY, defaultProfile()));
  const [history, setHistory] = useState<RunRecord[]>(() => loadJson(HISTORY_KEY, [] as RunRecord[]));

  /**
   * Register a beaten build: anything it rode or carried that the profile
   * lacks becomes unlocked. Returns what's new (for the wreck-screen banner).
   */
  const unlockFrom = useCallback((build: Build): UnlockGains => {
    // Computed against the current profile (event-handler context), not
    // inside the state updater — StrictMode double-invokes updaters.
    const gains: UnlockGains = { chassis: [], parts: [] };
    const chassisSet = new Set(profile.unlockedChassis);
    const partSet = new Set(profile.unlockedParts);
    if (!chassisSet.has(build.chassisId)) {
      chassisSet.add(build.chassisId);
      gains.chassis.push(CHASSIS[build.chassisId]?.name ?? build.chassisId);
    }
    for (const p of build.parts) {
      if (!partSet.has(p.partId)) {
        partSet.add(p.partId);
        gains.parts.push(getPart(p.partId).name);
      }
    }
    if (gains.chassis.length > 0 || gains.parts.length > 0) {
      const next = { unlockedChassis: [...chassisSet], unlockedParts: [...partSet] };
      setProfile(next);
      try { localStorage.setItem(PROFILE_KEY, JSON.stringify(next)); } catch { /* non-fatal */ }
    }
    return gains;
  }, [profile]);

  /** Append a finished run to the memorial (newest first, capped). */
  const pushHistory = useCallback((record: RunRecord): void => {
    setHistory((prev) => {
      const next = [record, ...prev].slice(0, HISTORY_MAX);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* non-fatal */ }
      return next;
    });
  }, []);

  /** Part ids locked for starting loadouts (everything else in the catalog). */
  const lockedPartIds = new Set(Object.keys(PARTS).filter((id) => !profile.unlockedParts.includes(id)));

  return { profile, lockedPartIds, unlockFrom, history, pushHistory };
}
