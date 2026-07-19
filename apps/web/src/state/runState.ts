/**
 * Track A M1 (docs/10): the run shell. A run is web-side state — the sim
 * stays pure and battle-scoped (rule R6). One serializable object, persisted
 * to localStorage so a run survives a reload; that same shape is the future
 * save-file format. Economy numbers are config dials (docs/04 §8) — tuning
 * deferred by design.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pcg32, TEMPLATES, type Build } from '@mechbattler/sim';
import { OPPONENTS, type OpponentDef } from '../lib/opponents.js';

export const RUN_LENGTH = 12;
export const STARTING_SCRAP = 30;
const STORAGE_KEY = 'mechbattler-run';

/** Starter kits (docs/04 §6) drawn from the sim's template roster. */
export const STARTER_KITS = [
  { templateId: 'vulture-skirmisher', name: 'Vulture Skirmisher', blurb: 'Fast, cool, shallow — twin MGs on a scout frame.' },
  { templateId: 'mule-gunline', name: 'Mule Gunline', blurb: 'The tutorial-shaped build: one autocannon, one firing line.' },
  { templateId: 'mule-laser-boat', name: 'Mule Tinkerer', blurb: 'Hybrid reactors and a heat-pipe highway — a heat puzzle from fight 1.' },
] as const;

export function kitBuild(templateId: string): Build {
  const t = TEMPLATES.find((x) => x.id === templateId);
  if (!t) throw new Error(`Unknown starter kit template: ${templateId}`);
  return t.build;
}

export interface RunData {
  seed: number;
  /** 1-based; winning node RUN_LENGTH completes the run. */
  nodeIndex: number;
  scrap: number;
  fightsWon: number;
  kitName: string;
}

export type RunPhase =
  | { phase: 'none' }
  | { phase: 'active'; data: RunData }
  | { phase: 'over'; data: RunData; cause: string; victorious: boolean };

/**
 * Scouted opponents for a node (docs/04 §5). M1 placeholder: a seeded pick of
 * 2–3 from the canned roster — the budget-driven ladder is M4.
 */
export function nodeOpponents(seed: number, nodeIndex: number): OpponentDef[] {
  const rng = new Pcg32(seed * 31 + nodeIndex);
  const pool = [...OPPONENTS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng.nextFloat() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, 2 + (rng.nextFloat() < 0.5 ? 1 : 0));
}

interface StoredRun {
  data: RunData;
  build: Build;
}

function load(): StoredRun | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredRun) : null;
  } catch {
    return null;
  }
}

export function useRun() {
  const [run, setRun] = useState<RunPhase>({ phase: 'none' });

  const start = useCallback((kitName: string): void => {
    setRun({
      phase: 'active',
      data: {
        seed: Math.floor(Math.random() * 0x7fffffff),
        nodeIndex: 1,
        scrap: STARTING_SCRAP,
        fightsWon: 0,
        kitName,
      },
    });
  }, []);

  const won = useCallback((): void => {
    setRun((r) => {
      if (r.phase !== 'active') return r;
      const data = { ...r.data, fightsWon: r.data.fightsWon + 1 };
      if (data.nodeIndex >= RUN_LENGTH) {
        return { phase: 'over', data, cause: 'Completed the ladder', victorious: true };
      }
      return { phase: 'active', data: { ...data, nodeIndex: data.nodeIndex + 1 } };
    });
  }, []);

  const lost = useCallback((cause: string): void => {
    setRun((r) => (r.phase === 'active' ? { phase: 'over', data: r.data, cause, victorious: false } : r));
  }, []);

  const abandon = useCallback((): void => {
    setRun({ phase: 'none' });
  }, []);

  // Persistence: an active run (with its build, supplied by the caller via
  // persistBuild) survives reload; anything else clears the slot.
  const persistBuild = useCallback((build: Build): void => {
    setRun((r) => {
      if (r.phase === 'active') {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ data: r.data, build } satisfies StoredRun));
        } catch { /* storage full/blocked: the run just won't survive reload */ }
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
      return r;
    });
  }, []);

  // One-shot restore on mount; the restored build is handed to the caller.
  const [restored, setRestored] = useState<Build | null>(null);
  useEffect(() => {
    const stored = load();
    if (stored) {
      setRun({ phase: 'active', data: stored.data });
      setRestored(stored.build);
    }
  }, []);

  return { run, start, won, lost, abandon, persistBuild, restored, clearRestored: () => setRestored(null) };
}
