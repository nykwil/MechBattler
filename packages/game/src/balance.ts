import { TEMPLATES, getChassis } from '@mechbattler/sim';
import { GAME_CONTENT } from './content.js';
import {
  advanceRunNode,
  createRun,
  defeatRun,
  finalizeSalvage,
  recoverWreck,
  repairOwnedPart,
  skipModService,
} from './domain.js';
import {
  createMatchInstance,
  createRunCheckpoint,
  restoreRunCheckpoint,
  settleMatchInstance,
  simulateMatchInstance,
} from './matches.js';
import type { MatchInstance, RunCheckpoint, RunInstance } from './types.js';

export interface RunBalanceOptions {
  seedsPerKit?: number;
  baseSeed?: number;
  starterTemplateIds?: string[];
  checkpointDepths?: number[];
  maxRoundDepth?: number;
  sampleAllChoices?: boolean;
  recoveryPolicy?: 'never' | 'larger-affordable';
}

export interface MatchBalanceRecord {
  matchId: string;
  runId: string;
  starterTemplateId: string;
  roundDepth: number;
  attempt: number;
  opponentChoiceId: string;
  elite: boolean;
  won: boolean;
  winner: 0 | 1 | 'draw';
  reason: string;
  durationS: number;
  playerDamage: number;
  playerPartsLost: number;
}

export interface RunBalanceReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  config: {
    seedsPerKit: number;
    baseSeed: number;
    starterTemplateIds: string[];
    checkpointDepths: number[];
    maxRoundDepth: number;
    sampleAllChoices: boolean;
    recoveryPolicy: 'never' | 'larger-affordable';
    progressionPolicy: string;
  };
  totals: {
    runs: number;
    completed: number;
    chassisLosses: number;
    attemptLimitLosses: number;
    matches: number;
    playerWins: number;
    playerLosses: number;
    draws: number;
    chassisRecoveries: number;
  };
  depths: Array<{
    roundDepth: number;
    runsReached: number;
    reachRate: number;
    avgScrap: number;
    avgInstalledIntegrity: number;
    avgInstalledParts: number;
    matches: number;
    winRate: number;
    chassisLossRate: number;
    avgDurationS: number;
    avgPlayerDamage: number;
  }>;
  checkpointCatalog: Array<{
    id: string;
    runId: string;
    starterTemplateId: string;
    roundDepth: number;
    scrap: number;
    installedParts: number;
    installedIntegrity: number;
  }>;
  digest: string;
}

export interface RunBalanceHarnessResult {
  report: RunBalanceReport;
  /** Full reusable save states for deeper external automation. */
  checkpoints: RunCheckpoint[];
  /** Every sampled match remains independent from the canonical run path. */
  matches: MatchInstance[];
}

export interface CheckpointMatchBalanceReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  totals: {
    checkpoints: number;
    matches: number;
    playerWins: number;
    playerLosses: number;
    draws: number;
  };
  depths: Array<{
    roundDepth: number;
    checkpoints: number;
    matches: number;
    winRate: number;
    chassisLossRate: number;
    avgDurationS: number;
    avgPlayerDamage: number;
    avgPlayerPartsLost: number;
  }>;
  digest: string;
}

export interface CheckpointMatchHarnessResult {
  report: CheckpointMatchBalanceReport;
  matches: MatchInstance[];
}

function round(value: number, places = 4): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function digest(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Configurable deterministic policy keeps the intended path and recovery what-if comparable. */
function applyBaselineBetweenRoundPolicy(
  run: RunInstance,
  recoveryPolicy: 'never' | 'larger-affordable',
): RunInstance {
  let next = run;
  if (next.pendingSalvage && recoveryPolicy === 'larger-affordable') {
    const currentCells = getChassis(next.mech.chassisId).mask.flat().filter(Boolean).length;
    const wreckCells = getChassis(next.pendingSalvage.opponentChassisId).mask.flat().filter(Boolean).length;
    if (wreckCells > currentCells) next = recoverWreck(next);
  }
  if (next.pendingSalvage) next = finalizeSalvage(next, []);
  if (next.pendingModService) next = skipModService(next);
  if (next.status !== 'active') return next;
  for (const part of [...next.mech.parts]) {
    next = repairOwnedPart(next, part.id, 1);
  }
  return next;
}

function compactMatch(
  match: MatchInstance,
  starterTemplateId: string,
): MatchBalanceRecord {
  const report = match.report!;
  return {
    matchId: match.id,
    runId: match.runId,
    starterTemplateId,
    roundDepth: match.roundDepth,
    attempt: match.attempt,
    opponentChoiceId: match.opponentChoiceId,
    elite: match.elite,
    won: report.winner === 0,
    winner: report.winner,
    reason: report.reason,
    durationS: report.durationS,
    playerDamage: report.mechs[0].damageDealt,
    playerPartsLost: report.mechs[0].partsLost.length,
  };
}

export function runBalanceHarness(options: RunBalanceOptions = {}): RunBalanceHarnessResult {
  const seedsPerKit = Math.max(1, Math.floor(options.seedsPerKit ?? 1));
  const baseSeed = Math.floor(options.baseSeed ?? 41000);
  const starterTemplateIds = options.starterTemplateIds ?? GAME_CONTENT.starterKits.map((kit) => kit.templateId);
  const checkpointDepths = [...new Set(
    options.checkpointDepths ?? GAME_CONTENT.run.balanceCheckpointDepths,
  )].sort((a, b) => a - b);
  const maxRoundDepth = Math.max(
    1,
    Math.min(GAME_CONTENT.run.length, options.maxRoundDepth ?? GAME_CONTENT.run.length),
  );
  const sampleAllChoices = options.sampleAllChoices ?? true;
  const recoveryPolicy = options.recoveryPolicy ?? 'never';
  const checkpoints: RunCheckpoint[] = [];
  const matches: MatchInstance[] = [];
  const matchRecords: MatchBalanceRecord[] = [];
  const checkpointTemplates = new Map<string, string>();
  const errors: string[] = [];
  const warnings: string[] = [];
  let completed = 0;
  let chassisLosses = 0;
  let attemptLimitLosses = 0;
  let runCount = 0;
  let chassisRecoveries = 0;

  for (let templateIndex = 0; templateIndex < starterTemplateIds.length; templateIndex++) {
    const templateId = starterTemplateIds[templateIndex]!;
    const template = TEMPLATES.find((candidate) => candidate.id === templateId);
    if (!template) throw new Error(`Unknown balance starter template ${templateId}`);
    for (let seedOffset = 0; seedOffset < seedsPerKit; seedOffset++) {
      runCount++;
      const seed = baseSeed + templateIndex * 100003 + seedOffset * 7919;
      let run = createRun({ seed, kitName: template.name, build: template.build });
      const capturedDepths = new Set<number>();
      const attemptsByNode = new Map<number, number>();

      while (run.status === 'active' && run.nodeIndex <= maxRoundDepth) {
        if (checkpointDepths.includes(run.nodeIndex) && !capturedDepths.has(run.nodeIndex)) {
          const checkpoint = createRunCheckpoint({
            run,
            label: `${templateId}-round-${run.nodeIndex}`,
          });
          checkpoints.push(checkpoint);
          checkpointTemplates.set(checkpoint.id, templateId);
          capturedDepths.add(run.nodeIndex);
        }

        const node = run.generatedNodes.find((candidate) => candidate.index === run.nodeIndex);
        if (!node) throw new Error(`Run ${run.id} has no node ${run.nodeIndex}`);
        if (node.kind === 'scrapyard') {
          run = advanceRunNode(run);
          continue;
        }

        const opponents = node.opponents ?? [];
        if (opponents.length === 0) throw new Error(`Run ${run.id} node ${run.nodeIndex} has no opponents`);
        const attempt = (attemptsByNode.get(run.nodeIndex) ?? 0) + 1;
        attemptsByNode.set(run.nodeIndex, attempt);
        const chosenIndex = (attempt - 1) % opponents.length;
        const choices = sampleAllChoices ? opponents : [opponents[chosenIndex]!];
        const resolvedMatches = choices.map((opponent) =>
          simulateMatchInstance(createMatchInstance({
            run,
            opponentChoiceId: opponent.id,
            attempt,
          })));
        for (const match of resolvedMatches) {
          matches.push(match);
          matchRecords.push(compactMatch(match, templateId));
        }
        const chosenId = opponents[chosenIndex]!.id;
        // The progression spine is a survivability search: if any scouted
        // choice is winnable from this exact checkpoint, follow the first
        // winning branch. Every choice still remains a separate match sample.
        const canonical = resolvedMatches.find((match) => match.report?.winner === 0)
          ?? resolvedMatches.find((match) => match.opponentChoiceId === chosenId)
          ?? simulateMatchInstance(createMatchInstance({
            run,
            opponentChoiceId: chosenId,
            attempt,
          }));
        if (!matches.some((match) => match.id === canonical.id)) {
          matches.push(canonical);
          matchRecords.push(compactMatch(canonical, templateId));
        }
        const settlement = settleMatchInstance(run, canonical);
        const eventsBeforePolicy = settlement.run.events.length;
        run = applyBaselineBetweenRoundPolicy(settlement.run, recoveryPolicy);
        if (run.events.slice(eventsBeforePolicy).some((event) => event.type === 'chassis-recovery')) {
          chassisRecoveries++;
        }

        if (run.status === 'over') break;
        if (run.nodeIndex === node.index
          && attempt >= GAME_CONTENT.run.balanceMaxAttemptsPerNode) {
          attemptLimitLosses++;
          run = defeatRun(run, `Automation attempt limit at round ${run.nodeIndex}`);
        }
      }
      if (run.victorious) completed++;
      else if (run.cause?.endsWith(': chassis-failure')) chassisLosses++;
    }
  }

  const checkpointCatalog = checkpoints.map((checkpoint) => {
    const integrities = checkpoint.run.mech.parts.map((part) => part.integrity);
    return {
      id: checkpoint.id,
      runId: checkpoint.runId,
      starterTemplateId: checkpointTemplates.get(checkpoint.id) ?? 'unknown',
      roundDepth: checkpoint.roundDepth,
      scrap: checkpoint.run.scrap,
      installedParts: checkpoint.run.mech.parts.length,
      installedIntegrity: round(mean(integrities)),
    };
  });
  if (checkpointCatalog.some((checkpoint) => checkpoint.scrap < 0)) {
    errors.push('A checkpoint contains negative scrap');
  }
  if (runCount > 0 && !checkpointCatalog.some((checkpoint) => checkpoint.roundDepth === 1)) {
    errors.push('No round-1 checkpoint was captured');
  }
  if (matchRecords.length === 0) errors.push('No matches were sampled');

  const depths = checkpointDepths.map((roundDepth) => {
    const atDepth = checkpointCatalog.filter((checkpoint) => checkpoint.roundDepth === roundDepth);
    const depthMatches = matchRecords.filter((match) => match.roundDepth === roundDepth);
    return {
      roundDepth,
      runsReached: atDepth.length,
      reachRate: round(atDepth.length / Math.max(1, runCount)),
      avgScrap: round(mean(atDepth.map((checkpoint) => checkpoint.scrap))),
      avgInstalledIntegrity: round(mean(atDepth.map((checkpoint) => checkpoint.installedIntegrity))),
      avgInstalledParts: round(mean(atDepth.map((checkpoint) => checkpoint.installedParts))),
      matches: depthMatches.length,
      winRate: round(
        depthMatches.filter((match) => match.won).length / Math.max(1, depthMatches.length),
      ),
      chassisLossRate: round(
        depthMatches.filter((match) => match.winner === 1 && match.reason === 'chassis-failure').length
        / Math.max(1, depthMatches.length),
      ),
      avgDurationS: round(mean(depthMatches.map((match) => match.durationS))),
      avgPlayerDamage: round(mean(depthMatches.map((match) => match.playerDamage))),
    };
  });
  for (const depth of depths) {
    if (depth.runsReached === 0) {
      warnings.push(`No natural progression checkpoint reached round ${depth.roundDepth}`);
    }
    if (depth.matches > 0 && (
      depth.winRate < GAME_CONTENT.run.balanceTargetWinRateMin
      || depth.winRate > GAME_CONTENT.run.balanceTargetWinRateMax
    )) {
      warnings.push(`Round ${depth.roundDepth} match win rate ${depth.winRate} is outside the target band`);
    }
  }
  const totals = {
    runs: runCount,
    completed,
    chassisLosses,
    attemptLimitLosses,
    matches: matchRecords.length,
    playerWins: matchRecords.filter((match) => match.winner === 0).length,
    playerLosses: matchRecords.filter((match) => match.winner === 1).length,
    draws: matchRecords.filter((match) => match.winner === 'draw').length,
    chassisRecoveries,
  };
  const reportWithoutDigest = {
    ok: errors.length === 0,
    errors,
    warnings,
    config: {
      seedsPerKit,
      baseSeed,
      starterTemplateIds,
      checkpointDepths,
      maxRoundDepth,
      sampleAllChoices,
      recoveryPolicy,
      progressionPolicy: `first-winning-branch + ${recoveryPolicy === 'never' ? 'current-build' : 'recover-larger-when-affordable'} + scrap-all + installed-full-repair-when-affordable`,
    },
    totals,
    depths,
    checkpointCatalog,
  };
  return {
    report: { ...reportWithoutDigest, digest: digest(reportWithoutDigest) },
    checkpoints,
    matches,
  };
}

/**
 * Produce depth-isolated fixtures with the same pristine starter at each
 * configured round. These intentionally isolate the opponent difficulty
 * curve from salvage/economy effects; captured player checkpoints can be fed
 * to runCheckpointMatchHarness for representative late-run builds.
 */
export function createPristineDepthCheckpoints(options: {
  seedsPerKit?: number;
  baseSeed?: number;
  starterTemplateIds?: string[];
  checkpointDepths?: number[];
} = {}): RunCheckpoint[] {
  const seedsPerKit = Math.max(1, Math.floor(options.seedsPerKit ?? 1));
  const baseSeed = Math.floor(options.baseSeed ?? 51000);
  const starterTemplateIds = options.starterTemplateIds
    ?? GAME_CONTENT.starterKits.map((kit) => kit.templateId);
  const checkpointDepths = [...new Set(
    options.checkpointDepths ?? GAME_CONTENT.run.balanceCheckpointDepths,
  )].sort((a, b) => a - b);
  const checkpoints: RunCheckpoint[] = [];
  for (let templateIndex = 0; templateIndex < starterTemplateIds.length; templateIndex++) {
    const templateId = starterTemplateIds[templateIndex]!;
    const template = TEMPLATES.find((candidate) => candidate.id === templateId);
    if (!template) throw new Error(`Unknown balance starter template ${templateId}`);
    for (let seedOffset = 0; seedOffset < seedsPerKit; seedOffset++) {
      const seed = baseSeed + templateIndex * 100003 + seedOffset * 7919;
      const initial = createRun({ seed, kitName: template.name, build: template.build });
      for (const depth of checkpointDepths) {
        if (depth < 1 || depth > GAME_CONTENT.run.length) continue;
        const priorFightCount = initial.generatedNodes.filter(
          (node) => node.index < depth && node.kind === 'fight',
        ).length;
        const run: RunInstance = {
          ...structuredClone(initial),
          nodeIndex: depth,
          fightsWon: priorFightCount,
          battlesCompleted: priorFightCount,
        };
        checkpoints.push(createRunCheckpoint({
          run,
          label: `pristine-${templateId}-round-${depth}`,
        }));
      }
    }
  }
  return checkpoints;
}

/** Evaluate each saved state as independent matches without advancing any run. */
export function runCheckpointMatchHarness(
  fixtureCheckpoints: RunCheckpoint[],
): CheckpointMatchHarnessResult {
  const matches: MatchInstance[] = [];
  const records: Array<MatchBalanceRecord & { checkpointId: string }> = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const rawCheckpoint of fixtureCheckpoints) {
    const checkpoint = restoreRunCheckpoint(rawCheckpoint);
    let run = checkpoint.run;
    while (run.status === 'active') {
      const node = run.generatedNodes.find((candidate) => candidate.index === run.nodeIndex);
      if (!node) throw new Error(`Checkpoint ${checkpoint.id} has no node ${run.nodeIndex}`);
      if (node.kind === 'fight') break;
      run = advanceRunNode(run);
    }
    if (run.status !== 'active') continue;
    const node = run.generatedNodes.find((candidate) => candidate.index === run.nodeIndex)!;
    for (const opponent of node.opponents ?? []) {
      const match = simulateMatchInstance(createMatchInstance({
        run,
        opponentChoiceId: opponent.id,
      }));
      matches.push(match);
      records.push({
        ...compactMatch(match, checkpoint.label),
        checkpointId: checkpoint.id,
      });
    }
  }
  if (fixtureCheckpoints.length === 0) errors.push('No checkpoint fixtures were provided');
  if (matches.length === 0) errors.push('No checkpoint matches were sampled');
  const depths = [...new Set(fixtureCheckpoints.map((checkpoint) => checkpoint.roundDepth))]
    .sort((a, b) => a - b)
    .map((roundDepth) => {
      const depthCheckpointIds = new Set(
        fixtureCheckpoints
          .filter((checkpoint) => checkpoint.roundDepth === roundDepth)
          .map((checkpoint) => checkpoint.id),
      );
      const depthMatches = records.filter((record) => depthCheckpointIds.has(record.checkpointId));
      return {
        roundDepth,
        checkpoints: depthCheckpointIds.size,
        matches: depthMatches.length,
        winRate: round(
          depthMatches.filter((record) => record.winner === 0).length
          / Math.max(1, depthMatches.length),
        ),
        chassisLossRate: round(
          depthMatches.filter((record) => record.winner === 1 && record.reason === 'chassis-failure').length
          / Math.max(1, depthMatches.length),
        ),
        avgDurationS: round(mean(depthMatches.map((record) => record.durationS))),
        avgPlayerDamage: round(mean(depthMatches.map((record) => record.playerDamage))),
        avgPlayerPartsLost: round(mean(depthMatches.map((record) => record.playerPartsLost))),
      };
    });
  const totals = {
    checkpoints: fixtureCheckpoints.length,
    matches: matches.length,
    playerWins: records.filter((record) => record.winner === 0).length,
    playerLosses: records.filter((record) => record.winner === 1).length,
    draws: records.filter((record) => record.winner === 'draw').length,
  };
  for (const depth of depths) {
    if (depth.matches > 0 && (
      depth.winRate < GAME_CONTENT.run.balanceTargetWinRateMin
      || depth.winRate > GAME_CONTENT.run.balanceTargetWinRateMax
    )) {
      warnings.push(`Round ${depth.roundDepth} isolated win rate ${depth.winRate} is outside the target band`);
    }
  }
  const reportWithoutDigest = {
    ok: errors.length === 0,
    errors,
    warnings,
    totals,
    depths,
  };
  return {
    report: { ...reportWithoutDigest, digest: digest(reportWithoutDigest) },
    matches,
  };
}
