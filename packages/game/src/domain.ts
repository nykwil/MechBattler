import {
  CORE_INSTANCE_ID,
  MODIFIERS,
  Pcg32,
  checkPlacement,
  getChassis,
  getPart,
  validateWholeBuildPlacement,
  modifierIdsFor,
  type BattleReport,
  type Build,
  type PlacedPart,
} from '@mechbattler/sim';
import { GAME_CONTENT } from './content.js';
import { generateRunNodes } from './nodes.js';
import {
  GAME_SAVE_VERSION,
  type InstalledPart,
  type MechInstance,
  type PartInstance,
  type PendingSalvage,
  type PendingModService,
  type RunInstance,
  type SalvageCandidate,
} from './types.js';

export function buildToMech(build: Build, source: PartInstance['provenance']['source'] = 'starter'): MechInstance {
  return {
    chassisId: build.chassisId,
    parts: build.parts.map((part) => ({
      id: part.instanceId,
      partId: part.partId,
      integrity: part.integrity,
      modifiers: part.modifiers,
      variant: part.variant,
      provenance: { source },
      origin: part.origin,
      rotation: part.rotation,
    })),
    routes: structuredClone(build.routes ?? []),
    chassisIntegrity: build.chassisIntegrity ?? 1,
    powerPriority: [...build.powerPriority],
  };
}

export function mechToBuild(mech: MechInstance): Build {
  return {
    chassisId: mech.chassisId,
    parts: mech.parts.map((part): PlacedPart => ({
      instanceId: part.id,
      partId: part.partId,
      integrity: part.integrity,
      modifiers: part.modifiers,
      variant: part.variant,
      origin: part.origin,
      rotation: part.rotation,
    })),
    routes: structuredClone(mech.routes ?? []),
    chassisIntegrity: mech.chassisIntegrity,
    powerPriority: [...mech.powerPriority],
  };
}

export function createRun(args: {
  seed: number;
  kitName: string;
  build: Build;
  prep?: boolean;
}): RunInstance {
  return {
    schemaVersion: GAME_SAVE_VERSION,
    id: `run-${args.seed.toString(16)}`,
    seed: args.seed,
    status: args.prep ? 'prep' : 'active',
    nodeIndex: 1,
    scrap: GAME_CONTENT.economy.startingScrap,
    fightsWon: 0,
    battlesCompleted: 0,
    kitName: args.kitName,
    earnedChassisIds: [],
    earnedPartIds: [],
    earnedChallengeIds: [],
    generatedNodes: generateRunNodes(args.seed),
    mech: buildToMech(args.build),
    bench: [],
    events: [],
  };
}

export function repairCost(tier: number, fromIntegrity: number, toIntegrity: number): number {
  const points = Math.max(0, toIntegrity - fromIntegrity) * 100;
  // Subtract a tiny epsilon so an exact decimal cost such as 55×0.4×2 is
  // not rounded up by IEEE-754 representation (44.00000000000001 → 45).
  return Math.ceil(points * GAME_CONTENT.economy.repairCostPerPoint * tier - 1e-9);
}

export function settlePlayerDamage(run: RunInstance, report: BattleReport): RunInstance {
  const hp = new Map(report.mechs[0].partsFinalHp.map((part) => [part.instanceId, part.hpFrac]));
  const disabled: InstalledPart[] = [];
  const parts = run.mech.parts.map((part) => {
    const integrity = Math.max(0, Math.min(1, hp.get(part.id) ?? part.integrity));
    if (integrity <= 0) disabled.push(part);
    return { ...part, integrity };
  });
  return {
    ...run,
    battlesCompleted: run.battlesCompleted + 1,
    mech: {
      ...run.mech,
      parts,
      chassisIntegrity: report.mechs[0].chassisIntegrityFrac,
    },
    events: [
      ...run.events,
      ...disabled.map((part) => ({
        type: 'part-lost' as const,
        nodeIndex: run.nodeIndex,
        partId: part.partId,
        partInstanceId: part.id,
      })),
    ],
  };
}

/** Lightweight adapter for UI editors that still hold a sim Build directly. */
export function settleBuildDamage(build: Build, report: BattleReport): Build {
  const hp = new Map(report.mechs[0].partsFinalHp.map((part) => [part.instanceId, part.hpFrac]));
  const parts = build.parts.map((part) => {
    const integrity = Math.max(0, Math.min(1, hp.get(part.instanceId) ?? part.integrity));
    return { ...part, integrity };
  });
  return {
    ...build,
    parts,
    chassisIntegrity: report.mechs[0].chassisIntegrityFrac,
  };
}

function rollVariantMult(rng: Pcg32): number {
  const value = Math.max(-1, Math.min(1, rng.gaussian() * 0.4));
  return Math.round((1 + value * 0.1) * 100) / 100;
}

function rollQuirk(rng: Pcg32, partId: string): string | null {
  if (rng.nextFloat() >= 0.3) return null;
  const wantFlaw = rng.nextFloat() < 2 / 3;
  const pool = modifierIdsFor(getPart(partId)).filter((id) => {
    const kind = MODIFIERS[id]!.kind;
    return wantFlaw ? kind === 'quirk-flaw' : kind === 'quirk-gift';
  });
  return pool.length > 0 ? pool[Math.floor(rng.nextFloat() * pool.length)]! : null;
}

export function createSalvageCandidates(args: {
  run: Pick<RunInstance, 'seed' | 'nodeIndex'>;
  report: BattleReport;
  enemyBuild: Build;
  opponentName: string;
  purse: number;
  guaranteeMod?: boolean;
}): SalvageCandidate[] {
  const lost = new Set(args.report.mechs[1].partsLost.map((part) => part.instanceId));
  const hp = new Map(args.report.mechs[1].partsFinalHp.map((part) => [part.instanceId, part.hpFrac]));
  const wearRng = new Pcg32(args.report.seed ^ 0x5a17a6e);
  const rollRng = new Pcg32(args.report.seed ^ 0x0ddba11);
  const candidates = args.enemyBuild.parts.map((placed, index): SalvageCandidate => {
    const def = getPart(placed.partId);
    const destroyed = lost.has(placed.instanceId);
    const wear = wearRng.nextFloat() * GAME_CONTENT.economy.extractionWearMax;
    const integrity = destroyed ? 0 : Math.max(0.05, (hp.get(placed.instanceId) ?? 1) - wear);
    const stats: Array<'damage' | 'cycleS' | 'dispersionMrad' | 'hp'> =
      def.category === 'weapon' ? ['damage', 'cycleS', 'dispersionMrad', 'hp'] : ['hp'];
    const stat = stats[Math.floor(rollRng.nextFloat() * stats.length)]!;
    const mult = rollVariantMult(rollRng);
    const quirk = rollQuirk(rollRng, placed.partId);
    const modifiers = [...(placed.modifiers ?? []), ...(quirk && !placed.modifiers?.includes(quirk) ? [quirk] : [])];
    return {
      id: `salvage-${args.run.seed}-${args.run.nodeIndex}-${index}`,
      sourceInstanceId: placed.instanceId,
      partId: placed.partId,
      integrity,
      modifiers: modifiers.length > 0 ? modifiers : undefined,
      variant: mult !== 1 ? { [stat]: mult } : undefined,
      provenance: { source: 'salvage', nodeIndex: args.run.nodeIndex, opponentName: args.opponentName },
      origin: placed.origin,
      rotation: placed.rotation,
      destroyed,
      scrapValue: destroyed
        ? def.tier * GAME_CONTENT.economy.destroyedScrapMultiplier
        : Math.max(1, Math.round(def.tier * GAME_CONTENT.economy.intactScrapMultiplier * integrity)),
    };
  });
  if (args.guaranteeMod && !candidates.some((candidate) =>
    !candidate.destroyed && candidate.modifiers?.some((id) => MODIFIERS[id]?.kind === 'mod'))) {
    const eligible = candidates.filter((candidate) =>
      !candidate.destroyed && modifierIdsFor(getPart(candidate.partId)).some((id) => MODIFIERS[id]!.kind === 'mod'));
    const target = eligible[Math.floor(rollRng.nextFloat() * eligible.length)];
    if (target) {
      const pool = modifierIdsFor(getPart(target.partId)).filter((id) => MODIFIERS[id]!.kind === 'mod');
      const modId = pool[Math.floor(rollRng.nextFloat() * pool.length)];
      if (modId) target.modifiers = [...(target.modifiers ?? []), modId];
    }
  }
  return candidates;
}

export function settleBattle(args: {
  run: RunInstance;
  report: BattleReport;
  enemyBuild: Build;
  opponentName: string;
  elite?: boolean;
  matchId?: string;
  unlocks?: PendingSalvage['unlocks'];
  unlockIds?: PendingSalvage['unlockIds'];
}): RunInstance {
  const damaged = settlePlayerDamage(args.run, args.report);
  const battleEvent = {
    type: 'battle' as const,
    nodeIndex: args.run.nodeIndex,
    won: args.report.winner === 0,
    reason: args.report.reason,
    matchId: args.matchId,
  };
  const settled = {
    ...damaged,
    earnedChassisIds: [
      ...new Set([...damaged.earnedChassisIds, ...(args.unlockIds?.chassis ?? [])]),
    ],
    earnedPartIds: [
      ...new Set([...damaged.earnedPartIds, ...(args.unlockIds?.parts ?? [])]),
    ],
    earnedChallengeIds: [
      ...new Set([...damaged.earnedChallengeIds, ...(args.unlockIds?.challenges ?? [])]),
    ],
    events: [...damaged.events, battleEvent],
  };
  if (args.report.winner !== 0) {
    return defeatRun(settled, `Defeated by ${args.opponentName}: ${args.report.reason}`);
  }
  const purse = Math.round(
    (GAME_CONTENT.economy.purseBase + GAME_CONTENT.economy.pursePerNode * settled.nodeIndex)
    * (args.elite ? GAME_CONTENT.economy.elitePurseMultiplier : 1),
  );
  return {
    ...settled,
    pendingSalvage: {
      opponentName: args.opponentName,
      opponentChassisId: args.enemyBuild.chassisId,
      opponentPowerPriority: [...args.enemyBuild.powerPriority],
      purse,
      candidates: createSalvageCandidates({
        run: settled,
        report: args.report,
        enemyBuild: args.enemyBuild,
        opponentName: args.opponentName,
        purse,
        guaranteeMod: settled.fightsWon === 0,
      }),
      unlocks: args.unlocks,
      unlockIds: args.unlockIds,
    },
  };
}



export function modOffers(runSeed: number, afterWin: number): string[] {
  const rng = new Pcg32((runSeed * 977 + afterWin) ^ 0x3ac41);
  const pool = Object.values(MODIFIERS)
    .filter((modifier) => modifier.kind === 'mod' && modifier.id !== 'sacrificial-casing')
    .map((modifier) => modifier.id);
  for (let index = pool.length - 1; index > 0; index--) {
    const swap = Math.floor(rng.nextFloat() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap]!, pool[index]!];
  }
  return pool.slice(0, GAME_CONTENT.run.modOfferCount);
}

export function finalizeSalvage(run: RunInstance, takenIds: string[]): RunInstance {
  if (!run.pendingSalvage) return run;
  const taken = new Set(takenIds);
  const room = Math.max(0, GAME_CONTENT.run.benchCap - run.bench.length);
  const loot = run.pendingSalvage.candidates
    .filter((candidate) => !candidate.destroyed && taken.has(candidate.id))
    .slice(0, room)
    .map(({ destroyed: _destroyed, scrapValue: _scrapValue, ...part }) => part);
  const actuallyTaken = new Set(loot.map((part) => part.id));
  const scrapGained = run.pendingSalvage.purse + run.pendingSalvage.candidates
    .filter((candidate) => !actuallyTaken.has(candidate.id))
    .reduce((sum, candidate) => sum + candidate.scrapValue, 0);
  const fightsWon = run.fightsWon + 1;
  const serviceDue = fightsWon < GAME_CONTENT.run.length
    && fightsWon % GAME_CONTENT.run.modServiceEveryWins === 0;
  const pendingModService: PendingModService | undefined = serviceDue
    ? { afterWin: fightsWon, offerIds: modOffers(run.seed, fightsWon), applied: false }
    : undefined;
  const complete = run.nodeIndex >= GAME_CONTENT.run.length;
  return {
    ...run,
    status: complete ? 'over' : 'active',
    victorious: complete ? true : undefined,
    cause: complete ? 'Completed the ladder' : undefined,
    scrap: run.scrap + scrapGained,
    fightsWon,
    nodeIndex: complete ? run.nodeIndex : run.nodeIndex + 1,
    bench: [...run.bench, ...loot],
    pendingSalvage: undefined,
    pendingModService,
    yardRerolled: false,
    events: [...run.events, {
      type: 'salvage',
      nodeIndex: run.nodeIndex,
      takenIds: [...actuallyTaken],
      scrapGained,
    }],
  };
}

export function applyRunMod(
  run: RunInstance,
  partInstanceId: string,
  modifierId: string,
): RunInstance {
  const service = run.pendingModService;
  const modifier = MODIFIERS[modifierId];
  const cost = GAME_CONTENT.economy.machinistBaseCost;
  if (!service || service.applied || !service.offerIds.includes(modifierId) || !modifier || run.scrap < cost) return run;
  const allParts = [...run.mech.parts, ...run.bench];
  const target = allParts.find((part) => part.id === partInstanceId);
  if (!target || !modifier.appliesTo(getPart(target.partId))) return run;
  if (target.modifiers?.some((id) => MODIFIERS[id]?.kind === 'mod')) return run;
  const copies = allParts.reduce((count, part) => count + (part.modifiers?.filter((id) => id === modifierId).length ?? 0), 0);
  if (modifier.maxCopiesPerBuild !== undefined && copies >= modifier.maxCopiesPerBuild) return run;
  const patch = <T extends PartInstance>(part: T): T => part.id === partInstanceId
    ? { ...part, modifiers: [...(part.modifiers ?? []), modifierId] }
    : part;
  return {
    ...run,
    scrap: run.scrap - cost,
    mech: { ...run.mech, parts: run.mech.parts.map(patch) },
    bench: run.bench.map(patch),
    pendingModService: { ...service, applied: true },
    events: [...run.events, { type: 'mod', nodeIndex: run.nodeIndex, partInstanceId, modifierId }],
  };
}

export function skipModService(run: RunInstance): RunInstance {
  return { ...run, pendingModService: undefined };
}

function patchOwnedPart(
  run: RunInstance,
  partInstanceId: string,
  patch: (part: PartInstance) => PartInstance,
): RunInstance {
  return {
    ...run,
    mech: {
      ...run.mech,
      parts: run.mech.parts.map((part) =>
        part.id === partInstanceId ? { ...part, ...patch(part) } : part),
    },
    bench: run.bench.map((part) => part.id === partInstanceId ? patch(part) : part),
  };
}

/** Scrap to restore the chassis body from `fromIntegrity` to full. */
export function chassisRepairCost(fromIntegrity: number): number {
  const points = Math.max(0, 1 - fromIntegrity) * 100;
  return Math.ceil(points * GAME_CONTENT.economy.chassisRepairCostPerPoint - 1e-9);
}

/**
 * Repair the chassis body. Chassis damage persists between fights like part
 * damage does, but until Aug 2026 the only way to undo it lived inline in the
 * workshop component — so the rule existed for a player clicking a button and
 * did not exist for anything reasoning about a run. The headless progression
 * loop therefore modelled a pilot who could fix every component and never the
 * frame under them, and its runs died of accumulated body damage at node 3-4
 * while every part-level measurement said the mech was getting stronger.
 */
export function repairRunChassis(run: RunInstance): RunInstance {
  const integrity = run.mech.chassisIntegrity ?? 1;
  if (integrity >= 1) return run;
  const cost = chassisRepairCost(integrity);
  if (cost <= 0 || cost > run.scrap) return run;
  return {
    ...run,
    scrap: run.scrap - cost,
    mech: { ...run.mech, chassisIntegrity: 1 },
  };
}

export function repairOwnedPart(
  run: RunInstance,
  partInstanceId: string,
  toIntegrity = 1,
): RunInstance {
  const part = [...run.mech.parts, ...run.bench].find((candidate) => candidate.id === partInstanceId);
  if (!part) return run;
  const integrity = Math.max(part.integrity, Math.min(1, toIntegrity));
  const cost = repairCost(getPart(part.partId).tier, part.integrity, integrity);
  if (cost <= 0 || cost > run.scrap) return run;
  const repaired = patchOwnedPart(run, partInstanceId, (owned) => ({ ...owned, integrity }));
  return {
    ...repaired,
    scrap: run.scrap - cost,
    events: [...run.events, { type: 'repair', nodeIndex: run.nodeIndex, partInstanceId, integrity, cost }],
  };
}

export function scrapOwnedPart(run: RunInstance, partInstanceId: string): RunInstance {
  const part = [...run.mech.parts, ...run.bench].find((candidate) => candidate.id === partInstanceId);
  if (!part) return run;
  const scrapGained = Math.max(
    1,
    Math.round(getPart(part.partId).tier * GAME_CONTENT.economy.ownedScrapMultiplier * part.integrity),
  );
  const liveInstalled = run.mech.parts.filter((candidate) => candidate.id !== partInstanceId);
  const liveIds = new Set(liveInstalled.map((candidate) => candidate.id));
  return {
    ...run,
    scrap: run.scrap + scrapGained,
    mech: {
      ...run.mech,
      parts: liveInstalled,
      powerPriority: run.mech.powerPriority.filter((id) => id === '__core__' || liveIds.has(id)),
    },
    bench: run.bench.filter((candidate) => candidate.id !== partInstanceId),
    events: [...run.events, { type: 'scrap', nodeIndex: run.nodeIndex, partInstanceId, scrapGained }],
  };
}

export function refitPart(
  run: RunInstance,
  partInstanceId: string,
  placement: Pick<InstalledPart, 'origin' | 'rotation'> | null,
): RunInstance {
  const installed = run.mech.parts.find((candidate) => candidate.id === partInstanceId);
  if (placement === null) {
    if (!installed || run.bench.length >= GAME_CONTENT.run.benchCap) return run;
    const { origin: _origin, rotation: _rotation, ...part } = installed;
    const parts = run.mech.parts.filter((candidate) => candidate.id !== partInstanceId);
    const liveIds = new Set(parts.map((candidate) => candidate.id));
    return {
      ...run,
      mech: {
        ...run.mech,
        parts,
        powerPriority: run.mech.powerPriority.filter((id) => id === '__core__' || liveIds.has(id)),
      },
      bench: [...run.bench, part],
      events: [...run.events, { type: 'refit', nodeIndex: run.nodeIndex, partInstanceId, installed: false }],
    };
  }
  const benched = run.bench.find((candidate) => candidate.id === partInstanceId);
  if (!benched) return run;
  const candidate: InstalledPart = { ...benched, ...placement };
  const issue = checkPlacement(
    getChassis(run.mech.chassisId),
    mechToBuild(run.mech).parts,
    {
      instanceId: candidate.id,
      partId: candidate.partId,
      integrity: candidate.integrity,
      modifiers: candidate.modifiers,
      variant: candidate.variant,
      origin: candidate.origin,
      rotation: candidate.rotation,
    },
    getPart(candidate.partId),
  );
  if (issue) return run;
  return {
    ...run,
    mech: { ...run.mech, parts: [...run.mech.parts, candidate] },
    bench: run.bench.filter((part) => part.id !== partInstanceId),
    events: [...run.events, { type: 'refit', nodeIndex: run.nodeIndex, partInstanceId, installed: true }],
  };
}

/**
 * Replace a whole fitted layout atomically. The proposed Build supplies only
 * placement, routing, and priority; owned instance condition and provenance
 * always come from the run. Invalid proposals throw without mutating state.
 */
export function applyValidatedRefit(run: RunInstance, proposed: Build): RunInstance {
  if (proposed.chassisId !== run.mech.chassisId) {
    throw new Error('A normal refit cannot change chassis');
  }
  const owned = new Map(
    [...run.mech.parts, ...run.bench].map((part) => [part.id, part] as const),
  );
  if (owned.size !== run.mech.parts.length + run.bench.length) {
    throw new Error('Run inventory contains duplicate instance ids');
  }
  const installedIds = new Set<string>();
  const installed = proposed.parts.map((placement): InstalledPart => {
    if (installedIds.has(placement.instanceId)) {
      throw new Error(`Duplicate proposed instance ${placement.instanceId}`);
    }
    installedIds.add(placement.instanceId);
    const instance = owned.get(placement.instanceId);
    if (!instance || instance.partId !== placement.partId) {
      throw new Error(`Proposed part ${placement.instanceId} is not owned`);
    }
    return {
      ...instance,
      origin: { ...placement.origin },
      rotation: placement.rotation,
    };
  });
  const bench = [...owned.values()].filter((part) => !installedIds.has(part.id)).map((part) => {
    const { origin: _origin, rotation: _rotation, ...instance } = part as InstalledPart;
    return instance;
  });
  if (bench.length > GAME_CONTENT.run.benchCap) {
    throw new Error(`Refit exceeds bench capacity ${GAME_CONTENT.run.benchCap}`);
  }
  const authoritativeBuild: Build = {
    chassisId: proposed.chassisId,
    parts: installed.map((part) => ({
      instanceId: part.id,
      partId: part.partId,
      integrity: part.integrity,
      modifiers: part.modifiers,
      variant: part.variant,
      origin: { ...part.origin },
      rotation: part.rotation,
    })),
    routes: structuredClone(proposed.routes ?? []),
    chassisIntegrity: run.mech.chassisIntegrity,
    powerPriority: [...proposed.powerPriority],
  };
  const issues = validateWholeBuildPlacement(getChassis(proposed.chassisId), authoritativeBuild);
  if (issues.length > 0) {
    throw new Error(`Invalid refit: ${issues.map((issue) => issue.reason).join(', ')}`);
  }
  const liveIds = new Set(installed.map((part) => part.id));
  const powerPriority = [...new Set(proposed.powerPriority.filter(
    (id) => id === CORE_INSTANCE_ID || liveIds.has(id),
  ))];
  if (!powerPriority.includes(CORE_INSTANCE_ID)) powerPriority.unshift(CORE_INSTANCE_ID);
  return {
    ...run,
    mech: {
      ...run.mech,
      parts: installed,
      routes: structuredClone(proposed.routes ?? []),
      powerPriority,
    },
    bench,
    events: [...run.events, {
      type: 'refit-build',
      nodeIndex: run.nodeIndex,
      installedIds: installed.map((part) => part.id),
      benchedIds: bench.map((part) => part.id),
    }],
  };
}

export function purchaseScrapyardPart(
  run: RunInstance,
  offerIndex: number,
): RunInstance {
  const node = run.generatedNodes.find((candidate) => candidate.index === run.nodeIndex);
  const offers = run.yardRerolled ? node?.scrapyardOffers?.reroll : node?.scrapyardOffers?.initial;
  const offer = offers?.[offerIndex];
  if (!offer || run.bench.length >= GAME_CONTENT.run.benchCap || run.scrap < offer.price) return run;
  const partInstanceId = `shop-${run.seed}-${run.nodeIndex}-${run.yardRerolled ? 'r' : 'i'}-${offerIndex}`;
  if (run.bench.some((part) => part.id === partInstanceId)) return run;
  return {
    ...run,
    scrap: run.scrap - offer.price,
    bench: [...run.bench, {
      id: partInstanceId,
      partId: offer.partId,
      integrity: offer.integrity,
      provenance: { source: 'scrapyard', nodeIndex: run.nodeIndex },
    }],
    events: [...run.events, { type: 'scrapyard', nodeIndex: run.nodeIndex, partInstanceId, cost: offer.price }],
  };
}

export function advanceRunNode(run: RunInstance): RunInstance {
  if (run.status === 'over') return run;
  if (run.nodeIndex >= GAME_CONTENT.run.length) {
    return { ...run, status: 'over', victorious: true, cause: 'Completed the ladder' };
  }
  return {
    ...run,
    nodeIndex: run.nodeIndex + 1,
    yardRerolled: false,
  };
}

export function defeatRun(run: RunInstance, cause: string): RunInstance {
  return { ...run, status: 'over', cause, victorious: false };
}
