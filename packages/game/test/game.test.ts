import { describe, expect, it } from 'vitest';
import {
  MODIFIERS,
  TEMPLATES,
  type BattleReport,
  type Build,
} from '@mechbattler/sim';
import {
  CHALLENGES,
  GAME_CONTENT,
  GAME_SAVE_VERSION,
  ONE_HOUR_PART_IDS,
  applyBattleOutcomeProgress,
  applyChallengeProgress,
  applyRunMod,
  applyValidatedRefit,
  auditGameContent,
  buildToMech,
  challengeCompleted,
  createMatchInstance,
  createPristineDepthCheckpoints,
  createRun,
  createRunCheckpoint,
  deleteSavedMech,
  defaultProfile,
  finalizeSalvage,
  mechToBuild,
  migrateProfile,
  migrateRun,
  modOffers,
  refitPart,
  repairOwnedPart,
  repairCost,
  restoreMatchInstance,
  restoreRunCheckpoint,
  runBalanceHarness,
  runCheckpointMatchHarness,
  runProgressionCohort,
  oneHourProfile,
  saveMech,
  savedMechErrors,
  serializeMatchInstance,
  serializeRunCheckpoint,
  settleBattle,
  settleMatchInstance,
  settlePlayerDamage,
  simulateMatchInstance,
  type BattleChallengeSummary,
  type RunInstance,
} from '../src/index.js';

const template = TEMPLATES.find((candidate) => candidate.id === 'vulture-skirmisher')!;

function report(overrides: Partial<BattleReport> = {}): BattleReport {
  return {
    seed: 10,
    durationS: 20,
    winner: 0,
    reason: 'core-kill',
    mechs: [
      {
        chassisId: template.build.chassisId,
        capacitorMaxKj: 0,
        shotsFired: 10,
        shotsHit: 6,
        damageDealt: 100,
        partsLost: [],
        partsFinalHp: template.build.parts.map((part) => ({
          instanceId: part.instanceId,
          partId: part.partId,
          hpFrac: part.integrity,
        })),
        functionalMassFrac: 1,
        coreHpRemaining: 100,
      },
      {
        chassisId: 'CH-5',
        capacitorMaxKj: 0,
        shotsFired: 0,
        shotsHit: 0,
        damageDealt: 0,
        partsLost: [],
        partsFinalHp: [],
        functionalMassFrac: 0,
        coreHpRemaining: 0,
      },
    ],
    events: [],
    arena: { lengthM: 300, widthM: 180 },
    terrain: { cellSizeM: 10, cols: 1, rows: 1, cells: [['open']] },
    frames: [],
    ...overrides,
  };
}

function summary(overrides: Partial<BattleChallengeSummary> = {}): BattleChallengeSummary {
  return {
    won: true,
    durationS: 60,
    playerPartsLost: 1,
    enemyPartsDestroyed: 0,
    playerPeakTempC: 25,
    playerShedCount: 0,
    playerDamage: 0,
    enemyHasCapacitor: false,
    enemyCapacitorDestroyed: false,
    ...overrides,
  };
}

describe('game content', () => {
  it('has one route for every enabled part and no dead ammo placeholder', () => {
    const audit = auditGameContent();
    expect(audit.errors).toEqual([]);
    // 27 since the component-height work added the three risers (U-RISE2,
    // U-RISE3, U-RISEL), each of which carries its own unlock route.
    expect(audit.counts.enabledParts).toBe(27);
    expect(GAME_CONTENT.enabledPartIds).not.toContain('U-AMMO');
  });

  it('evaluates every authored challenge at its boundary', () => {
    const cases: Record<string, BattleChallengeSummary> = {
      'first-blood': summary(),
      'clean-machine': summary({ playerPartsLost: 0 }),
      blitz: summary({ durationS: 30, playerPartsLost: 0 }),
      dismantler: summary({ enemyPartsDestroyed: 4 }),
      redline: summary({ playerPeakTempC: 115 }),
      'brownout-survivor': summary({ playerShedCount: 3 }),
      'heavy-hitter': summary({ playerDamage: 150 }),
      counterbattery: summary({ enemyHasCapacitor: true, enemyCapacitorDestroyed: true }),
    };
    for (const challenge of CHALLENGES) {
      expect(challengeCompleted(challenge, cases[challenge.id]!)).toBe(true);
      expect(challengeCompleted(challenge, { ...cases[challenge.id]!, won: false })).toBe(false);
    }
  });

  it('completes challenges once and unlocks starting parts', () => {
    const start = defaultProfile();
    const first = applyChallengeProgress(start, CHALLENGES, summary({ playerPartsLost: 0, durationS: 20 }));
    expect(first.gains.challengeIds).toEqual(expect.arrayContaining(['first-blood', 'clean-machine', 'blitz']));
    expect(first.profile.unlockedPartIds).toContain('W-AC');
    const again = applyChallengeProgress(first.profile, CHALLENGES, summary({ playerPartsLost: 0, durationS: 20 }));
    expect(again.gains.challengeIds).toEqual([]);
  });

  it('defines the exact one-hour inventory and three branchable chassis', () => {
    const profile = oneHourProfile();
    expect(profile.schemaVersion).toBe(GAME_SAVE_VERSION);
    expect(profile.unlockedChassisIds).toEqual(['CH-2', 'CH-5', 'CH-9']);
    expect(profile.unlockedPartIds).toEqual(ONE_HOUR_PART_IDS);
    expect(profile.savedMechs).toHaveLength(9);
    expect(new Set(profile.savedMechs.map((mech) => mech.build.chassisId)))
      .toEqual(new Set(['CH-2', 'CH-5', 'CH-9']));
  });

  it('applies battle unlocks without browser state', () => {
    const start = defaultProfile();
    const enemy = template.build;
    const outcome = applyBattleOutcomeProgress(start, GAME_CONTENT, report({
      mechs: [report().mechs[0], { ...report().mechs[1], chassisId: enemy.chassisId }],
    }), enemy);
    expect(outcome.profile.unlockedChassisIds).toContain('CH-2');
    expect(outcome.profile.unlockedPartIds).toContain('W-AC');
    expect(outcome.gains.chassisIds).toEqual(['CH-2']);
  });
});

describe('progression loop', () => {
  it('is deterministic and records real choices and fingerprints', () => {
    const options = {
      seeds: [73001], battles: 1,
      profiles: ['fresh'] as const,
      policies: ['survival'] as const,
    };
    const first = runProgressionCohort(options);
    const second = runProgressionCohort(options);
    expect(first.ok).toBe(true);
    expect(first.digest).toBe(second.digest);
    expect(first.totals.battles).toBe(1);
    expect(first.cases[0]!.battles[0]!.decisions[0]?.kind).toBe('opponent');
    expect(first.cases[0]!.battles[0]!.before.chassisId).toBe('CH-5');
    expect(first.cases[0]!.battles[0]!.visibleOpponentFacts.length).toBeGreaterThan(1);
  });
});

describe('run domain', () => {
  it('round-trips a sim build through owned instances', () => {
    expect(mechToBuild(buildToMech(template.build))).toMatchObject(template.build);
  });

  it('creates deterministic versioned runs', () => {
    const a = createRun({ seed: 42, kitName: 'Scout', build: template.build });
    const b = createRun({ seed: 42, kitName: 'Scout', build: template.build });
    expect(a).toEqual(b);
    // Read the dials rather than freezing them: what this asserts is that a
    // generated run matches its configuration, not that the configuration has
    // particular values. Tuning the ladder should not read as a regression.
    expect(a.scrap).toBe(GAME_CONTENT.economy.startingScrap);
    expect(a.schemaVersion).toBe(GAME_SAVE_VERSION);
    expect(a.generatedNodes).toHaveLength(GAME_CONTENT.run.length);
    expect(a.generatedNodes.filter((node) => node.kind === 'scrapyard'))
      .toHaveLength(GAME_CONTENT.run.scrapyardCount);
  });

  it('persists damage and keeps destroyed player parts as repairable wrecks', () => {
    const run = createRun({ seed: 42, kitName: 'Scout', build: template.build });
    const first = template.build.parts[0]!;
    const second = template.build.parts[1]!;
    const partsFinalHp = template.build.parts.map((part) => ({
      instanceId: part.instanceId,
      partId: part.partId,
      hpFrac: part.instanceId === first.instanceId ? 0 : part.instanceId === second.instanceId ? 0.42 : 1,
    }));
    const next = settlePlayerDamage(run, report({
      mechs: [
        { ...report().mechs[0], partsFinalHp, partsLost: [{ instanceId: first.instanceId, partId: first.partId }] },
        report().mechs[1],
      ],
    }));
    expect(next.mech.parts.find((part) => part.id === first.instanceId)?.integrity).toBe(0);
    expect(next.mech.parts.find((part) => part.id === second.instanceId)?.integrity).toBe(0.42);
    expect(next.battlesCompleted).toBe(1);
  });

  it('preserves regional origins through owned instances and atomic refits', () => {
    const run = createRun({ seed: 43, kitName: 'Scout', build: template.build });
    expect(mechToBuild(run.mech).parts.map((part) => part.origin))
      .toEqual(template.build.parts.map((part) => part.origin));
    const restored = migrateRun(JSON.parse(JSON.stringify(run)));
    expect(restored?.mech.parts.map((part) => part.origin))
      .toEqual(template.build.parts.map((part) => part.origin));
    const moved = structuredClone(mechToBuild(run.mech));
    const removed = moved.parts.pop()!;
    const refitted = applyValidatedRefit(run, moved);
    expect(refitted.bench.find((part) => part.id === removed.instanceId)?.provenance.source).toBe('starter');
    expect(refitted.mech.parts.every((part) => part.origin.regionId)).toBe(true);
    expect(() => applyValidatedRefit(run, {
      ...moved,
      parts: moved.parts.map((part, index) => index === 0
        ? { ...part, origin: { regionId: 'missing', x: 0, y: 0 } }
        : part),
    })).toThrow('Invalid refit');
  });

  it('settles purse and scrap once, respects bench cap, and schedules services', () => {
    const base = createRun({ seed: 42, kitName: 'Scout', build: template.build });
    const run: RunInstance = {
      ...base,
      fightsWon: 2,
      bench: Array.from({ length: 7 }, (_, index) => ({
        id: `bench-${index}`, partId: 'U-ARM', integrity: 1, provenance: { source: 'legacy' as const },
      })),
      pendingSalvage: {
        opponentName: 'Target',
        purse: 35,
        candidates: [
          {
            id: 'take', partId: 'W-AC', integrity: 0.5, provenance: { source: 'salvage' },
            origin: { x: 0, y: 0 }, rotation: 0,
            destroyed: false, scrapValue: 8,
          },
          {
            id: 'overflow', partId: 'W-MG', integrity: 1, provenance: { source: 'salvage' },
            origin: { x: 0, y: 0 }, rotation: 0,
            destroyed: false, scrapValue: 8,
          },
          {
            id: 'wreck', partId: 'U-ARM', integrity: 0, provenance: { source: 'salvage' },
            origin: { x: 0, y: 0 }, rotation: 0,
            destroyed: true, scrapValue: 4,
          },
        ],
      },
    };
    const next = finalizeSalvage(run, ['take', 'overflow']);
    expect(next.scrap).toBe(30 + 35 + 8 + 4);
    expect(next.bench).toHaveLength(8);
    expect(next.pendingModService?.afterWin).toBe(3);
    expect(finalizeSalvage(next, [])).toEqual(next);
  });



  it('offers deterministic mods and applies one affordable applicable mod', () => {
    const run = createRun({ seed: 42, kitName: 'Scout', build: template.build });
    const weapon = run.mech.parts.find((part) => part.partId.startsWith('W-'))!;
    const offerIds = modOffers(run.seed, 3);
    expect(modOffers(run.seed, 3)).toEqual(offerIds);
    const applicable = offerIds.find((id) => MODIFIERS[id]!.appliesTo(
      { id: weapon.partId } as Parameters<typeof MODIFIERS[string]['appliesTo']>[0],
    ));
    const forced = applicable ?? 'cold-bore';
    const ready = { ...run, pendingModService: { afterWin: 3, offerIds: [forced], applied: false } };
    const next = applyRunMod(ready, weapon.id, forced);
    expect(next.scrap).toBe(5);
    expect(next.pendingModService?.applied).toBe(true);
    expect(next.mech.parts.find((part) => part.id === weapon.id)?.modifiers).toContain(forced);
  });

  it('opens a persistent wreck transaction through the pure battle command', () => {
    const run = createRun({ seed: 42, kitName: 'Scout', build: template.build });
    const next = settleBattle({
      run,
      report: report(),
      enemyBuild: template.build,
      opponentName: 'Target',
    });
    expect(next.battlesCompleted).toBe(1);
    expect(next.pendingSalvage?.opponentName).toBe('Target');
    expect(next.pendingSalvage?.purse)
      .toBe(GAME_CONTENT.economy.purseBase + GAME_CONTENT.economy.pursePerNode);
    expect(next.pendingSalvage?.candidates).toHaveLength(template.build.parts.length);
    expect(next.pendingSalvage?.candidates.map((candidate) => candidate.origin))
      .toEqual(template.build.parts.map((part) => part.origin));
  });

  it('repairs and refits owned instances without UI state', () => {
    const run = createRun({ seed: 42, kitName: 'Scout', build: template.build });
    const installed = run.mech.parts[0]!;
    const damaged = {
      ...run,
      mech: {
        ...run.mech,
        parts: run.mech.parts.map((part) =>
          part.id === installed.id ? { ...part, integrity: 0.5 } : part),
      },
    };
    const repaired = repairOwnedPart(damaged, installed.id, 0.75);
    expect(repaired.mech.parts.find((part) => part.id === installed.id)?.integrity).toBe(0.75);
    expect(repaired.scrap).toBeLessThan(damaged.scrap);

    const benched = refitPart(run, installed.id, null);
    expect(benched.bench.some((part) => part.id === installed.id)).toBe(true);
    const reinstalled = refitPart(benched, installed.id, {
      origin: installed.origin,
      rotation: installed.rotation,
    });
    expect(reinstalled.mech.parts.some((part) => part.id === installed.id)).toBe(true);
  });

  it('keeps repair math as a configurable economy dial', () => {
    // The point of the test is that the dial drives the formula, so read the
    // dial rather than freezing its current value: ceil(points x rate x tier).
    const rate = GAME_CONTENT.economy.repairCostPerPoint;
    expect(repairCost(2, 0.45, 1)).toBe(Math.ceil(55 * rate * 2 - 1e-9));
    expect(repairCost(2, 1, 1)).toBeLessThanOrEqual(0);
  });
});

describe('match instances and round-depth checkpoints', () => {
  it('keeps a single match independent and settles it exactly once', () => {
    const run = createRun({ seed: 42, kitName: 'Scout', build: template.build });
    const opponent = run.generatedNodes[0]?.opponents?.[0];
    expect(opponent).toBeTruthy();
    const ready = createMatchInstance({ run, opponentChoiceId: opponent!.id });
    expect(ready.playerBuild).not.toBe(mechToBuild(run.mech));
    expect(run.battlesCompleted).toBe(0);

    const resolved = simulateMatchInstance(ready);
    expect(resolved.status).toBe('resolved');
    expect(resolved.report?.frames).toEqual([]);
    const restored = restoreMatchInstance(serializeMatchInstance(resolved));
    expect(restored).toEqual(resolved);

    const settlement = settleMatchInstance(run, restored);
    expect(settlement.match.status).toBe('settled');
    expect(settlement.run.battlesCompleted).toBe(1);
    expect(settlement.run.events.find((event) => event.type === 'battle')?.matchId).toBe(ready.id);
    expect(settleMatchInstance(settlement.run, settlement.match)).toEqual(settlement);
  });

  it('round-trips an isolated deterministic checkpoint at a round boundary', () => {
    const run = createRun({ seed: 42, kitName: 'Scout', build: template.build });
    const checkpoint = createRunCheckpoint({ run, label: 'balance-depth-1' });
    const restored = restoreRunCheckpoint(serializeRunCheckpoint(checkpoint));
    expect(restored).toEqual(checkpoint);
    expect(restored.roundDepth).toBe(1);
    restored.run.scrap = 999;
    expect(checkpoint.run.scrap).toBe(GAME_CONTENT.economy.startingScrap);
  });

  it('produces deterministic depth cohorts without conflating matches and runs', () => {
    const options = {
      seedsPerKit: 1,
      starterTemplateIds: ['vulture-skirmisher'],
      checkpointDepths: [1, 2],
      maxRoundDepth: 2,
      sampleAllChoices: false,
    };
    const first = runBalanceHarness(options);
    const second = runBalanceHarness(options);
    expect(first.report).toEqual(second.report);
    expect(first.report.ok).toBe(true);
    expect(first.checkpoints.some((checkpoint) => checkpoint.roundDepth === 1)).toBe(true);
    expect(first.matches.length).toBeGreaterThan(0);
    expect(new Set(first.matches.map((match) => match.id)).size).toBe(first.matches.length);
  });

  it('can isolate match balance at saved early and late round depths', () => {
    const checkpoints = createPristineDepthCheckpoints({
      seedsPerKit: 1,
      starterTemplateIds: ['vulture-skirmisher'],
      checkpointDepths: [1, 12],
    });
    const result = runCheckpointMatchHarness(checkpoints);
    expect(result.report.ok).toBe(true);
    expect(result.report.depths.map((depth) => depth.roundDepth)).toEqual([1, 12]);
    expect(result.report.depths.every((depth) => depth.matches > 0)).toBe(true);
    expect(result.matches.every((match) => match.runId && match.report)).toBe(true);
  });
});

describe('migration', () => {
  it('resets legacy profile unlocks and history for the spatial schema', () => {
    const profile = migrateProfile(
      { unlockedChassis: ['CH-2', 'CH-5'], unlockedParts: ['W-RG'] },
      [{ kitName: 'Old', fightsWon: 2, cause: 'Lost', victorious: false, endedAt: '2026-01-01' }],
    );
    expect(profile.unlockedPartIds).toEqual(GAME_CONTENT.initialPartIds);
    expect(profile.grandfatheredPartIds).toEqual([]);
    expect(profile.history).toHaveLength(0);
    // Names the shipped starting blueprint, which moved to the Needle
    // Skirmisher in Aug 2026: three barrels instead of two, because a fresh run
    // was losing to disarming far more often than to dying.
    expect(profile.savedMechs.map((mech) => mech.name)).toEqual(['Mule Needle Skirmisher']);
  });

  it('migrates v2 profiles without a saved-mech collection', () => {
    const current = defaultProfile();
    const { savedMechs: _savedMechs, ...withoutGarage } = current;
    const migrated = migrateProfile(withoutGarage);
    expect(migrated.savedMechs).toHaveLength(1);
    expect(savedMechErrors(migrated, migrated.savedMechs[0]!.build)).toEqual([]);
  });

  it('rejects legacy runs instead of inventing spatial topology', () => {
    const legacyBuild: Build = template.build;
    const migrated = migrateRun({
      data: {
        seed: 12, nodeIndex: 3, scrap: 40, fightsWon: 2, kitName: 'Old',
        benchPool: [{ partId: 'W-AC', integrity: 0.5 }],
      },
      build: legacyBuild,
    });
    expect(migrated).toBeNull();
  });
});

describe('saved mech blueprints', () => {
  it('saves, overwrites, and deletes legal owned loadouts without run damage or mods', () => {
    const profile = {
      ...defaultProfile(),
      unlockedChassisIds: ['CH-2', 'CH-5'],
      unlockedPartIds: [...new Set([
        ...defaultProfile().unlockedPartIds,
        ...template.build.parts.map((part) => part.partId),
      ])],
    };
    const damaged: Build = {
      ...template.build,
      parts: template.build.parts.map((part, index) => index === 0
        ? { ...part, integrity: 0.3, modifiers: ['cold-bore'], variant: { damage: 1.1 } }
        : part),
    };
    const created = saveMech(profile, { name: '  Field Mouse  ', build: damaged });
    expect(created.savedMech.name).toBe('Field Mouse');
    expect(created.savedMech.build.parts[0]).toEqual(expect.objectContaining({ integrity: 1 }));
    expect(created.savedMech.build.parts[0]?.modifiers).toBeUndefined();
    expect(created.savedMech.build.parts[0]?.variant).toBeUndefined();
    const replaced = saveMech(created.profile, {
      id: created.savedMech.id,
      name: 'Field Mouse II',
      build: template.build,
    });
    expect(replaced.profile.savedMechs).toHaveLength(created.profile.savedMechs.length);
    expect(replaced.savedMech.id).toBe(created.savedMech.id);
    expect(deleteSavedMech(replaced.profile, replaced.savedMech.id).savedMechs)
      .not.toContainEqual(expect.objectContaining({ id: replaced.savedMech.id }));
  });

  it('rejects regional seams, equipment routes, and duplicate route layers in imported blueprints', () => {
    const mule = structuredClone(TEMPLATES.find((candidate) => candidate.id === 'mule-gunline')!.build);
    const profile = {
      ...defaultProfile(),
      unlockedChassisIds: ['CH-2', 'CH-5'],
      unlockedPartIds: [...new Set([
        ...defaultProfile().unlockedPartIds,
        ...mule.parts.map((part) => part.partId),
      ])],
    };
    mule.parts[0]!.origin = { regionId: 'body', x: 3, y: 1 };
    mule.routes = [
      { kind: 'wire', regionId: 'body', x: 1, y: 4 },
      { kind: 'wire', regionId: 'body', x: 0, y: 2 },
      { kind: 'wire', regionId: 'body', x: 0, y: 2 },
    ];
    const errors = savedMechErrors(profile, mule);
    expect(errors.join('\n')).toContain('out-of-region');
    expect(errors.join('\n')).toContain('route-on-equipment');
    expect(errors.join('\n')).toContain('duplicate-route');
  });
});
