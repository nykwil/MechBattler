import { describe, expect, it } from 'vitest';
import { runBattle, type BattleReport } from '@mechbattler/sim';
import { settleRunFight, type BattleUnlocks } from './settleRunFight.js';
import { OPPONENTS } from './opponents.js';
import type { RunPhase } from '../state/runState.js';

const opponent = OPPONENTS[0]!;
const unlocks: BattleUnlocks = {
  chassis: [], parts: [], challenges: [], chassisIds: [], partIds: [], challengeIds: [],
};

/** A real report, then its winner overridden — the branch under test is the settling. */
function reportWith(over: Partial<BattleReport>): BattleReport {
  const base = runBattle({
    builds: [opponent.build, opponent.build], seed: 20260730,
    spawnDistanceM: opponent.spawnDistanceM,
  });
  return { ...base, ...over };
}

function activeRun(over: Partial<{ nodeIndex: number; fightsWon: number; seed: number }> = {}): RunPhase {
  return {
    phase: 'active',
    data: {
      seed: 1234, nodeIndex: over.nodeIndex ?? 1, fightsWon: over.fightsWon ?? 0,
      kitName: 'Test', scrap: 30, benchPool: [], earnedPartIds: [], earnedChassisIds: [],
      earnedChallengeIds: [], partProvenance: {}, generatedNodes: [],
    },
  } as unknown as RunPhase;
}

describe('settleRunFight', () => {
  it('opens salvage on a win, which is otherwise a one-in-eight event to reach', () => {
    const outcome = settleRunFight({ report: reportWith({ winner: 0 }), opponent, run: activeRun(), unlocks });

    expect(outcome.kind).toBe('salvage');
    if (outcome.kind !== 'salvage') return;
    expect(outcome.pending.opponentName).toBe(opponent.name);
    expect(outcome.pending.opponentChassisId).toBe(opponent.build.chassisId);
    expect(outcome.pending.candidates.length).toBeGreaterThan(0);
    expect(outcome.pending.purse).toBeGreaterThan(0);
  });

  it('guarantees a modifier on the first win of a run', () => {
    const modded = (o: ReturnType<typeof settleRunFight>) =>
      o.kind === 'salvage' && o.pending.candidates.some((c) => (c.modifiers?.length ?? 0) > 0);

    // Across several node positions, so this is the guarantee rather than one seed.
    for (const nodeIndex of [1, 2, 5, 9]) {
      const first = settleRunFight({
        report: reportWith({ winner: 0 }), opponent, run: activeRun({ nodeIndex, fightsWon: 0 }), unlocks,
      });
      expect(modded(first), `node ${nodeIndex}`).toBe(true);
    }

    // Deliberately no assertion that later wins lack one: guaranteeMod false means
    // "not guaranteed", not "absent" — modifiers still roll normally, and asserting
    // their absence fails whenever the roll succeeds.
  });

  it('scales the purse with depth and with elites', () => {
    const shallow = settleRunFight({ report: reportWith({ winner: 0 }), opponent, run: activeRun({ nodeIndex: 1 }), unlocks });
    const deep = settleRunFight({ report: reportWith({ winner: 0 }), opponent, run: activeRun({ nodeIndex: 6 }), unlocks });
    const elite = settleRunFight({
      report: reportWith({ winner: 0 }), opponent: { ...opponent, elite: true }, run: activeRun({ nodeIndex: 1 }), unlocks,
    });

    const purse = (o: typeof shallow) => (o.kind === 'salvage' ? o.pending.purse : 0);
    expect(purse(deep)).toBeGreaterThan(purse(shallow));
    expect(purse(elite)).toBeGreaterThan(purse(shallow));
  });

  it('ends the run on chassis failure', () => {
    const outcome = settleRunFight({
      report: reportWith({ winner: 1, reason: 'chassis-failure' }), opponent, run: activeRun(), unlocks,
    });
    expect(outcome).toEqual({ kind: 'lost', cause: `Defeated by ${opponent.name}: chassis-failure` });
  });

  it('ends the run on a mission-kill or judged loss', () => {
    for (const reason of ['mission-kill', 'judges'] as const) {
      const outcome = settleRunFight({ report: reportWith({ winner: 1, reason }), opponent, run: activeRun(), unlocks });
      expect(outcome.kind, reason).toBe('lost');
    }
  });

  it('does not salvage a win outside an active run', () => {
    const outcome = settleRunFight({
      report: reportWith({ winner: 0 }), opponent, run: { phase: 'none' }, unlocks,
    });
    // Free-play wins settle nothing: there is no node to advance.
    expect(outcome.kind).toBe('ignored');
  });
});
