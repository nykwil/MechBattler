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
  applyChallengeProgress,
  applyRunMod,
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
    expect(audit.counts.enabledParts).toBe(22);
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
});

describe('run domain', () => {
  it('round-trips a sim build through owned instances', () => {
    expect(mechToBuild(buildToMech(template.build))).toEqual(template.build);
  });

  it('creates deterministic versioned runs', () => {
    const a = createRun({ seed: 42, kitName: 'Scout', build: template.build });
    const b = createRun({ seed: 42, kitName: 'Scout', build: template.build });
    expect(a).toEqual(b);
    expect(a.scrap).toBe(30);
    expect(a.schemaVersion).toBe(2);
    expect(a.generatedNodes).toHaveLength(12);
    expect(a.generatedNodes.filter((node) => node.kind === 'scrapyard')).toHaveLength(2);
  });

  it('persists damage and removes destroyed player parts', () => {
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
    expect(next.mech.parts.some((part) => part.id === first.instanceId)).toBe(false);
    expect(next.mech.parts.find((part) => part.id === second.instanceId)?.integrity).toBe(0.42);
    expect(next.battlesCompleted).toBe(1);
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
    expect(next.pendingSalvage?.purse).toBe(25);
    expect(next.pendingSalvage?.candidates).toHaveLength(template.build.parts.length);
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
    expect(repairCost(2, 0.45, 1)).toBe(44);
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
  it('grandfathers legacy profile unlocks and history', () => {
    const profile = migrateProfile(
      { unlockedChassis: ['CH-2', 'CH-5'], unlockedParts: ['W-RG'] },
      [{ kitName: 'Old', fightsWon: 2, cause: 'Lost', victorious: false, endedAt: '2026-01-01' }],
    );
    expect(profile.unlockedPartIds).toEqual(expect.arrayContaining([...GAME_CONTENT.initialPartIds, 'W-RG']));
    expect(profile.grandfatheredPartIds).toEqual(['W-RG']);
    expect(profile.history).toHaveLength(1);
    expect(profile.savedMechs.map((mech) => mech.name)).toEqual(['Vulture Skirmisher']);
  });

  it('migrates v2 profiles without a saved-mech collection', () => {
    const current = defaultProfile();
    const { savedMechs: _savedMechs, ...withoutGarage } = current;
    const migrated = migrateProfile(withoutGarage);
    expect(migrated.savedMechs).toHaveLength(1);
    expect(savedMechErrors(migrated, migrated.savedMechs[0]!.build)).toEqual([]);
  });

  it('assigns stable ids to legacy bench parts', () => {
    const legacyBuild: Build = template.build;
    const migrated = migrateRun({
      data: {
        seed: 12, nodeIndex: 3, scrap: 40, fightsWon: 2, kitName: 'Old',
        benchPool: [{ partId: 'W-AC', integrity: 0.5 }],
      },
      build: legacyBuild,
    });
    expect(migrated?.bench[0]?.id).toBe('legacy-bench-12-0');
    expect(migrated?.mech.parts[0]?.provenance.source).toBe('legacy');
  });
});

describe('saved mech blueprints', () => {
  it('saves, overwrites, and deletes legal owned loadouts without run damage or mods', () => {
    const profile = defaultProfile();
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
});
