import { getPart, type BattleReport, type Build } from '@mechbattler/sim';
import type {
  BattleChallengeSummary,
  ChallengeDefinition,
  ChallengePredicate,
  PlayerProfile,
} from './types.js';

export function summarizeBattleForChallenges(
  report: BattleReport,
  enemyBuild: Build,
): BattleChallengeSummary {
  const playerPeakTempC = report.frames.reduce(
    (peak, frame) => Math.max(peak, frame.mechs[0].hottestCellC),
    25,
  );
  const enemyPartsDestroyed = report.mechs[1].partsLost.filter((part) => {
    const def = getPart(part.partId);
    return !def.isConduit && !def.isHeatPipe;
  }).length;
  const enemyHasCapacitor = enemyBuild.parts.some((part) => getPart(part.partId).category === 'capacitor');
  const enemyCapacitorDestroyed = report.mechs[1].partsLost.some(
    (part) => getPart(part.partId).category === 'capacitor',
  );
  return {
    won: report.winner === 0,
    durationS: report.durationS,
    playerPartsLost: report.mechs[0].partsLost.length,
    enemyPartsDestroyed,
    playerPeakTempC,
    playerShedCount: report.events.filter((event) => event.type === 'shed' && event.mech === 0).length,
    playerDamage: report.mechs[0].damageDealt,
    enemyHasCapacitor,
    enemyCapacitorDestroyed,
  };
}

function matches(predicate: ChallengePredicate, summary: BattleChallengeSummary): boolean {
  switch (predicate.kind) {
    case 'battle-won': return summary.won;
    case 'max-player-parts-lost': return summary.playerPartsLost <= predicate.value;
    case 'duration-at-most': return summary.durationS <= predicate.seconds;
    case 'min-enemy-parts-destroyed': return summary.enemyPartsDestroyed >= predicate.value;
    case 'player-peak-temp-at-least': return summary.playerPeakTempC >= predicate.celsius;
    case 'min-player-sheds': return summary.playerShedCount >= predicate.value;
    case 'min-player-damage': return summary.playerDamage >= predicate.value;
    case 'enemy-has-capacitor': return summary.enemyHasCapacitor;
    case 'enemy-capacitor-destroyed': return summary.enemyCapacitorDestroyed;
  }
}

export function challengeCompleted(
  challenge: ChallengeDefinition,
  summary: BattleChallengeSummary,
): boolean {
  if ('all' in challenge.criterion) return challenge.criterion.all.every((predicate) => matches(predicate, summary));
  return challenge.criterion.any.some((predicate) => matches(predicate, summary));
}

export interface ChallengeGains {
  challengeIds: string[];
  partIds: string[];
}

export function applyChallengeProgress(
  profile: PlayerProfile,
  challenges: ChallengeDefinition[],
  summary: BattleChallengeSummary,
): { profile: PlayerProfile; gains: ChallengeGains } {
  const completed = new Set(profile.completedChallengeIds);
  const unlocked = new Set(profile.unlockedPartIds);
  const gains: ChallengeGains = { challengeIds: [], partIds: [] };
  for (const challenge of challenges) {
    if (completed.has(challenge.id) || !challengeCompleted(challenge, summary)) continue;
    completed.add(challenge.id);
    gains.challengeIds.push(challenge.id);
    for (const partId of challenge.unlockPartIds) {
      if (unlocked.has(partId)) continue;
      unlocked.add(partId);
      gains.partIds.push(partId);
    }
  }
  return {
    profile: {
      ...profile,
      completedChallengeIds: [...completed],
      unlockedPartIds: [...unlocked],
    },
    gains,
  };
}
