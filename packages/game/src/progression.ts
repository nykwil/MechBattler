import {
  BRANCH_PROBE_TEMPLATES,
  applyAutoWire,
  computeBurstDps,
  computeEnergyMargin,
  computeHeatBalance,
  computeIdealRangeBand,
  computeSpeedProfile,
  buildSpatialOccupancy,
  buildTierBudget,
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
import { GAMEPLAY_TEMPLATES, GAME_CONTENT, getGameplayTemplate } from './content.js';
import {
  advanceRunNode,
  applyRunMod,
  applyValidatedRefit,
  createRun,
  finalizeSalvage,
  mechToBuild,
  chassisRepairCost,
  purchaseScrapyardPart,
  repairCost,
  repairOwnedPart,
  repairRunChassis,
  skipModService,
} from './domain.js';
import { createMatchInstance, settleMatchInstance, simulateMatchInstance } from './matches.js';
import { defaultProfile } from './persistence.js';
import type { PlayerProfile, RunInstance, RunOpponentChoice, SalvageCandidate } from './types.js';

/**
 * `skirmish` added Aug 2026. The other four between them price armour, reach,
 * cooling and raw survivability, and *none* of them prices mobility — so the
 * cohort had never tested a build that leans on speed, firing arc and picking
 * its engagement distance, even though evasion became a live mechanic once the
 * autopilot learned to cross. A player who flies light and fast is an obvious
 * archetype and had no representative here.
 */
export type ProgressionPolicyId = 'survival' | 'range' | 'thermal' | 'armor' | 'skirmish';
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
  /**
   * Mean integrity of installed parts, 0-1. Everything else in this fingerprint
   * describes the build on paper, and on paper a run's mech only improves —
   * parts, DPS and armour all climb battle over battle. What they hide is that
   * damage persists between fights and repairs are capped by scrap, so the same
   * growing build is physically wearing out. Without this the traces showed a
   * strengthening player losing to a flat ladder, which is not possible.
   */
  meanIntegrity: number;
  /** Chassis body integrity, 0-1. Persists between fights and is repaired
   *  separately from equipment, so it moves independently of everything else. */
  chassisIntegrity: number;
  /**
   * DPS-weighted mean firing arc of the installed weapons, in degrees.
   *
   * Arc is what the whole support layer buys — a turret under a gun is worth
   * +25 degrees and nothing else — and no field of this fingerprint recorded
   * it, so `policyScore` could not value it and `U-TUR` was never fielded by
   * any build in any cohort. A part whose only benefit is invisible to the
   * chooser is a part the loop cannot test.
   */
  meanWeaponArcDeg: number;
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
    meanIntegrity: build.parts.length === 0 ? 1 : round(
      build.parts.reduce((sum, part) => sum + (part.integrity ?? 1), 0) / build.parts.length),
    chassisIntegrity: round(build.chassisIntegrity ?? 1),
    meanWeaponArcDeg: (() => {
      const arcs = build.parts
        .filter((part) => getPart(part.partId).category === 'weapon')
        .map((part) => resolvePlacementEffects(chassis, build, part.instanceId)?.effectiveWeaponArcDeg
          ?? getPart(part.partId).weapon?.mountArcDeg ?? 0);
      return arcs.length === 0 ? 0 : round(arcs.reduce((sum, arc) => sum + arc, 0) / arcs.length);
    })(),
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
    // Arc pays for the policies that expect to be shooting while repositioning:
    // a wider cone is a gun that stays on target through a turn.
    case 'range': return fingerprint.range.endM + fingerprint.burstDps * 2
      + fingerprint.power.marginKw + fingerprint.meanWeaponArcDeg * 0.5;
    case 'thermal': return fingerprint.heat.marginKw * 6 + fingerprint.heat.coolingKw * 2 + fingerprint.burstDps;
    // Weights corrected Aug 2026 against what actually predicts survival.
    // Comparing the builds of runs that died by battle two against runs that
    // reached four, the things these policies were buying did not separate them
    // at all — DPS +3%, plate count +2%, parts 0%, range -1%, arc 0% — while
    // power margin separated them by +94% and carried integrity by +8%. Long
    // runs held *less* armour, not more (-19%): plates add mass and crowd the
    // grid without keeping a mech alive. Armour keeps a real but smaller share,
    // and headroom is paid for directly.
    case 'armor': return fingerprint.armorParts * 18 + fingerprint.protectedPayloads * 40
      + fingerprint.power.marginKw * 2 + fingerprint.burstDps;
    case 'survival': return fingerprint.armorParts * 8 + fingerprint.protectedPayloads * 25
      + fingerprint.power.marginKw * 3
      + fingerprint.heat.marginKw * 2 + fingerprint.mobility.forwardMps * 3 + fingerprint.burstDps
      + fingerprint.meanWeaponArcDeg * 0.25;
    // Speed and a wide cone, bought by leaving weight off. Load factor above 1
    // is an overloaded frame, and this is the one policy that refuses to pay
    // for plating it has to carry.
    case 'skirmish': return fingerprint.mobility.forwardMps * 14
      + fingerprint.meanWeaponArcDeg * 0.6
      + fingerprint.burstDps * 1.5
      + fingerprint.power.marginKw * 2
      - fingerprint.mobility.loadFactor * 30
      - fingerprint.armorParts * 4;
  }
}

/**
 * How many of each part the mech and bench already hold. A part's worth depends
 * on what is already aboard, and `partScore` had no way to know that.
 */
function ownedCounts(run: RunInstance): Map<string, number> {
  const counts = new Map<string, number>();
  for (const part of [...run.mech.parts, ...run.bench]) {
    counts.set(part.partId, (counts.get(part.partId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Marginal value of the next copy of a part you already own.
 *
 * `partScore` is what ranks salvage and scrapyard offers, and it was stateless:
 * it handed `U-ARM` a flat 50 however many plates the mech already carried. So
 * armour won every reward decision forever and came to 46% of every part
 * fielded, 5.0 copies per final build, crowding the rest of the catalogue out
 * of the loop. Making the *placement* score concave was tried first and did
 * nothing, because placement is not where the choice happens.
 *
 * The fifth plate is worth about a third of the first, which is the judgement a
 * player makes without thinking about it.
 */
function marginalMultiplier(owned: number): number {
  return 1 / (1 + owned * 0.5);
}

function partScore(policy: ProgressionPolicyId, partId: string, owned = 0): number {
  const part = getPart(partId);
  const range = part.weapon?.falloff.max ?? 0;
  const dps = part.weapon ? part.weapon.damage * (part.weapon.salvoCount ?? 1) / part.weapon.cycleS : 0;
  const armor = partId === 'U-ARM' || partId === 'U-SHELL' ? 30 : 0;
  const supply = part.reactor ? part.reactor.outputKw : 0;
  const cooling = partId === 'U-RAD' ? 45 : partId === 'U-HS' || partId === 'U-PIPE' ? 25 : 0;
  const base = (() => {
    switch (policy) {
      case 'range': return range + dps * 3 + (partId === 'U-TC1' || partId === 'U-TUR' ? 35 : 0);
      case 'thermal': return cooling * 3 + dps + (part.reactor ? part.reactor.outputKw : 0);
      case 'armor': return armor * 3 + supply + part.hp + dps;
      case 'survival': return armor * 2 + cooling + supply * 1.5 + part.hp + dps * 2;
      // Mass is the cost this policy actually feels, so it reads it directly.
      case 'skirmish': return dps * 3 + range * 0.15 + supply
        + (partId === 'U-ACT' || partId === 'U-TUR' || partId === 'U-TC1' ? 40 : 0)
        - (part.massKg ?? 0) * 0.08;
    }
  })();
  return base * marginalMultiplier(owned);
}

/** The card shows a chassis name; the profile tracks ids. Map one to the other. */
function chassisIdFromLabel(label: string): string {
  const name = label.split(' · ')[0];
  return GAME_CONTENT.enabledChassisIds.find((id) => getChassis(id).name === name) ?? '';
}

/**
 * Chooses only from facts shown on the opponent card, never simulated outcomes.
 *
 * Engagement range is one of those facts and ignoring it made range a tax
 * rather than a tradeoff: a 75 m build fought at 160 m a third of the time and
 * scored 0.00 there, while a 135 m build scored 0.92. Picking the card whose
 * distance suits the band the mech already has is the decision the range axis
 * is supposed to offer, and it is the same judgement a player makes by reading
 * the card.
 */
function chooseOpponent(
  policy: ProgressionPolicyId,
  opponents: RunOpponentChoice[],
  build: BuildFingerprint,
  unlockedChassisIds: readonly string[],
): RunOpponentChoice {
  const visibleAffinity = (opponent: RunOpponentChoice): number => {
    const text = [opponent.headline, ...opponent.confirmed, opponent.carries].filter(Boolean).join(' ').toLowerCase();
    if (policy === 'range') return /carbine|laser|autocannon|rail/.test(text) ? 1 : 0;
    if (policy === 'thermal') return /radiator|sink|laser|combustion/.test(text) ? 1 : 0;
    if (policy === 'armor') return /armor|shell|siege/.test(text) ? 1 : 0;
    if (policy === 'skirmish') return /scout|scrapper|needle|machine/.test(text) ? 1 : 0;
    return /reactor|armor|machine/.test(text) ? 1 : 0;
  };
  // A spawn inside the band costs nothing; beyond it, every metre is approach
  // taken under fire, so the penalty grows with the shortfall.
  const rangeFit = (opponent: RunOpponentChoice): number =>
    Math.max(0, opponent.spawnDistanceM - build.range.endM);
  // Beating an enemy is how you unlock the frame it is flying, so a locked
  // chassis is worth a step up in difficulty — the card names the chassis, so
  // this is still a decision made from the card. Without it the cohort simply
  // never fought the heaviest frame: taking the lowest threat every time meant
  // one Bastion encounter in 96 battles, and an unlock you never meet is not a
  // hard unlock, it is an unreachable one.
  // An elite announces itself on the card: it carries a modifier, and `carries`
  // names it. Threat alone could not separate the two — an elite is floored at
  // 2 and so were plenty of ordinary cards, which left the range-fit tiebreak
  // choosing between them blind. It chose elites 40-59% of the time by node 5
  // against a 25% spawn rate, and an elite is a +4 budget opponent with a mod
  // on top. That is the whole node-4 cliff: the card said threat 1.5 at every
  // depth while the fight behind it got steadily worse.
  const effectiveThreat = (opponent: RunOpponentChoice): number =>
    opponent.threat
    + (opponent.elite ? 1 : 0)
    - (unlockedChassisIds.includes(chassisIdFromLabel(opponent.chassisLabel)) ? 0 : 1);
  /*
   * Lowest effective threat, always.
   *
   * Giving each policy an appetite for paying threat to earn a bigger purse was
   * tried and reverted (Aug 2026). It is a better model of a player -- a
   * skirmisher chasing salvage really would take the heavier card -- and it did
   * move the one-hour cohort from .783 to .742. But taking harder fights loses
   * runs, and shorter runs cannot develop builds: CH-9 fell from three viable
   * directions to two, and the "a build cannot develop" warning came back. The
   * purse still scales with threat, so the *economy* prices the choice honestly;
   * the cohort just does not currently model a player who takes that bet.
   */
  return [...opponents].sort((a, b) =>
    effectiveThreat(a) - effectiveThreat(b)
    || rangeFit(a) - rangeFit(b)
    || visibleAffinity(b) - visibleAffinity(a)
    || a.id.localeCompare(b.id))[0]!;
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

/**
 * A refit that *replaces* a gun rather than bolting another one on.
 *
 * Without this a run's archetype is decided before its first fight: refits only
 * ever appended, so a build could gain plating and cooling but never change
 * what it shot with, and the primary weapon family the starting template
 * happened to carry was the primary weapon family it died with. Measured, the
 * Vulture reached two build directions against a target of three — and it can
 * physically mount the laser, rocket and ion weapons it never once fielded.
 *
 * Bounded to swapping out the weakest installed weapon, which is the swap a
 * player actually considers and keeps the search affordable.
 */
function candidateSwapBuild(
  run: RunInstance,
  instanceId: string,
  policy: ProgressionPolicyId,
): Build | null {
  const benched = run.bench.find((part) => part.id === instanceId);
  if (!benched || getPart(benched.partId).category !== 'weapon') return null;
  const chassis = getChassis(run.mech.chassisId);
  const base = mechToBuild(run.mech);
  const installedWeapons = base.parts
    .filter((part) => getPart(part.partId).category === 'weapon')
    .sort((a, b) => partScore(policy, a.partId) - partScore(policy, b.partId));
  const weakest = installedWeapons[0];
  if (!weakest || partScore(policy, benched.partId) <= partScore(policy, weakest.partId)) return null;
  const stripped: Build = {
    ...base,
    parts: base.parts.filter((part) => part.instanceId !== weakest.instanceId),
    powerPriority: base.powerPriority.filter((id) => id !== weakest.instanceId),
  };
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
            ...stripped,
            parts: [...stripped.parts, placed],
            powerPriority: [...stripped.powerPriority, benched.id],
          };
          const occupied = buildSpatialOccupancy(chassis, { parts: candidate.parts, routes: [] }).stacksByCell;
          candidate.routes = (stripped.routes ?? []).filter((route) =>
            !occupied.has(spatialCellKey(chassis, route)));
          if (validateWholeBuildPlacement(chassis, candidate).length > 0) continue;
          const wired = applyAutoWire(chassis, candidate).build;
          if (validateWholeBuildPlacement(chassis, wired).length === 0) legal.push(wired);
        }
      }
    }
  }
  return legal.sort((a, b) =>
    policyScore(policy, fingerprintBuild(b)) - policyScore(policy, fingerprintBuild(a)))[0] ?? null;
}

function tryBestRefit(run: RunInstance, policy: ProgressionPolicyId): { run: RunInstance; decision?: ProgressionDecision } {
  const before = fingerprintBuild(mechToBuild(run.mech));
  // Bounded to the most promising bench parts. The search is bench x cells x
  // rotations with a full placement validation and auto-wire per candidate, so
  // once runs got long enough to fill a bench it came to dominate cohort
  // runtime — a 3-seed cohort went from 7 minutes to over 40. Ranking by the
  // same part score the policy already uses keeps the choice it would have
  // made in all but pathological cases.
  const installed = new Map<string, number>();
  for (const part of run.mech.parts) installed.set(part.partId, (installed.get(part.partId) ?? 0) + 1);
  const fitScore = (partId: string): number => partScore(policy, partId, installed.get(partId) ?? 0);
  const shortlist = [...run.bench]
    .sort((a, b) => fitScore(b.partId) - fitScore(a.partId) || a.id.localeCompare(b.id))
    .slice(0, 4);
  const options = shortlist
    .flatMap((part) => [
      { part, build: candidatePlacementBuild(run, part.id, policy) },
      { part, build: candidateSwapBuild(run, part.id, policy) },
    ])
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
    // Rank against what is already aboard, so the sixth armour plate stops
    // outscoring the first radiator.
    const held = ownedCounts(run);
    const salvageScore = (partId: string): number => partScore(policy, partId, held.get(partId) ?? 0);
    const intact = run.pendingSalvage.candidates.filter((candidate) => !candidate.destroyed)
      .sort((a: SalvageCandidate, b: SalvageCandidate) =>
        salvageScore(b.partId) - salvageScore(a.partId) || a.id.localeCompare(b.id));
    // Take everything worth keeping, not just the single best. The rule always
    // allowed a bench-full of loot; taking one part and scrapping the rest was
    // the policy being frugal, and it starved the only growth a run has. The
    // ladder gains budget every node whether or not the player picks up more
    // than one item, which is most of why win rate fell off a cliff by node 4.
    // Anything well below the best pick is still left behind for scrap, because
    // repairs have to be paid for and a bench of junk is not a build.
    const room = Math.max(0, GAME_CONTENT.run.benchCap - run.bench.length);
    const best = intact[0] ? salvageScore(intact[0].partId) : 0;
    const keep = intact
      .filter((candidate) => salvageScore(candidate.partId) >= best * 0.6)
      .slice(0, room);
    decisions.push({
      kind: 'salvage', nodeIndex: run.nodeIndex,
      choice: keep.length > 0 ? keep.map((candidate) => candidate.id).join('+') : 'scrap-all',
      reason: keep.length > 0
        ? `${policy} kept ${keep.map((candidate) => candidate.partId).join(', ')}; rest scrapped`
        : 'No intact salvage',
    });
    rewardDecision = true;
    run = finalizeSalvage(run, keep.map((candidate) => candidate.id));
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
  // The frame first: body damage carries between fights and nothing else undoes
  // it, so leaving it is the one repair that compounds for the rest of the run.
  const beforeChassis = run.mech.chassisIntegrity ?? 1;
  const chassisRepaired = repairRunChassis(run);
  if (chassisRepaired !== run) {
    decisions.push({
      kind: 'repair', nodeIndex: run.nodeIndex, choice: 'chassis',
      reason: `Restored chassis from ${round(beforeChassis * 100)}% for ${run.scrap - chassisRepaired.scrap} scrap`,
    });
    run = chassisRepaired;
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

/**
 * Which probe each policy flies. Four policies against three probes per chassis
 * means one pairing has to share a start, and it matters a great deal which.
 *
 * `survival` and `armor` used to share — and they are the two policies whose
 * scoring is most alike, both leading on plating and protected payloads. So a
 * quarter of every cohort was a duplicate that also *ended* where it started,
 * and the third probe was left to a single policy. On the Vulture that was
 * fatal to the measurement: only `range` ever flew the long skirmisher, and it
 * refitted straight into the sniper archetype `thermal` already occupied, so a
 * chassis with three viable probes reported two build directions.
 *
 * `survival` now flies the generalist probe instead. It still shares a start
 * with `range`, but those two diverge under refit — one buys headroom, speed
 * and protection, the other buys reach — where survival and armor did not.
 */
const POLICY_BRANCH: Record<ProgressionPolicyId, Record<string, string>> = {
  range: { 'CH-2': 'probe-vulture-range', 'CH-5': 'probe-mule-gunline', 'CH-9': 'probe-bastion-casemate' },
  thermal: { 'CH-2': 'probe-vulture-cold', 'CH-5': 'probe-mule-thermal', 'CH-9': 'probe-bastion-thermal' },
  armor: { 'CH-2': 'probe-vulture-close', 'CH-5': 'probe-mule-brawler', 'CH-9': 'probe-bastion-suppression' },
  survival: { 'CH-2': 'probe-vulture-range', 'CH-5': 'probe-mule-gunline', 'CH-9': 'probe-bastion-casemate' },
  skirmish: { 'CH-2': 'probe-vulture-close', 'CH-5': 'probe-mule-thermal', 'CH-9': 'probe-bastion-suppression' },
};

function startingBuild(profileId: ProgressionProfileId, policy: ProgressionPolicyId, chassisId: string): { id: string; build: Build } {
  const id = profileId === 'fresh' ? 'mule-needle' : POLICY_BRANCH[policy][chassisId]!;
  const template = getGameplayTemplate(id);
  if (!template) throw new Error(`Missing progression template ${id}`);
  return { id, build: structuredClone(template.build) };
}

/**
 * The fit a *new* run starts from, given everything the profile has unlocked so
 * far. Restarting from the same fixed template every time made losing free of
 * consequence in one direction and free of reward in the other: the seventh run
 * fielded exactly the mech the first one did, so no unlock could ever show up
 * in a starting build and fresh cohorts finished with a pairwise build distance
 * of zero. Chassis and every part must be unlocked, and the fit must fit inside
 * the starting tier budget, so this can only ever pick something the player
 * could also have built.
 */
function bestUnlockedStart(
  profile: PlayerProfile,
  policy: ProgressionPolicyId,
  chassisId: string,
  fallback: { id: string; build: Build },
): { id: string; build: Build } {
  const legal = GAMEPLAY_TEMPLATES.filter((template) =>
    profile.unlockedChassisIds.includes(template.build.chassisId)
    && template.build.parts.every((part) => profile.unlockedPartIds.includes(part.partId))
    && buildTierBudget(template.build) <= GAME_CONTENT.run.startingTierBudget);
  // Stay on the frame this cohort is flying. Ranking every unlocked template
  // globally let all three chassis drift onto whichever one scored best, so
  // within-chassis spread overtook between-chassis spread and the identities
  // measured as converged — an artefact of the chooser, not of the content. A
  // player who likes the Bastion keeps flying the Bastion; what unlocks buy is
  // a better fit *on it*.
  const sameChassis = legal.filter((template) => template.build.chassisId === chassisId);
  const pool = sameChassis.length > 0 ? sameChassis : legal;
  const ranked = pool
    .map((template) => ({ template, score: policyScore(policy, fingerprintBuild(template.build)) }))
    .sort((a, b) => b.score - a.score || a.template.id.localeCompare(b.template.id));
  const best = ranked[0];
  return best
    ? { id: best.template.id, build: structuredClone(best.template.build) }
    : { id: fallback.id, build: structuredClone(fallback.build) };
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
      // A new run gets to use what the last ones unlocked — that is the whole
      // point of a persistent profile behind a run-ending defeat.
      const next = bestUnlockedStart(profile, args.policy, args.chassisId, start);
      run = createRun({ seed: args.seed + runNumber * 104729, kitName: next.id, build: next.build });
      runNumber += 1;
    }
    const node = run.generatedNodes.find((candidate) => candidate.index === run.nodeIndex)!;
    if (node.kind === 'scrapyard') {
      const offers = node.scrapyardOffers?.initial ?? [];
      // Keep enough back to put the mech right. Scrapyards sit anywhere from
      // node 2 on, so one usually lands before the third fight, and spending
      // the purse on a shiny part there left nothing for repairs — win rate by
      // battle index read 1.00, 1.00, 0.25, which is a run dying at the yard
      // rather than in the arena. Buying is still a real choice; it just has to
      // beat fixing what you already own, which is the tradeoff the step is
      // supposed to pose.
      // Reserve for the repairs that actually matter, not a showroom finish.
      // Holding back the full restoration cost meant the yard was skipped 58%
      // of the time it was reached — the purchasing step of the loop existed
      // and could almost never be acted on. Light wear can ride; a part under
      // 60% is the one that gets shot off next fight, and the frame always
      // comes first.
      const repairReserve = run.mech.parts
        .filter((part) => part.integrity < 0.6)
        .reduce((sum, part) => sum + repairCost(getPart(part.partId).tier, part.integrity, 1), 0)
        + chassisRepairCost(run.mech.chassisIntegrity ?? 1);
      const spendable = Math.max(0, run.scrap - repairReserve);
      const yardHeld = ownedCounts(run);
      const ranked = offers
        .map((offer, index) => ({
          offer, index,
          score: partScore(args.policy, offer.partId, yardHeld.get(offer.partId) ?? 0),
        }))
        .filter((entry) => entry.offer.price <= spendable)
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
    const before = fingerprintBuild(mechToBuild(run.mech));
    const opponent = chooseOpponent(args.policy, node.opponents ?? [], before, profile.unlockedChassisIds);
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
        `spawn:${opponent.spawnDistanceM}m`,
        // Elite is a real difficulty step (+4 budget) and only showed up in the
        // trace when the roll also attached a modifier, so a plain elite was
        // invisible to every measurement taken from these facts.
        ...(opponent.elite ? ['elite:true'] : []),
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
  const policies = [...new Set(options.policies
    ?? ['survival', 'range', 'thermal', 'armor', 'skirmish'] as ProgressionPolicyId[])];
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
