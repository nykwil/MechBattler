import {
  BRANCH_PROBE_TEMPLATES,
  applyAutoWire,
  computeBurstDps,
  computeEnergyMargin,
  computeHeatBalance,
  computeIdealRangeBand,
  computeSpeedProfile,
  buildSpatialOccupancy,
  getChassis,
  getPart,
  locationEffectsForPart,
  resolvePlacementEffects,
  spatialCellKey,
  validateWholeBuildPlacement,
  type Build,
  type PlacedPart,
  type Rotation,
} from '@mechbattler/sim';
import { applyBattleOutcomeProgress } from './challenges.js';
import { GAME_CONTENT, getGameplayTemplate } from './content.js';
import {
  advanceRunNode,
  applyRunMod,
  applyValidatedRefit,
  createRun,
  finalizeSalvage,
  mechToBuild,
  purchaseScrapyardPart,
  repairOwnedPart,
  skipModService,
} from './domain.js';
import { createMatchInstance, settleMatchInstance, simulateMatchInstance } from './matches.js';
import { defaultProfile } from './persistence.js';
import type { PlayerProfile, RunInstance, RunOpponentChoice, SalvageCandidate } from './types.js';

export type ProgressionPolicyId = 'survival' | 'range' | 'thermal' | 'armor';
export type ProgressionProfileId = 'fresh' | 'one-hour';

export interface BuildFingerprint {
  chassisId: string;
  partIds: string[];
  weaponIds: string[];
  primaryWeaponFamily: string | null;
  range: { startM: number; endM: number; mismatched: boolean };
  burstDps: number;
  power: { supplyKw: number; demandKw: number; marginKw: number };
  heat: { inputKw: number; coolingKw: number; marginKw: number };
  mobility: { massT: number; loadFactor: number; forwardMps: number; turnDegS: number };
  armorParts: number;
  protectedPayloads: number;
  locationEffectIds: string[];
  modifierIds: string[];
}

function round(value: number, places = 3): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

export function fingerprintBuild(build: Build): BuildFingerprint {
  const chassis = getChassis(build.chassisId);
  const range = computeIdealRangeBand(build);
  const burst = computeBurstDps(build);
  const power = computeEnergyMargin(chassis, build);
  const heat = computeHeatBalance(chassis, build);
  const speed = computeSpeedProfile(chassis, build);
  const weaponIds = build.parts.filter((part) => getPart(part.partId).category === 'weapon').map((part) => part.partId);
  const primary = [...burst.perWeapon].sort((a, b) => b.dps - a.dps || a.partId.localeCompare(b.partId))[0];
  const protectedPayloads = build.parts.filter((part) => {
    const effect = resolvePlacementEffects(chassis, build, part.instanceId);
    return effect && getPart(part.partId).spatial?.layer !== 'armour' && effect.stackAboveInstanceIds.length > 0;
  }).length;
  return {
    chassisId: build.chassisId,
    partIds: build.parts.map((part) => part.partId).sort(),
    weaponIds: [...weaponIds].sort(),
    primaryWeaponFamily: primary?.partId ?? null,
    range: { startM: round(range.bandStart), endM: round(range.bandEnd), mismatched: range.mismatched },
    burstDps: round(burst.totalDps),
    power: { supplyKw: round(power.supplyKw), demandKw: round(power.demandKw), marginKw: round(power.marginKw) },
    heat: { inputKw: round(heat.heatInKw), coolingKw: round(heat.coolingKw), marginKw: round(heat.marginKw) },
    mobility: {
      massT: round(speed.massT), loadFactor: round(speed.loadFactor),
      forwardMps: round(speed.fwd), turnDegS: round(speed.turnRateDegS),
    },
    armorParts: build.parts.filter((part) => part.partId === 'U-ARM' || part.partId === 'U-SHELL').length,
    protectedPayloads,
    locationEffectIds: [...new Set(build.parts.flatMap((part) =>
      locationEffectsForPart(chassis, part).effects.map((effect) => effect.id)))].sort(),
    modifierIds: [...new Set(build.parts.flatMap((part) => part.modifiers ?? []))].sort(),
  };
}

export function oneHourProfile(): PlayerProfile {
  const profile = defaultProfile();
  return {
    ...profile,
    unlockedChassisIds: [...GAME_CONTENT.progressionTargets.oneHour.chassisIds],
    unlockedPartIds: [...GAME_CONTENT.progressionTargets.oneHour.partIds],
    completedChallengeIds: GAME_CONTENT.challenges
      .filter((challenge) => challenge.unlockPartIds.every((id) => profile.unlockedPartIds.includes(id)
        || GAME_CONTENT.progressionTargets.oneHour.partIds.includes(id)))
      .map((challenge) => challenge.id),
    savedMechs: BRANCH_PROBE_TEMPLATES.map((template) => ({
      id: `one-hour-${template.id}`,
      name: template.name,
      build: structuredClone(template.build),
    })),
  };
}

export interface ProgressionDecision {
  kind: 'opponent' | 'salvage' | 'scrapyard' | 'mod' | 'repair' | 'refit';
  nodeIndex: number;
  choice: string;
  reason: string;
}

export interface ProgressionBattleTrace {
  runId: string;
  battle: number;
  nodeIndex: number;
  policy: ProgressionPolicyId;
  opponentId: string;
  visibleOpponentFacts: string[];
  won: boolean;
  reason: string;
  durationS: number;
  gains: { chassisIds: string[]; partIds: string[]; challengeIds: string[] };
  before: BuildFingerprint;
  after: BuildFingerprint;
  decisions: ProgressionDecision[];
}

export interface ProgressionCaseTrace {
  id: string;
  seed: number;
  policy: ProgressionPolicyId;
  profile: ProgressionProfileId;
  startingChassisId: string;
  battles: ProgressionBattleTrace[];
  runsStarted: number;
  wins: number;
  losses: number;
  successfulRefits: number;
  rewardDecisions: number;
  finalProfile: PlayerProfile;
  finalBuild: BuildFingerprint;
}

export interface ProgressionReport {
  ok: boolean;
  errors: string[];
  config: {
    seeds: number[];
    battles: number;
    profiles: ProgressionProfileId[];
    policies: ProgressionPolicyId[];
  };
  totals: {
    cases: number; battles: number; wins: number; losses: number;
    runsStarted: number; rewardDecisions: number; successfulRefits: number;
  };
  oneHourTarget: {
    chassisIds: string[]; partIds: string[];
    freshMissingChassisIds: string[]; freshMissingPartIds: string[];
  };
  cases: ProgressionCaseTrace[];
  digest: string;
}

export interface ProgressionOptions {
  seeds?: number[];
  battles?: number;
  profiles?: ProgressionProfileId[];
  policies?: ProgressionPolicyId[];
}

function digest(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function policyScore(policy: ProgressionPolicyId, fingerprint: BuildFingerprint): number {
  switch (policy) {
    case 'range': return fingerprint.range.endM + fingerprint.burstDps * 2 + fingerprint.power.marginKw;
    case 'thermal': return fingerprint.heat.marginKw * 6 + fingerprint.heat.coolingKw * 2 + fingerprint.burstDps;
    case 'armor': return fingerprint.armorParts * 30 + fingerprint.protectedPayloads * 40 + fingerprint.burstDps;
    case 'survival': return fingerprint.armorParts * 16 + fingerprint.protectedPayloads * 25
      + fingerprint.heat.marginKw * 2 + fingerprint.mobility.forwardMps * 3 + fingerprint.burstDps;
  }
}

function partScore(policy: ProgressionPolicyId, partId: string): number {
  const part = getPart(partId);
  const range = part.weapon?.falloff.rangeEnd ?? 0;
  const dps = part.weapon ? part.weapon.damage * (part.weapon.salvoCount ?? 1) / part.weapon.cycleS : 0;
  const armor = partId === 'U-ARM' || partId === 'U-SHELL' ? 50 : 0;
  const cooling = partId === 'U-RAD' ? 45 : partId === 'U-HS' || partId === 'U-PIPE' ? 25 : 0;
  switch (policy) {
    case 'range': return range + dps * 3 + (partId === 'U-TC1' || partId === 'U-TUR' ? 35 : 0);
    case 'thermal': return cooling * 3 + dps + (part.reactor ? part.reactor.outputKw : 0);
    case 'armor': return armor * 3 + part.hp + dps;
    case 'survival': return armor * 2 + cooling + part.hp + dps * 2;
  }
}

/** Chooses only from facts shown on the opponent card, never simulated outcomes. */
function chooseOpponent(policy: ProgressionPolicyId, opponents: RunOpponentChoice[]): RunOpponentChoice {
  const visibleAffinity = (opponent: RunOpponentChoice): number => {
    const text = [opponent.headline, ...opponent.confirmed, opponent.carries].filter(Boolean).join(' ').toLowerCase();
    if (policy === 'range') return /carbine|laser|autocannon|rail/.test(text) ? 1 : 0;
    if (policy === 'thermal') return /radiator|sink|laser|combustion/.test(text) ? 1 : 0;
    if (policy === 'armor') return /armor|shell|siege/.test(text) ? 1 : 0;
    return /reactor|armor|machine/.test(text) ? 1 : 0;
  };
  return [...opponents].sort((a, b) =>
    a.threat - b.threat || visibleAffinity(b) - visibleAffinity(a) || a.id.localeCompare(b.id))[0]!;
}

function candidatePlacementBuild(
  run: RunInstance,
  instanceId: string,
  policy: ProgressionPolicyId,
): Build | null {
  const benched = run.bench.find((part) => part.id === instanceId);
  if (!benched) return null;
  const chassis = getChassis(run.mech.chassisId);
  const base = mechToBuild(run.mech);
  const rotations: Rotation[] = [0, 90, 180, 270];
  const legal: Build[] = [];
  for (const region of chassis.regions ?? []) {
    for (let y = 0; y < region.height; y += 1) {
      for (let x = 0; x < region.width; x += 1) {
        if (!region.mask[y]?.[x]) continue;
        for (const rotation of rotations) {
          const placed: PlacedPart = {
            instanceId: benched.id, partId: benched.partId, integrity: benched.integrity,
            modifiers: benched.modifiers, variant: benched.variant,
            origin: { regionId: region.id, x, y }, rotation,
          };
          const candidate: Build = {
            ...base,
            parts: [...base.parts, placed],
            routes: base.routes,
            powerPriority: getPart(benched.partId).draw || getPart(benched.partId).category === 'weapon'
              ? [...base.powerPriority, benched.id]
              : [...base.powerPriority],
          };
          const occupied = buildSpatialOccupancy(chassis, { parts: candidate.parts, routes: [] }).stacksByCell;
          candidate.routes = (base.routes ?? []).filter((route) =>
            !occupied.has(spatialCellKey(chassis, route)));
          if (validateWholeBuildPlacement(chassis, candidate).length > 0) continue;
          const wired = applyAutoWire(chassis, candidate).build;
          if (validateWholeBuildPlacement(chassis, wired).length === 0) legal.push(wired);
        }
      }
    }
  }
  return legal.sort((a, b) =>
    policyScore(policy, fingerprintBuild(b)) - policyScore(policy, fingerprintBuild(a))
    || JSON.stringify(a.parts[a.parts.length - 1]?.origin)
      .localeCompare(JSON.stringify(b.parts[b.parts.length - 1]?.origin)))[0] ?? null;
}

function tryBestRefit(run: RunInstance, policy: ProgressionPolicyId): { run: RunInstance; decision?: ProgressionDecision } {
  const before = fingerprintBuild(mechToBuild(run.mech));
  const options = run.bench
    .map((part) => ({ part, build: candidatePlacementBuild(run, part.id, policy) }))
    .filter((entry): entry is { part: typeof entry.part; build: Build } => Boolean(entry.build))
    .map((entry) => ({ ...entry, score: policyScore(policy, fingerprintBuild(entry.build)) }))
    .sort((a, b) => b.score - a.score || a.part.id.localeCompare(b.part.id));
  const best = options[0];
  if (!best || best.score <= policyScore(policy, before)) return { run };
  return {
    run: applyValidatedRefit(run, best.build),
    decision: {
      kind: 'refit', nodeIndex: run.nodeIndex, choice: best.part.id,
      reason: `${policy} fingerprint score ${round(policyScore(policy, before))} -> ${round(best.score)}`,
    },
  };
}

function applyBetweenBattlePolicy(
  input: RunInstance,
  policy: ProgressionPolicyId,
): { run: RunInstance; decisions: ProgressionDecision[]; rewardDecision: boolean; refit: boolean } {
  let run = input;
  const decisions: ProgressionDecision[] = [];
  let rewardDecision = false;
  let refit = false;
  if (run.status === 'over' && !run.pendingSalvage) {
    return { run, decisions, rewardDecision, refit };
  }
  if (run.pendingSalvage) {
    const intact = run.pendingSalvage.candidates.filter((candidate) => !candidate.destroyed)
      .sort((a: SalvageCandidate, b: SalvageCandidate) =>
        partScore(policy, b.partId) - partScore(policy, a.partId) || a.id.localeCompare(b.id));
    const selected = intact[0];
    decisions.push({
      kind: 'salvage', nodeIndex: run.nodeIndex, choice: selected?.id ?? 'scrap-all',
      reason: selected ? `${policy} ranked ${selected.partId} highest` : 'No intact salvage',
    });
    rewardDecision = true;
    run = finalizeSalvage(run, selected ? [selected.id] : []);
  }
  if (run.pendingModService) {
    let applied = false;
    for (const modifierId of run.pendingModService.offerIds) {
      for (const part of [...run.mech.parts, ...run.bench].sort((a, b) =>
        partScore(policy, b.partId) - partScore(policy, a.partId))) {
        const next = applyRunMod(run, part.id, modifierId);
        if (next !== run) {
          run = next;
          decisions.push({ kind: 'mod', nodeIndex: run.nodeIndex, choice: `${modifierId}:${part.id}`, reason: `First legal ${policy}-ranked mod target` });
          applied = true;
          rewardDecision = true;
          break;
        }
      }
      if (applied) break;
    }
    run = skipModService(run);
  }
  for (const part of [...run.mech.parts].sort((a, b) => a.integrity - b.integrity || a.id.localeCompare(b.id))) {
    if (part.integrity >= 1) continue;
    const beforeScrap = run.scrap;
    const next = repairOwnedPart(run, part.id, 1);
    if (next !== run) {
      run = next;
      decisions.push({ kind: 'repair', nodeIndex: run.nodeIndex, choice: part.id, reason: `Restored ${round(part.integrity * 100)}% integrity for ${beforeScrap - run.scrap} scrap` });
    }
  }
  const refitted = tryBestRefit(run, policy);
  run = refitted.run;
  if (refitted.decision) {
    decisions.push(refitted.decision);
    refit = true;
  }
  return { run, decisions, rewardDecision, refit };
}

const POLICY_BRANCH: Record<ProgressionPolicyId, Record<string, string>> = {
  range: { 'CH-2': 'probe-vulture-range', 'CH-5': 'probe-mule-gunline', 'CH-9': 'probe-bastion-casemate' },
  thermal: { 'CH-2': 'probe-vulture-cold', 'CH-5': 'probe-mule-thermal', 'CH-9': 'probe-bastion-thermal' },
  armor: { 'CH-2': 'probe-vulture-close', 'CH-5': 'probe-mule-brawler', 'CH-9': 'probe-bastion-suppression' },
  survival: { 'CH-2': 'probe-vulture-close', 'CH-5': 'probe-mule-brawler', 'CH-9': 'probe-bastion-suppression' },
};

function startingBuild(profileId: ProgressionProfileId, policy: ProgressionPolicyId, chassisId: string): { id: string; build: Build } {
  const id = profileId === 'fresh' ? 'mule-skirmisher' : POLICY_BRANCH[policy][chassisId]!;
  const template = getGameplayTemplate(id);
  if (!template) throw new Error(`Missing progression template ${id}`);
  return { id, build: structuredClone(template.build) };
}

function runCase(args: {
  seed: number; battles: number; profileId: ProgressionProfileId;
  policy: ProgressionPolicyId; chassisId: string;
}): ProgressionCaseTrace {
  let profile = args.profileId === 'fresh' ? defaultProfile() : oneHourProfile();
  const start = startingBuild(args.profileId, args.policy, args.chassisId);
  let runNumber = 0;
  let run = createRun({ seed: args.seed, kitName: start.id, build: start.build });
  runNumber += 1;
  const battles: ProgressionBattleTrace[] = [];
  let successfulRefits = 0;
  let rewardDecisions = 0;
  let wins = 0;
  let losses = 0;
  let lastBuild = start.build;
  let pendingDecisions: ProgressionDecision[] = [];
  while (battles.length < args.battles) {
    if (run.status === 'over') {
      run = createRun({ seed: args.seed + runNumber * 104729, kitName: start.id, build: start.build });
      runNumber += 1;
    }
    const node = run.generatedNodes.find((candidate) => candidate.index === run.nodeIndex)!;
    if (node.kind === 'scrapyard') {
      const offers = node.scrapyardOffers?.initial ?? [];
      const ranked = offers.map((offer, index) => ({ offer, index, score: partScore(args.policy, offer.partId) }))
        .filter((entry) => entry.offer.price <= run.scrap)
        .sort((a, b) => b.score - a.score || a.index - b.index);
      const best = ranked[0];
      if (best) {
        const beforeBench = run.bench.length;
        run = purchaseScrapyardPart(run, best.index);
        if (run.bench.length > beforeBench) {
          rewardDecisions += 1;
          pendingDecisions.push({
            kind: 'scrapyard', nodeIndex: node.index, choice: best.offer.partId,
            reason: `${args.policy} ranked this affordable offer highest`,
          });
          const result = tryBestRefit(run, args.policy);
          if (result.decision) {
            successfulRefits += 1;
            pendingDecisions.push(result.decision);
          }
          run = result.run;
        }
      } else {
        pendingDecisions.push({
          kind: 'scrapyard', nodeIndex: node.index, choice: 'skip',
          reason: 'No affordable offer',
        });
      }
      run = advanceRunNode(run);
      continue;
    }
    const opponent = chooseOpponent(args.policy, node.opponents ?? []);
    const before = fingerprintBuild(mechToBuild(run.mech));
    let match = createMatchInstance({ run, opponentChoiceId: opponent.id });
    match = simulateMatchInstance(match);
    const settled = settleMatchInstance(run, match);
    run = settled.run;
    const progress = applyBattleOutcomeProgress(profile, GAME_CONTENT, match.report!, match.opponentBuild);
    profile = progress.profile;
    const opponentDecision: ProgressionDecision = {
      kind: 'opponent', nodeIndex: node.index, choice: opponent.id,
      reason: `Lowest visible threat, then ${args.policy} card affinity, then stable id`,
    };
    const between = applyBetweenBattlePolicy(run, args.policy);
    run = between.run;
    if (between.rewardDecision) rewardDecisions += 1;
    if (between.refit) successfulRefits += 1;
    if (match.report!.winner === 0) wins += 1;
    else losses += 1;
    lastBuild = mechToBuild(run.mech);
    battles.push({
      runId: run.id, battle: battles.length + 1, nodeIndex: node.index, policy: args.policy,
      opponentId: opponent.id,
      visibleOpponentFacts: [
        `threat:${opponent.threat}`, `chassis:${opponent.chassisLabel}`,
        ...(opponent.headline ? [`headline:${opponent.headline}`] : []),
        ...opponent.confirmed.map((fact) => `confirmed:${fact}`),
        ...(opponent.carries ? [`carries:${opponent.carries}`] : []),
      ],
      won: match.report!.winner === 0, reason: match.report!.reason, durationS: round(match.report!.durationS),
      gains: progress.gains, before, after: fingerprintBuild(lastBuild),
      decisions: [...pendingDecisions, opponentDecision, ...between.decisions],
    });
    pendingDecisions = [];
  }
  return {
    id: `${args.profileId}:${args.policy}:${args.chassisId}:${args.seed}`,
    seed: args.seed, policy: args.policy, profile: args.profileId,
    startingChassisId: args.chassisId, battles, runsStarted: runNumber,
    wins, losses, successfulRefits, rewardDecisions,
    finalProfile: profile, finalBuild: fingerprintBuild(lastBuild),
  };
}

export function runProgressionCohort(options: ProgressionOptions = {}): ProgressionReport {
  const seeds = [...new Set(options.seeds ?? [73001])];
  const battles = Math.max(1, Math.floor(options.battles ?? GAME_CONTENT.progressionTargets.oneHour.battleCount));
  const profiles = [...new Set(options.profiles ?? ['fresh', 'one-hour'] as ProgressionProfileId[])];
  const policies = [...new Set(options.policies ?? ['survival', 'range', 'thermal', 'armor'] as ProgressionPolicyId[])];
  const cases: ProgressionCaseTrace[] = [];
  for (const profileId of profiles) {
    const chassisIds = profileId === 'fresh' ? ['CH-5'] : GAME_CONTENT.progressionTargets.oneHour.chassisIds;
    for (const policy of policies) {
      for (const chassisId of chassisIds) {
        for (const seed of seeds) cases.push(runCase({ seed, battles, profileId, policy, chassisId }));
      }
    }
  }
  const errors: string[] = [];
  for (const entry of cases) {
    if (entry.battles.length !== battles) errors.push(`${entry.id} resolved ${entry.battles.length}/${battles} battles`);
    if (entry.battles.some((battle) => battle.decisions.length === 0)) errors.push(`${entry.id} has an untraced battle decision`);
  }
  const freshProfiles = cases.filter((entry) => entry.profile === 'fresh').map((entry) => entry.finalProfile);
  const unlockedChassis = new Set(freshProfiles.flatMap((profile) => profile.unlockedChassisIds));
  const unlockedParts = new Set(freshProfiles.flatMap((profile) => profile.unlockedPartIds));
  const oneHour = GAME_CONTENT.progressionTargets.oneHour;
  const summary = {
    config: { seeds, battles, profiles, policies },
    totals: {
      cases: cases.length,
      battles: cases.reduce((sum, entry) => sum + entry.battles.length, 0),
      wins: cases.reduce((sum, entry) => sum + entry.wins, 0),
      losses: cases.reduce((sum, entry) => sum + entry.losses, 0),
      runsStarted: cases.reduce((sum, entry) => sum + entry.runsStarted, 0),
      rewardDecisions: cases.reduce((sum, entry) => sum + entry.rewardDecisions, 0),
      successfulRefits: cases.reduce((sum, entry) => sum + entry.successfulRefits, 0),
    },
    oneHourTarget: {
      chassisIds: [...oneHour.chassisIds], partIds: [...oneHour.partIds],
      freshMissingChassisIds: oneHour.chassisIds.filter((id) => !unlockedChassis.has(id)),
      freshMissingPartIds: oneHour.partIds.filter((id) => !unlockedParts.has(id)),
    },
    cases,
  };
  if (summary.totals.wins > 0 && summary.totals.rewardDecisions === 0) errors.push('Winning cohort made no reward decisions');
  return { ok: errors.length === 0, errors, ...summary, digest: digest(summary) };
}
