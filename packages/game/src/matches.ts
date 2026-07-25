import { runBattle, type BattleReport } from '@mechbattler/sim';
import { GAME_CONTENT } from './content.js';
import { mechToBuild, settleBattle } from './domain.js';
import {
  CHECKPOINT_SAVE_VERSION,
  MATCH_SAVE_VERSION,
  type MatchInstance,
  type PlayerProfile,
  type RunCheckpoint,
  type RunInstance,
} from './types.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertMatchReady(run: RunInstance): void {
  if (run.status !== 'active') throw new Error('A match requires an active run');
  if (run.pendingSalvage) throw new Error('Resolve pending salvage before starting a match');
  if (run.pendingModService) throw new Error('Resolve the pending mod service before starting a match');
}

export function createMatchInstance(args: {
  run: RunInstance;
  opponentChoiceId: string;
  attempt?: number;
}): MatchInstance {
  assertMatchReady(args.run);
  const node = args.run.generatedNodes.find((candidate) => candidate.index === args.run.nodeIndex);
  if (!node || node.kind !== 'fight') throw new Error(`Run node ${args.run.nodeIndex} is not a fight`);
  const opponent = node.opponents?.find((candidate) => candidate.id === args.opponentChoiceId);
  if (!opponent) throw new Error(`Unknown opponent choice ${args.opponentChoiceId}`);
  const priorAttempts = args.run.events.filter(
    (event) => event.type === 'battle' && event.nodeIndex === args.run.nodeIndex,
  ).length;
  const attempt = args.attempt ?? priorAttempts + 1;
  return {
    schemaVersion: MATCH_SAVE_VERSION,
    id: `${args.run.id}:round-${args.run.nodeIndex}:attempt-${attempt}:${opponent.id}`,
    runId: args.run.id,
    nodeIndex: args.run.nodeIndex,
    roundDepth: args.run.nodeIndex,
    attempt,
    runEventOffset: args.run.events.length,
    opponentChoiceId: opponent.id,
    seed: opponent.battleSeed,
    spawnDistanceM: opponent.spawnDistanceM,
    elite: opponent.elite,
    playerBuild: clone(mechToBuild(args.run.mech)),
    opponentBuild: clone(opponent.build),
    opponentName: opponent.name,
    status: 'ready',
  };
}

export function resolveMatchInstance(
  match: MatchInstance,
  report: BattleReport,
): MatchInstance {
  if (match.status !== 'ready') return match;
  if (report.seed !== match.seed) throw new Error(`Match ${match.id} report seed mismatch`);
  if (report.mechs[0].chassisId !== match.playerBuild.chassisId) {
    throw new Error(`Match ${match.id} player chassis mismatch`);
  }
  if (report.mechs[1].chassisId !== match.opponentBuild.chassisId) {
    throw new Error(`Match ${match.id} opponent chassis mismatch`);
  }
  return { ...match, status: 'resolved', report: clone(report) };
}

export function simulateMatchInstance(
  match: MatchInstance,
  options: { recordFrames?: boolean } = {},
): MatchInstance {
  if (match.status !== 'ready') return match;
  const report = runBattle({
    builds: [match.playerBuild, match.opponentBuild],
    seed: match.seed,
    spawnDistanceM: match.spawnDistanceM,
    recordFrames: options.recordFrames ?? false,
  });
  return resolveMatchInstance(match, report);
}

export function settleMatchInstance(
  run: RunInstance,
  match: MatchInstance,
): { run: RunInstance; match: MatchInstance } {
  if (match.status !== 'resolved' || !match.report) return { run, match };
  if (match.runId !== run.id || match.nodeIndex !== run.nodeIndex) {
    throw new Error(`Match ${match.id} does not belong to the current run state`);
  }
  if (match.runEventOffset !== run.events.length) {
    throw new Error(`Run ${run.id} changed after match ${match.id} was created`);
  }
  if (JSON.stringify(mechToBuild(run.mech)) !== JSON.stringify(match.playerBuild)) {
    throw new Error(`Run ${run.id} build changed after match ${match.id} was created`);
  }
  const nextRun = settleBattle({
    run,
    report: match.report,
    enemyBuild: match.opponentBuild,
    opponentName: match.opponentName,
    elite: match.elite,
    matchId: match.id,
  });
  return {
    run: nextRun,
    match: { ...match, status: 'settled' },
  };
}

export function serializeMatchInstance(match: MatchInstance): string {
  return JSON.stringify(match);
}

export function restoreMatchInstance(raw: unknown): MatchInstance {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw;
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid match save');
  const match = parsed as MatchInstance;
  if (match.schemaVersion !== MATCH_SAVE_VERSION) {
    throw new Error(`Unsupported match save version ${String(match.schemaVersion)}`);
  }
  return clone(match);
}

export function isRoundBoundary(run: RunInstance): boolean {
  return run.status === 'active' && !run.pendingSalvage && !run.pendingModService;
}

function checkpointId(run: RunInstance, label: string): string {
  const safeLabel = label.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${run.id}:checkpoint:round-${run.nodeIndex}:battle-${run.battlesCompleted}:${safeLabel || 'state'}`;
}

export function createRunCheckpoint(args: {
  run: RunInstance;
  profile?: PlayerProfile;
  label?: string;
}): RunCheckpoint {
  if (!isRoundBoundary(args.run)) {
    throw new Error('Run checkpoints must be captured at a stable between-round boundary');
  }
  const label = args.label ?? `round-${args.run.nodeIndex}-start`;
  return {
    schemaVersion: CHECKPOINT_SAVE_VERSION,
    id: checkpointId(args.run, label),
    contentSchemaVersion: GAME_CONTENT.schemaVersion,
    runId: args.run.id,
    roundDepth: args.run.nodeIndex,
    nodeIndex: args.run.nodeIndex,
    fightsWon: args.run.fightsWon,
    battlesCompleted: args.run.battlesCompleted,
    label,
    run: clone(args.run),
    profile: args.profile ? clone(args.profile) : undefined,
  };
}

export function serializeRunCheckpoint(checkpoint: RunCheckpoint): string {
  return JSON.stringify(checkpoint);
}

export function restoreRunCheckpoint(
  raw: unknown,
  options: { requireCurrentContent?: boolean } = {},
): RunCheckpoint {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw;
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid run checkpoint');
  const checkpoint = parsed as RunCheckpoint;
  if (checkpoint.schemaVersion !== CHECKPOINT_SAVE_VERSION) {
    throw new Error(`Unsupported checkpoint version ${String(checkpoint.schemaVersion)}`);
  }
  if (options.requireCurrentContent !== false
    && checkpoint.contentSchemaVersion !== GAME_CONTENT.schemaVersion) {
    throw new Error(
      `Checkpoint content version ${checkpoint.contentSchemaVersion} does not match ${GAME_CONTENT.schemaVersion}`,
    );
  }
  if (checkpoint.run.id !== checkpoint.runId || checkpoint.run.nodeIndex !== checkpoint.nodeIndex) {
    throw new Error('Checkpoint metadata does not match its run state');
  }
  return clone(checkpoint);
}
