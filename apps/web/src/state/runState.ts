/**
 * Track A M1 (docs/10): the run shell. A run is web-side state — the sim
 * stays pure and battle-scoped (rule R6). One serializable object, persisted
 * to localStorage so a run survives a reload; that same shape is the future
 * save-file format. Economy numbers are config dials (docs/04 §8) — tuning
 * deferred by design.
 */
import { useCallback, useEffect, useState } from 'react';
import { TEMPLATES, type Build } from '@mechbattler/sim';

export const RUN_LENGTH = 12;
export const STARTING_SCRAP = 30;
const STORAGE_KEY = 'mechbattler-run';

// --- Economy dials (docs/04 §1-§2, §8 — tuning deferred by design) ----------
export const PURSE_BASE = 20;
export const PURSE_PER_NODE = 5;
/** Destroyed (and left-behind) enemy parts auto-scrap at tier × this. */
export const SCRAP_WRECK_MULT = 4;
/** Selling a part you own pays tier × this. */
export const SCRAP_SELL_MULT = 8;
/**
 * During a run, placing a fresh catalog part costs tier × this (> sell, so the
 * palette can't mint scrap). Placeholder shop until M4's scrapyard nodes —
 * wrecks are meant to be the real parts source (docs/04 §1).
 */
export const SCRAP_BUY_MULT = 12;
/** Loot integrity loses a further uniform 0..this on extraction. */
export const EXTRACTION_WEAR_MAX = 0.2;
export const BENCH_CAP = 8;
/** Repair costs this × tier per integrity point (1% = one point, docs/04 §3). */
export const REPAIR_COST_PER_POINT = 0.4;

/** Scrap cost to repair a part from one integrity to another (docs/04 §3). */
export function repairCost(tier: number, fromIntegrity: number, toIntegrity: number): number {
  const points = Math.max(0, toIntegrity - fromIntegrity) * 100;
  return Math.ceil(points * REPAIR_COST_PER_POINT * tier);
}

/** An unplaced salvaged part riding in the bench pool (docs/04 §2). */
export interface BenchPart {
  partId: string;
  /** 0-1; scales HP when placed (04 §3). */
  integrity: number;
}

/** Starter kits (docs/04 §6) drawn from the sim's template roster. */
export const STARTER_KITS = [
  { templateId: 'vulture-skirmisher', name: 'Vulture Skirmisher', blurb: 'Fast, cool, shallow — twin MGs on a scout frame.' },
  { templateId: 'mule-gunline', name: 'Mule Gunline', blurb: 'The tutorial-shaped build: one autocannon, one firing line.' },
  { templateId: 'mule-laser-boat', name: 'Mule Tinkerer', blurb: 'Hybrid reactors and a heat-pipe highway — a heat puzzle from fight 1.' },
] as const;

export function kitBuild(templateId: string): Build {
  const t = TEMPLATES.find((x) => x.id === templateId);
  if (!t) throw new Error(`Unknown starter kit template: ${templateId}`);
  // Deep copy: the run's build gets edited (and M3's repair mutates part
  // integrity) — the shared template roster must never see any of it.
  return structuredClone(t.build);
}

export interface RunData {
  seed: number;
  /** 1-based; winning node RUN_LENGTH completes the run. */
  nodeIndex: number;
  scrap: number;
  fightsWon: number;
  kitName: string;
  benchPool: BenchPart[];
  /** This node's scrapyard reroll is spent (docs/10 M4; cleared on advance). */
  yardRerolled?: boolean;
}

export type RunPhase =
  | { phase: 'none' }
  | { phase: 'active'; data: RunData }
  | { phase: 'over'; data: RunData; cause: string; victorious: boolean };

interface StoredRun {
  data: RunData;
  build: Build;
}

function load(): StoredRun | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredRun;
    stored.data.benchPool ??= []; // runs saved before M2 lack the pool
    return stored;
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
        benchPool: [],
      },
    });
  }, []);

  /** Settle a won node: bank purse + wreck scrap, pocket the loot, advance. */
  const won = useCallback((scrapGained = 0, loot: BenchPart[] = []): void => {
    setRun((r) => {
      if (r.phase !== 'active') return r;
      const data = {
        ...r.data,
        fightsWon: r.data.fightsWon + 1,
        scrap: r.data.scrap + scrapGained,
        benchPool: [...r.data.benchPool, ...loot].slice(0, BENCH_CAP),
      };
      if (data.nodeIndex >= RUN_LENGTH) {
        return { phase: 'over', data, cause: 'Completed the ladder', victorious: true };
      }
      return { phase: 'active', data: { ...data, nodeIndex: data.nodeIndex + 1, yardRerolled: false } };
    });
  }, []);

  /** Leave a no-fight node (scrapyard): advance without a win or a purse. */
  const skipNode = useCallback((): void => {
    setRun((r) => {
      if (r.phase !== 'active') return r;
      if (r.data.nodeIndex >= RUN_LENGTH) {
        return { phase: 'over', data: r.data, cause: 'Completed the ladder', victorious: true };
      }
      return { phase: 'active', data: { ...r.data, nodeIndex: r.data.nodeIndex + 1, yardRerolled: false } };
    });
  }, []);

  /** Spend this node's one scrapyard reroll (docs/04 §5). */
  const rerollYard = useCallback((): void => {
    setRun((r) => (r.phase === 'active' ? { phase: 'active', data: { ...r.data, yardRerolled: true } } : r));
  }, []);

  /** Sell a bench-pool part for tier × SCRAP_SELL_MULT (docs/04 §1). */
  const sellBench = useCallback((index: number, value: number): void => {
    setRun((r) => {
      if (r.phase !== 'active') return r;
      const benchPool = r.data.benchPool.filter((_, i) => i !== index);
      return { phase: 'active', data: { ...r.data, benchPool, scrap: r.data.scrap + value } };
    });
  }, []);

  /** Spend (negative) or gain scrap — repair bills, part sales (docs/10 M3). */
  const addScrap = useCallback((delta: number): void => {
    setRun((r) => (r.phase === 'active'
      ? { phase: 'active', data: { ...r.data, scrap: Math.max(0, r.data.scrap + delta) } }
      : r));
  }, []);

  /** Park an unplaced part on the bench (unplace from the build, docs/10 M3). */
  const addBench = useCallback((part: BenchPart): void => {
    setRun((r) => (r.phase === 'active' && r.data.benchPool.length < BENCH_CAP
      ? { phase: 'active', data: { ...r.data, benchPool: [...r.data.benchPool, part] } }
      : r));
  }, []);

  /** Remove a bench part without payment (it was placed into the build). */
  const takeBench = useCallback((index: number): void => {
    setRun((r) => (r.phase === 'active'
      ? { phase: 'active', data: { ...r.data, benchPool: r.data.benchPool.filter((_, i) => i !== index) } }
      : r));
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

  return {
    run, start, won, lost, abandon, sellBench, addScrap, addBench, takeBench,
    skipNode, rerollYard,
    persistBuild, restored, clearRestored: () => setRestored(null),
  };
}
