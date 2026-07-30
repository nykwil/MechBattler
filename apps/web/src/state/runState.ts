/**
 * Track A M1 (docs/10): the run shell. A run is web-side state — the sim
 * stays pure and battle-scoped (rule R6). One serializable object, persisted
 * to localStorage so a run survives a reload; that same shape is the future
 * save-file format. Economy numbers are config dials (docs/04 §8) — tuning
 * deferred by design.
 */
import { useCallback, useEffect, useState } from 'react';
import { getPart, type Build } from '@mechbattler/sim';
import {
  GAME_CONTENT,
  GAME_SAVE_VERSION,
  buildToMech,
  mechToBuild,
  migrateRun,
  modOffers,
  generateRunNodes,
  repairCost as domainRepairCost,
  type GeneratedRunNode,
  type PartProvenance,
  type PendingSalvage,
  type RunInstance,
} from '@mechbattler/game';

export const RUN_LENGTH = GAME_CONTENT.run.length;
export const STARTING_SCRAP = GAME_CONTENT.economy.startingScrap;
const STORAGE_KEY = 'mechbattler-run-v2';
const LEGACY_STORAGE_KEY = 'mechbattler-run';

// --- Economy dials (docs/04 §1-§2, §8 — tuning deferred by design) ----------
export const PURSE_BASE = GAME_CONTENT.economy.purseBase;
export const PURSE_PER_NODE = GAME_CONTENT.economy.pursePerNode;
/** Destroyed (and left-behind) enemy parts auto-scrap at tier × this. */
export const SCRAP_WRECK_MULT = GAME_CONTENT.economy.destroyedScrapMultiplier;
export const SCRAP_INTACT_MULT = GAME_CONTENT.economy.intactScrapMultiplier;
/** Selling a part you own pays tier × this. */
export const SCRAP_SELL_MULT = GAME_CONTENT.economy.ownedScrapMultiplier;
/**
 * During a run, placing a fresh catalog part costs tier × this (> sell, so the
 * palette can't mint scrap). Placeholder shop until M4's scrapyard nodes —
 * wrecks are meant to be the real parts source (docs/04 §1).
 */
export const SCRAP_BUY_MULT = GAME_CONTENT.economy.scrapyardBuyMultiplier;

/**
 * What a bench part fetches: docs/04 §1's tier x 8 is the *pristine* price, so it
 * scales with integrity. Without that, junk bought cheap from the yard at an
 * integrity discount could be sold at full price, and the round trip would mint
 * scrap rather than cost it.
 *
 * It lived inline in RunPanel while the yard's buy price lives in
 * packages/game/nodes.ts, so the two halves of the same trade could not be
 * compared in one place, and the invariant they exist to preserve was never
 * checked against the real generator.
 */
export function benchSellValue(tier: number, integrity: number): number {
  return Math.max(1, Math.round(tier * SCRAP_SELL_MULT * integrity));
}
/** Loot integrity loses a further uniform 0..this on extraction. */
export const EXTRACTION_WEAR_MAX = GAME_CONTENT.economy.extractionWearMax;
export const BENCH_CAP = GAME_CONTENT.run.benchCap;
/** Repair costs this × tier per integrity point (1% = one point, docs/04 §3). */
export const REPAIR_COST_PER_POINT = GAME_CONTENT.economy.repairCostPerPoint;

/** Scrap cost to repair a part from one integrity to another (docs/04 §3). */
export function repairCost(tier: number, fromIntegrity: number, toIntegrity: number): number {
  return domainRepairCost(tier, fromIntegrity, toIntegrity);
}

/** An unplaced salvaged part riding in the bench pool (docs/04 §2). */
export interface BenchPart {
  /** Stable identity survives bench ↔ grid moves and reloads. */
  id: string;
  partId: string;
  /** 0-1; scales HP when placed (04 §3). */
  integrity: number;
  /** Modifiers (quirks/mods, 04 §4-§4b) riding the part. */
  modifiers?: string[];
  /** Variant stat rolls (04 §4). */
  variant?: Partial<Record<'damage' | 'cycleS' | 'dispersionMrad' | 'hp', number>>;
  provenance?: PartProvenance;
}

/** Scrap cost to have the machinist apply a mod at a scrapyard (docs/04 §4b). */
export const MACHINIST_MOD_COST = GAME_CONTENT.economy.machinistBaseCost;
/** Tier budget for a custom-frame starting loadout (docs/04 §7; wiring free). */
export const START_BUDGET = GAME_CONTENT.run.startingTierBudget;

export interface RunData {
  seed: number;
  /** 1-based; winning node RUN_LENGTH completes the run. */
  nodeIndex: number;
  scrap: number;
  fightsWon: number;
  kitName: string;
  generatedNodes: GeneratedRunNode[];
  benchPool: BenchPart[];
  battlesCompleted: number;
  earnedChassisIds: string[];
  earnedPartIds: string[];
  earnedChallengeIds: string[];
  partProvenance: Record<string, PartProvenance>;
  /** Seeded service earned every configured number of victories. */
  pendingModService?: { afterWin: number; offerIds: string[]; applied: boolean };
  /** Unresolved wreck transaction; persisted before the salvage overlay opens. */
  pendingSalvage?: PendingSalvage;
  /** This node's scrapyard reroll is spent (docs/10 M4; cleared on advance). */
  yardRerolled?: boolean;
  /** This node's machinist application is spent (docs/04 §4b; cleared on advance). */
  yardModApplied?: boolean;
}

export type RunPhase =
  | { phase: 'none' }
  /** Custom-frame outfitting (docs/04 §7): build from unlocked starting parts, then launch. */
  | { phase: 'prep'; data: RunData }
  | { phase: 'active'; data: RunData }
  | { phase: 'over'; data: RunData; cause: string; victorious: boolean };

interface StoredRun {
  data: RunData;
  build: Build;
  /** True while still outfitting a custom frame (docs/04 §7). */
  prep?: boolean;
  over?: { cause: string; victorious: boolean };
}

function load(): StoredRun | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const migrated = migrateRun(JSON.parse(raw));
    if (!migrated) return null;
    return {
      data: {
        seed: migrated.seed,
        nodeIndex: migrated.nodeIndex,
        scrap: migrated.scrap,
        fightsWon: migrated.fightsWon,
        battlesCompleted: migrated.battlesCompleted,
        kitName: migrated.kitName,
        earnedChassisIds: migrated.earnedChassisIds,
        earnedPartIds: migrated.earnedPartIds,
        earnedChallengeIds: migrated.earnedChallengeIds,
        partProvenance: Object.fromEntries(
          [...migrated.mech.parts, ...migrated.bench].map((part) => [part.id, part.provenance]),
        ),
        generatedNodes: migrated.generatedNodes,
        benchPool: migrated.bench.map((part) => ({
          id: part.id,
          partId: part.partId,
          integrity: part.integrity,
          modifiers: part.modifiers,
          variant: part.variant,
          provenance: part.provenance,
        })),
        yardRerolled: migrated.yardRerolled,
        pendingModService: migrated.pendingModService,
        pendingSalvage: migrated.pendingSalvage,
      },
      build: mechToBuild(migrated.mech),
      prep: migrated.status === 'prep',
      over: migrated.status === 'over'
        ? { cause: migrated.cause ?? 'Run ended', victorious: migrated.victorious ?? false }
        : undefined,
    };
  } catch {
    return null;
  }
}

export function useRun() {
  const [run, setRun] = useState<RunPhase>({ phase: 'none' });

  const freshData = (kitName: string): RunData => {
    const seed = Math.floor(Math.random() * 0x7fffffff);
    return {
      seed,
      nodeIndex: 1,
      scrap: STARTING_SCRAP,
      fightsWon: 0,
      kitName,
      generatedNodes: generateRunNodes(seed),
      benchPool: [],
      battlesCompleted: 0,
      earnedChassisIds: [],
      earnedPartIds: [],
      earnedChallengeIds: [],
      partProvenance: {},
    };
  };

  const start = useCallback((kitName: string): void => {
    setRun({ phase: 'active', data: freshData(kitName) });
  }, []);

  /** Start a custom-frame run: outfit within START_BUDGET, then launch. */
  const startCustom = useCallback((name: string): void => {
    setRun({ phase: 'prep', data: freshData(name) });
  }, []);

  const renamePrep = useCallback((name: string): void => {
    setRun((r) => r.phase === 'prep'
      ? { ...r, data: { ...r.data, kitName: name.trim().slice(0, 40) || r.data.kitName } }
      : r);
  }, []);

  const launch = useCallback((): void => {
    setRun((r) => (r.phase === 'prep' ? { phase: 'active', data: r.data } : r));
  }, []);

  /** Settle a won node: bank purse + wreck scrap, pocket the loot, advance. */
  const won = useCallback((
    scrapGained = 0,
    loot: BenchPart[] = [],
    installedLoot: BenchPart[] = [],
  ): void => {
    setRun((r) => {
      if (r.phase !== 'active') return r;
      const data = {
        ...r.data,
        fightsWon: r.data.fightsWon + 1,
        scrap: r.data.scrap + scrapGained,
        benchPool: [...r.data.benchPool, ...loot].slice(0, BENCH_CAP),
        partProvenance: {
          ...r.data.partProvenance,
          ...Object.fromEntries([...loot, ...installedLoot].map((part) => [
            part.id,
            part.provenance ?? { source: 'salvage' as const, nodeIndex: r.data.nodeIndex },
          ])),
        },
        pendingSalvage: undefined,
      };
      const serviceDue = data.fightsWon < RUN_LENGTH
        && data.fightsWon % GAME_CONTENT.run.modServiceEveryWins === 0;
      if (serviceDue) {
        data.pendingModService = {
          afterWin: data.fightsWon,
          offerIds: modOffers(data.seed, data.fightsWon),
          applied: false,
        };
      }
      if (data.nodeIndex >= RUN_LENGTH) {
        return { phase: 'over', data, cause: 'Completed the ladder', victorious: true };
      }
      return { phase: 'active', data: { ...data, nodeIndex: data.nodeIndex + 1, yardRerolled: false, yardModApplied: false } };
    });
  }, []);

  /** Leave a no-fight node (scrapyard): advance without a win or a purse. */
  const skipNode = useCallback((): void => {
    setRun((r) => {
      if (r.phase !== 'active') return r;
      if (r.data.nodeIndex >= RUN_LENGTH) {
        return { phase: 'over', data: r.data, cause: 'Completed the ladder', victorious: true };
      }
      return { phase: 'active', data: { ...r.data, nodeIndex: r.data.nodeIndex + 1, yardRerolled: false, yardModApplied: false } };
    });
  }, []);

  /** Spend this node's one scrapyard reroll (docs/04 §5). */
  const rerollYard = useCallback((): void => {
    setRun((r) => (r.phase === 'active' ? { phase: 'active', data: { ...r.data, yardRerolled: true } } : r));
  }, []);

  /** Spend this node's one machinist application (docs/04 §4b). */
  const markYardMod = useCallback((): void => {
    setRun((r) => (r.phase === 'active' ? { phase: 'active', data: { ...r.data, yardModApplied: true } } : r));
  }, []);

  const markMilestoneMod = useCallback((): void => {
    setRun((r) => (r.phase === 'active' && r.data.pendingModService
      ? {
        phase: 'active',
        data: {
          ...r.data,
          pendingModService: { ...r.data.pendingModService, applied: true },
        },
      }
      : r));
  }, []);

  const clearModService = useCallback((): void => {
    setRun((r) => (r.phase === 'active'
      ? { phase: 'active', data: { ...r.data, pendingModService: undefined } }
      : r));
  }, []);

  /** Sell a bench-pool part for tier × SCRAP_SELL_MULT (docs/04 §1). */
  const sellBench = useCallback((index: number, value: number): void => {
    setRun((r) => {
      if (r.phase !== 'active') return r;
      const benchPool = r.data.benchPool.filter((_, i) => i !== index);
      const partProvenance = { ...r.data.partProvenance };
      const sold = r.data.benchPool[index];
      if (sold) delete partProvenance[sold.id];
      return {
        phase: 'active',
        data: { ...r.data, benchPool, partProvenance, scrap: r.data.scrap + value },
      };
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
      ? {
        phase: 'active',
        data: {
          ...r.data,
          benchPool: [...r.data.benchPool, part],
          partProvenance: {
            ...r.data.partProvenance,
            [part.id]: part.provenance ?? r.data.partProvenance[part.id] ?? { source: 'legacy' },
          },
        },
      }
      : r));
  }, []);

  /** Remove a bench part without payment (it was placed into the build). */
  const takeBench = useCallback((index: number): void => {
    setRun((r) => (r.phase === 'active'
      ? { phase: 'active', data: { ...r.data, benchPool: r.data.benchPool.filter((_, i) => i !== index) } }
      : r));
  }, []);

  const applyBenchModifier = useCallback((index: number, modifierId: string): void => {
    setRun((r) => {
      if (r.phase !== 'active') return r;
      const benchPool = r.data.benchPool.map((part, partIndex) => partIndex === index
        ? { ...part, modifiers: [...(part.modifiers ?? []), modifierId] }
        : part);
      return { phase: 'active', data: { ...r.data, benchPool } };
    });
  }, []);

  /** Repair a benched instance between encounters using the same rate as installed parts. */
  const repairBench = useCallback((index: number, toIntegrity = 1): void => {
    setRun((r) => {
      if (r.phase !== 'active') return r;
      const part = r.data.benchPool[index];
      if (!part) return r;
      const integrity = Math.max(part.integrity, Math.min(1, toIntegrity));
      const cost = domainRepairCost(getPart(part.partId).tier, part.integrity, integrity);
      if (cost <= 0 || cost > r.data.scrap) return r;
      const benchPool = r.data.benchPool.map((candidate, partIndex) =>
        partIndex === index ? { ...candidate, integrity } : candidate);
      return {
        phase: 'active',
        data: { ...r.data, benchPool, scrap: r.data.scrap - cost },
      };
    });
  }, []);

  const lost = useCallback((cause: string): void => {
    setRun((r) => (r.phase === 'active' ? { phase: 'over', data: r.data, cause, victorious: false } : r));
  }, []);

  const beginSalvage = useCallback((pendingSalvage: PendingSalvage): void => {
    setRun((r) => (r.phase === 'active'
      ? {
        phase: 'active',
        data: {
          ...r.data,
          pendingSalvage,
          earnedChassisIds: [
            ...new Set([...r.data.earnedChassisIds, ...(pendingSalvage.unlockIds?.chassis ?? [])]),
          ],
          earnedPartIds: [
            ...new Set([...r.data.earnedPartIds, ...(pendingSalvage.unlockIds?.parts ?? [])]),
          ],
          earnedChallengeIds: [
            ...new Set([...r.data.earnedChallengeIds, ...(pendingSalvage.unlockIds?.challenges ?? [])]),
          ],
        },
      }
      : r));
  }, []);

  const recordBattle = useCallback((): void => {
    setRun((r) => (r.phase === 'active'
      ? { phase: 'active', data: { ...r.data, battlesCompleted: r.data.battlesCompleted + 1 } }
      : r));
  }, []);

  const abandon = useCallback((): void => {
    setRun({ phase: 'none' });
  }, []);

  // Persistence: the versioned domain shape is the save-file contract. The
  // hook keeps its compatibility facade while the stored object is a proper
  // RunInstance that can be consumed headlessly.
  const persistBuild = useCallback((build: Build): void => {
    setRun((r) => {
      if (r.phase !== 'none') {
        try {
          const mech = buildToMech(build);
          mech.parts = mech.parts.map((part) => ({
            ...part,
            provenance: r.data.partProvenance[part.id] ?? part.provenance,
          }));
          const stored: RunInstance = {
            schemaVersion: GAME_SAVE_VERSION,
            id: `run-${r.data.seed.toString(16)}`,
            seed: r.data.seed,
            status: r.phase === 'prep' ? 'prep' : r.phase === 'over' ? 'over' : 'active',
            nodeIndex: r.data.nodeIndex,
            scrap: r.data.scrap,
            fightsWon: r.data.fightsWon,
            battlesCompleted: r.data.battlesCompleted,
            kitName: r.data.kitName,
            earnedChassisIds: r.data.earnedChassisIds,
            earnedPartIds: r.data.earnedPartIds,
            earnedChallengeIds: r.data.earnedChallengeIds,
            generatedNodes: r.data.generatedNodes,
            mech,
            bench: r.data.benchPool.map((part) => ({
              id: part.id,
              partId: part.partId,
              integrity: part.integrity,
              modifiers: part.modifiers,
              variant: part.variant,
              provenance: part.provenance ?? r.data.partProvenance[part.id] ?? { source: 'legacy' },
            })),
            pendingSalvage: r.data.pendingSalvage,
            pendingModService: r.data.pendingModService,
            yardRerolled: r.data.yardRerolled,
            cause: r.phase === 'over' ? r.cause : undefined,
            victorious: r.phase === 'over' ? r.victorious : undefined,
            events: [],
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
          localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch { /* storage full/blocked: the run just won't survive reload */ }
      } else {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
      return r;
    });
  }, []);

  // One-shot restore on mount; the restored build is handed to the caller.
  const [restored, setRestored] = useState<Build | null>(null);
  useEffect(() => {
    const stored = load();
    if (stored) {
      setRun(stored.over
        ? { phase: 'over', data: stored.data, cause: stored.over.cause, victorious: stored.over.victorious }
        : { phase: stored.prep ? 'prep' : 'active', data: stored.data });
      setRestored(stored.build);
    }
  }, []);

  return {
    run, start, startCustom, renamePrep, launch, won, lost, recordBattle, beginSalvage, abandon, sellBench, addScrap, addBench, takeBench, applyBenchModifier, repairBench,
    skipNode, rerollYard, markYardMod, markMilestoneMod, clearModService,
    persistBuild, restored, clearRestored: () => setRestored(null),
  };
}
