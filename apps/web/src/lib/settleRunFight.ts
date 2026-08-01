import { createSalvageCandidates, type PendingSalvage } from '@mechbattler/game';
import type { BattleReport } from '@mechbattler/sim';
import type { RunPhase } from '../state/runState.js';
import type { OpponentDef } from './opponents.js';
import { PURSE_BASE, PURSE_PER_NODE } from '../state/runState.js';
import { ELITE_PURSE_MULT } from './ladder.js';

/** Unlocks registered for beating this mech (docs/04 §7). */
export interface BattleUnlocks {
  chassis: string[];
  parts: string[];
  challenges: string[];
  chassisIds: string[];
  partIds: string[];
  challengeIds: string[];
}

/**
 * What closing a run fight's report should do. A description rather than an action,
 * so the branches can be tested without a battle, a profile or a React tree.
 */
export type RunFightOutcome =
  | { kind: 'salvage'; pending: PendingSalvage }
  | { kind: 'lost'; cause: string }
  | { kind: 'ignored' };

/**
 * Settles a closed run fight. Salvage settles a win before the ladder advances;
 * every defeat ends the roguelike run.
 *
 * Pure: it reads the report and run state and returns what should happen. The caller
 * owns the side effects, which is what makes the victory branch reachable in a test —
 * winning one for real takes about eight attempts (docs/15 §7).
 */
export function settleRunFight({
  report, opponent, run, unlocks,
}: {
  report: BattleReport;
  opponent: OpponentDef;
  run: RunPhase;
  unlocks: BattleUnlocks;
}): RunFightOutcome {
  if (report.winner === 0 && run.phase === 'active') {
    const purse = Math.round(
      (PURSE_BASE + PURSE_PER_NODE * run.data.nodeIndex)
      * (opponent.elite ? ELITE_PURSE_MULT : 1),
    );
    return {
      kind: 'salvage',
      pending: {
        opponentName: opponent.name,
        opponentChassisId: opponent.build.chassisId,
        opponentPowerPriority: [...opponent.build.powerPriority],
        purse,
        candidates: createSalvageCandidates({
          run: { seed: run.data.seed, nodeIndex: run.data.nodeIndex },
          report,
          enemyBuild: opponent.build,
          opponentName: opponent.name,
          purse,
          // The first win is guaranteed a modifier, so the mechanic is met early.
          guaranteeMod: run.data.fightsWon === 0,
        }),
        unlocks: {
          chassis: unlocks.chassis,
          parts: unlocks.parts,
          challenges: unlocks.challenges,
        },
        unlockIds: {
          chassis: unlocks.chassisIds,
          parts: unlocks.partIds,
          challenges: unlocks.challengeIds,
        },
      },
    };
  }

  if (report.winner !== 0) {
    return { kind: 'lost', cause: `Defeated by ${opponent.name}: ${report.reason}` };
  }

  return { kind: 'ignored' };
}
