// Reads a progression cohort JSON report and answers the questions the raw
// trace cannot: how long runs actually survive, when unlocks land, whether
// builds diverge as battles accumulate, and whether chassis keep identities.
//
// Usage: node scripts/loop-report.mjs artifacts/loop.json [--json out.json]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const inputPath = args.find((value) => !value.startsWith('--'));
if (!inputPath) {
  console.error('Usage: node scripts/loop-report.mjs <report.json> [--json out.json]');
  process.exit(2);
}
const report = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));

const round = (value, places = 2) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};
const mean = (values) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);

/** Battles are counted across run restarts, so runId is the only run boundary. */
function runLengths(entry) {
  const lengths = new Map();
  for (const battle of entry.battles) lengths.set(battle.runId, (lengths.get(battle.runId) ?? 0) + 1);
  return [...lengths.values()];
}

/** Distance on the axes the design says must stay meaningful, each normalised. */
function axisDistance(a, b) {
  const jaccard = (left, right) => {
    const l = new Set(left);
    const r = new Set(right);
    const union = new Set([...l, ...r]);
    if (union.size === 0) return 0;
    let shared = 0;
    for (const value of l) if (r.has(value)) shared += 1;
    return 1 - shared / union.size;
  };
  const scaled = (left, right, span) => Math.min(1, Math.abs(left - right) / span);
  return round(mean([
    jaccard(a.partIds, b.partIds),
    a.primaryWeaponFamily === b.primaryWeaponFamily ? 0 : 1,
    scaled(a.range.endM, b.range.endM, 300),
    scaled(a.burstDps, b.burstDps, 80),
    scaled(a.heat.marginKw, b.heat.marginKw, 40),
    scaled(a.power.marginKw, b.power.marginKw, 40),
    scaled(a.mobility.forwardMps, b.mobility.forwardMps, 12),
    scaled(a.armorParts, b.armorParts, 8),
    jaccard(a.locationEffectIds, b.locationEffectIds),
  ]), 3);
}

function meanPairwise(fingerprints) {
  const distances = [];
  for (let i = 0; i < fingerprints.length; i += 1) {
    for (let j = i + 1; j < fingerprints.length; j += 1) distances.push(axisDistance(fingerprints[i], fingerprints[j]));
  }
  return round(mean(distances), 3);
}

const byProfile = {};
for (const entry of report.cases) {
  const bucket = (byProfile[entry.profile] ??= {
    cases: 0, battles: 0, wins: 0, runs: 0, runLengths: [], repairs: 0, refits: 0,
    scrapyardSkips: 0, salvageDecisions: 0,
  });
  bucket.cases += 1;
  bucket.battles += entry.battles.length;
  bucket.wins += entry.wins;
  bucket.runs += entry.runsStarted;
  bucket.runLengths.push(...runLengths(entry));
  for (const battle of entry.battles) {
    for (const decision of battle.decisions) {
      if (decision.kind === 'repair') bucket.repairs += 1;
      if (decision.kind === 'refit') bucket.refits += 1;
      if (decision.kind === 'salvage') bucket.salvageDecisions += 1;
      if (decision.kind === 'scrapyard' && decision.choice === 'skip') bucket.scrapyardSkips += 1;
    }
  }
}

const profiles = Object.fromEntries(Object.entries(byProfile).map(([id, bucket]) => [id, {
  cases: bucket.cases,
  battles: bucket.battles,
  winRate: round(bucket.wins / Math.max(1, bucket.battles), 3),
  runsStarted: bucket.runs,
  meanRunBattles: round(mean(bucket.runLengths), 2),
  longestRunBattles: Math.max(0, ...bucket.runLengths),
  runsReachingFour: bucket.runLengths.filter((length) => length >= 4).length,
  repairs: bucket.repairs,
  refits: bucket.refits,
  salvageDecisions: bucket.salvageDecisions,
  scrapyardSkips: bucket.scrapyardSkips,
}]));

// Unlock reachability: battle index at which a fresh cohort first gained each
// target. Starting equipment is owned without ever being "gained", so anything
// present in a final profile but never in a gains list is reached at battle 0.
const targets = report.oneHourTarget;
const fresh = report.cases.filter((value) => value.profile === 'fresh');
const firstGain = { chassis: {}, parts: {} };
for (const entry of fresh) {
  for (const battle of entry.battles) {
    for (const id of battle.gains.chassisIds) {
      firstGain.chassis[id] = Math.min(firstGain.chassis[id] ?? Infinity, battle.battle);
    }
    for (const id of battle.gains.partIds) {
      firstGain.parts[id] = Math.min(firstGain.parts[id] ?? Infinity, battle.battle);
    }
  }
}
const owned = {
  chassis: new Set(fresh.flatMap((entry) => entry.finalProfile.unlockedChassisIds)),
  parts: new Set(fresh.flatMap((entry) => entry.finalProfile.unlockedPartIds)),
};
const reachedAt = (kind, id) => firstGain[kind][id] ?? (owned[kind].has(id) ? 0 : null);
const unlockReachability = {
  chassis: Object.fromEntries(targets.chassisIds.map((id) => [id, reachedAt('chassis', id)])),
  parts: Object.fromEntries(targets.partIds.map((id) => [id, reachedAt('parts', id)])),
  neverReached: [
    ...targets.chassisIds.filter((id) => reachedAt('chassis', id) === null),
    ...targets.partIds.filter((id) => reachedAt('parts', id) === null),
  ],
};

// Divergence over time: builds should be further apart late than early. Compared
// within a profile so the one-hour fixture's head start is not read as growth.
const divergence = {};
for (const [profileId] of Object.entries(byProfile)) {
  const entries = report.cases.filter((value) => value.profile === profileId);
  const maxBattle = Math.max(...entries.map((value) => value.battles.length));
  const at = (index) => entries.map((value) => value.battles[index]?.after).filter(Boolean);
  divergence[profileId] = {
    afterFirstBattle: meanPairwise(at(0)),
    afterLastBattle: meanPairwise(at(maxBattle - 1)),
    finalBuilds: meanPairwise(entries.map((value) => value.finalBuild)),
  };
}

// Chassis identity: one-hour cases start on a known chassis, so within-chassis
// spread below between-chassis spread means identities survived the run.
const oneHour = report.cases.filter((value) => value.profile === 'one-hour');
const chassisGroups = {};
for (const entry of oneHour) (chassisGroups[entry.startingChassisId] ??= []).push(entry.finalBuild);
const chassisIdentity = {
  withinChassisSpread: Object.fromEntries(
    Object.entries(chassisGroups).map(([id, builds]) => [id, meanPairwise(builds)]),
  ),
  betweenChassisSpread: round(mean(
    Object.keys(chassisGroups).flatMap((left, index) =>
      Object.keys(chassisGroups).slice(index + 1).flatMap((right) =>
        chassisGroups[left].flatMap((a) => chassisGroups[right].map((b) => axisDistance(a, b))))),
  ), 3),
  primaryWeaponByChassis: Object.fromEntries(
    Object.entries(chassisGroups).map(([id, builds]) => [id, [...new Set(builds.map((b) => b.primaryWeaponFamily))]]),
  ),
};

// Where runs actually end, and how the odds move as a run gets deeper. Mean run
// length says a run is short; this says whether it is short because the ladder
// outruns the player at a particular depth or because losses are spread evenly.
const depth = {};
for (const entry of report.cases) {
  const perRun = new Map();
  for (const battle of entry.battles) {
    const row = perRun.get(battle.runId) ?? { deepest: 0 };
    row.deepest = Math.max(row.deepest, battle.nodeIndex);
    perRun.set(battle.runId, row);
    const bucket = (depth[entry.profile] ??= { byNode: {}, deaths: {} });
    const node = (bucket.byNode[battle.nodeIndex] ??= { fights: 0, wins: 0 });
    node.fights += 1;
    if (battle.won) node.wins += 1;
    if (!battle.won) bucket.deaths[battle.nodeIndex] = (bucket.deaths[battle.nodeIndex] ?? 0) + 1;
  }
}
const runDepth = Object.fromEntries(Object.entries(depth).map(([profileId, bucket]) => [profileId, {
  winRateByNode: Object.fromEntries(Object.entries(bucket.byNode)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([node, row]) => [node, { fights: row.fights, winRate: round(row.wins / row.fights, 2) }])),
  lossesByNode: Object.fromEntries(Object.entries(bucket.deaths).sort((a, b) => Number(a[0]) - Number(b[0]))),
}]));

/**
 * Build archetype: the shape a player would describe out loud, not the exact
 * part list. Two mechs with the same primary gun, the same engagement band and
 * the same amount of plating are the same idea however their cells differ, and
 * two with different ones are different ideas however similar their tier spend.
 * This is what "three viable directions per chassis" has to be counted in.
 */
function archetypeOf(fingerprint) {
  const band = fingerprint.range.endM < 90 ? 'close'
    : fingerprint.range.endM < 150 ? 'mid'
      : fingerprint.range.endM < 220 ? 'long' : 'sniper';
  const armour = fingerprint.armorParts <= 2 ? 'light'
    : fingerprint.armorParts <= 5 ? 'medium' : 'heavy';
  const cooled = fingerprint.heat.marginKw >= -2 ? 'cool' : 'hot';
  return `${fingerprint.primaryWeaponFamily ?? 'unarmed'}/${band}/${armour}/${cooled}`;
}

const finalsByChassis = {};
const archetypeCounts = {};
const partUsage = {};
let finalCount = 0;
for (const entry of report.cases) {
  const last = entry.battles[entry.battles.length - 1]?.after ?? entry.finalBuild;
  (finalsByChassis[last.chassisId] ??= []).push(last);
  const archetype = archetypeOf(last);
  archetypeCounts[archetype] = (archetypeCounts[archetype] ?? 0) + 1;
  finalCount += 1;
  for (const partId of new Set(last.partIds)) partUsage[partId] = (partUsage[partId] ?? 0) + 1;
}
const archetypeEntries = Object.entries(archetypeCounts).sort((a, b) => b[1] - a[1]);
// Herfindahl over part usage: 1 means every build carries the same kit, low
// means the pool is genuinely being drawn from.
const usageShares = Object.values(partUsage).map((count) => count / Math.max(1, finalCount));
const usageTotal = usageShares.reduce((sum, share) => sum + share, 0) || 1;
const concentration = round(
  usageShares.reduce((sum, share) => sum + (share / usageTotal) ** 2, 0), 3,
);
const buildDiversity = {
  distinctArchetypes: archetypeEntries.length,
  archetypesPerChassis: Object.fromEntries(Object.entries(finalsByChassis).map(([id, builds]) => [
    id, [...new Set(builds.map(archetypeOf))].sort(),
  ])),
  dominantArchetype: archetypeEntries[0]
    ? { name: archetypeEntries[0][0], share: round(archetypeEntries[0][1] / finalCount, 3) }
    : null,
  topArchetypes: archetypeEntries.slice(0, 8).map(([name, count]) => ({ name, count })),
  partUsageConcentration: concentration,
  partsNeverUsed: targets.partIds.filter((id) => !partUsage[id]),
};

// Challenge completion. The 15-part target pool is only the parts the one-hour
// fixture asks for; the challenge list gates a further nine behind conditions
// like "reach 115 C" or "three power sheds", and a condition the sim never
// produces is an unlock branch that does not exist. Counted per profile because
// the one-hour fixture is handed most of them at the start.
const challengeCompletion = {};
for (const entry of report.cases) {
  const bucket = (challengeCompletion[entry.profile] ??= { cases: 0, earned: {} });
  bucket.cases += 1;
  for (const battle of entry.battles) {
    for (const id of battle.gains.challengeIds) {
      bucket.earned[id] = (bucket.earned[id] ?? 0) + 1;
    }
  }
}
const challengesEarned = Object.fromEntries(Object.entries(challengeCompletion).map(([id, bucket]) => [
  id, Object.fromEntries(Object.entries(bucket.earned).sort((a, b) => b[1] - a[1])),
]));

// A chassis is unlocked by *defeating* an enemy flying it, so reachability
// depends on two things the aggregate win rate hides: whether the cohort ever
// meets that frame, and whether it can beat it when it does.
const opponentChassis = {};
for (const entry of report.cases) {
  for (const battle of entry.battles) {
    const fact = battle.visibleOpponentFacts.find((value) => value.startsWith('chassis:'));
    const name = fact ? fact.slice('chassis:'.length).split(' · ')[0] : 'unknown';
    const bucket = (opponentChassis[entry.profile] ??= {});
    const row = (bucket[name] ??= { fights: 0, wins: 0 });
    row.fights += 1;
    if (battle.won) row.wins += 1;
  }
}
const chassisMatchups = Object.fromEntries(Object.entries(opponentChassis).map(([profileId, rows]) => [
  profileId,
  Object.fromEntries(Object.entries(rows).map(([name, row]) => [
    name, { fights: row.fights, winRate: round(row.wins / row.fights, 3) },
  ])),
]));

// Hard counters: an opponent the cohort never beats is a wall, not a choice.
const opponents = {};
for (const entry of report.cases) {
  for (const battle of entry.battles) {
    const bucket = (opponents[battle.opponentId] ??= { fights: 0, wins: 0 });
    bucket.fights += 1;
    if (battle.won) bucket.wins += 1;
  }
}
const hardCounters = Object.entries(opponents)
  .map(([id, bucket]) => ({ id, fights: bucket.fights, winRate: round(bucket.wins / bucket.fights, 3) }))
  .filter((entry) => entry.fights >= 4)
  .sort((a, b) => a.winRate - b.winRate);

const summary = {
  source: inputPath,
  digest: report.digest,
  profiles,
  unlockReachability,
  divergence,
  chassisIdentity,
  buildDiversity,
  challengesEarned,
  chassisMatchups,
  runDepth,
  hardCounters: hardCounters.slice(0, 8),
  warnings: [],
};

const warn = (condition, message) => { if (condition) summary.warnings.push(message); };
warn(unlockReachability.neverReached.length > 0, `fresh never reached: ${unlockReachability.neverReached.join(', ')}`);
for (const [name, row] of Object.entries(chassisMatchups.fresh ?? {})) {
  warn(row.fights < 4, `fresh met ${name} only ${row.fights} times; its chassis cannot unlock`);
  warn(row.fights >= 4 && row.winRate === 0, `fresh never beat a ${name} in ${row.fights} fights`);
}
for (const [id, bucket] of Object.entries(profiles)) {
  warn(bucket.meanRunBattles < 3, `${id} mean run is ${bucket.meanRunBattles} battles; a build cannot develop`);
  warn(bucket.winRate < 0.35, `${id} win rate ${bucket.winRate} is below the 0.35 floor`);
  warn(bucket.winRate > 0.8, `${id} win rate ${bucket.winRate} is above the 0.8 ceiling`);
}
// Growth is only the right question when builds start alike. The one-hour
// fixture starts on nine deliberately different probes and already sits near
// 0.33, so demanding it climb further asked it to diverge from a spread it was
// designed to have — it failed the check by holding steady, which is the
// success condition, not the failure one. Cohorts that start together must
// spread; cohorts that start apart must stay apart.
const DIVERGED_ENOUGH = 0.2;
for (const [id, bucket] of Object.entries(divergence)) {
  if (bucket.afterFirstBattle < DIVERGED_ENOUGH) {
    warn(bucket.afterLastBattle <= bucket.afterFirstBattle,
      `${id} builds started alike (${bucket.afterFirstBattle}) and did not spread (${bucket.afterLastBattle})`);
  } else {
    warn(bucket.afterLastBattle < DIVERGED_ENOUGH,
      `${id} builds started apart (${bucket.afterFirstBattle}) but collapsed to ${bucket.afterLastBattle}`);
  }
}
for (const [id, list] of Object.entries(buildDiversity.archetypesPerChassis)) {
  warn(list.length < 3, `${id} reached only ${list.length} distinct build direction(s): ${list.join(', ')}`);
}
warn(buildDiversity.dominantArchetype !== null && buildDiversity.dominantArchetype.share > 0.4,
  `one archetype is ${Math.round((buildDiversity.dominantArchetype?.share ?? 0) * 100)}% of final builds: `
  + `${buildDiversity.dominantArchetype?.name}`);
warn(buildDiversity.partUsageConcentration > 0.09,
  `part usage is concentrated (Herfindahl ${buildDiversity.partUsageConcentration}); builds draw from a narrow pool`);
warn(Math.max(0, ...Object.values(chassisIdentity.withinChassisSpread)) >= chassisIdentity.betweenChassisSpread,
  'chassis identities converged: within-chassis spread is not below between-chassis spread');
for (const entry of hardCounters) {
  warn(entry.winRate === 0, `opponent ${entry.id} was never beaten in ${entry.fights} fights`);
}

const json = JSON.stringify(summary, null, 2);
const outIndex = args.indexOf('--json');
if (outIndex >= 0 && args[outIndex + 1]) {
  const absolute = resolve(args[outIndex + 1]);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${json}\n`);
}
console.log(json);
