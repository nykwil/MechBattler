#!/usr/bin/env node
/**
 * How the starting blueprint actually fares against the round-1 opponents it will
 * meet, straight up: every node-1 choice from 60 real runs, at that opponent's own
 * battle seed and spawn distance.
 *
 * It exists because docs/15 §7 records a round-1 win rate of 0.147 from
 * `npm run game:balance`, against a stated target band of 0.35-0.65, and that figure
 * alone does not say whether the build is weak or something else is. Head to head it
 * wins about a third -- close to the band's floor -- so the gap between the two
 * numbers is worth understanding before the blueprint is changed on the strength of
 * the lower one.
 *
 * Not a substitute for game:balance, which plays whole runs and is the authority.
 * This isolates one question: the first fight, pristine build, no run context.
 *
 * Run from the repo: `npx tsx scripts/starter-odds.mjs`
 */
import { runBattle, TEMPLATES } from '@mechbattler/sim';
import { createRun } from '@mechbattler/game';

const build = TEMPLATES.find((t) => t.id === 'vulture-skirmisher').build;
console.log('starter:', build.chassisId, build.parts.map((p) => p.partId).join(' '));

// Round-1 opponents, from the real generator across many seeds.
const reasons = new Map();
let wins = 0, n = 0;
const durations = [];
for (let seed = 1; seed <= 60; seed += 1) {
  const run = createRun({ seed, kitName: 'x', build });
  const node = run.generatedNodes.find((x) => x.index === 1);
  for (const opp of node.opponents ?? []) {
    const r = runBattle({
      builds: [build, opp.build],
      seed: Number(opp.battleSeed ?? seed) || seed,
      ...(process.env.NO_SPAWN ? {} : { spawnDistanceM: opp.spawnDistanceM }),
    });
    n += 1;
    if (r.winner === 0) wins += 1;
    const key = `${opp.elite ? 'elite' : 'normal'} threat${opp.threat}`;
    const cur = reasons.get(key) ?? { w: 0, n: 0 };
    cur.n += 1; if (r.winner === 0) cur.w += 1;
    reasons.set(key, cur);
    durations.push(r.durationS);
  }
}
durations.sort((a, b) => a - b);
console.log(`\n${wins}/${n} wins (${(wins / n * 100).toFixed(1)}%)`);
console.log('median fight length:', durations[Math.floor(durations.length / 2)].toFixed(1), 's');
for (const [k, v] of [...reasons].sort()) console.log(`  ${k}: ${v.w}/${v.n} = ${(v.w / v.n * 100).toFixed(0)}%`);


// --- The harness's policy, modelled -----------------------------------------
// game:balance allows two attempts per node, cycling opponents. Losing removes
// destroyed parts permanently (settlePlayerDamage returns [] at zero integrity);
// the between-round repair restores integrity but cannot bring a part back. So the
// second attempt is fought with a crippled mech, and the round's win rate blends a
// pristine try with a wrecked one.
let first = { w: 0, n: 0 };
let second = { w: 0, n: 0 };
for (let seed = 1; seed <= 60; seed += 1) {
  const run = createRun({ seed, kitName: 'x', build });
  const node = run.generatedNodes.find((x) => x.index === 1);
  const opponents = node.opponents ?? [];
  if (opponents.length === 0) continue;

  let mech = build;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const opp = opponents[(attempt - 1) % opponents.length];
    const r = runBattle({
      builds: [mech, opp.build],
      seed: Number(opp.battleSeed ?? seed) || seed,
      spawnDistanceM: opp.spawnDistanceM,
    });
    const bucket = attempt === 1 ? first : second;
    bucket.n += 1;
    if (r.winner === 0) bucket.w += 1;
    if (r.winner === 0) break;
    // Drop what the battle destroyed; survivors are repaired to full.
    const hp = new Map(r.mechs[0].partsFinalHp.map((x) => [x.instanceId, x.hpFrac]));
    mech = {
      ...mech,
      parts: mech.parts.filter((pt) => (hp.get(pt.instanceId) ?? 1) > 0),
    };
  }
}
const pct = (b) => `${b.w}/${b.n} = ${(b.w / Math.max(1, b.n) * 100).toFixed(1)}%`;
console.log('\nharness policy, two attempts per node:');
console.log('  attempt 1 (pristine):', pct(first));
console.log('  attempt 2 (after losses, parts gone):', pct(second));
const blend = { w: first.w + second.w, n: first.n + second.n };
console.log('  blended round-1 rate:', pct(blend));

// --- What-if: how big is the retry lever? -----------------------------------
// Same two-attempt policy, but the second attempt keeps its parts (repaired) rather
// than losing the destroyed ones. Not a proposal -- a measurement of how much of the
// collapse is the stripping rule, so the design question has a number attached.
let keepSecond = { w: 0, n: 0 };
for (let seed = 1; seed <= 60; seed += 1) {
  const run = createRun({ seed, kitName: 'x', build });
  const node = run.generatedNodes.find((x) => x.index === 1);
  const opponents = node.opponents ?? [];
  if (opponents.length === 0) continue;
  const first = opponents[0];
  const r1 = runBattle({
    builds: [build, first.build],
    seed: Number(first.battleSeed ?? seed) || seed,
    spawnDistanceM: first.spawnDistanceM,
  });
  if (r1.winner === 0) continue;
  const opp = opponents[1 % opponents.length];
  const r2 = runBattle({
    builds: [build, opp.build], // pristine: nothing stripped
    seed: Number(opp.battleSeed ?? seed) || seed,
    spawnDistanceM: opp.spawnDistanceM,
  });
  keepSecond.n += 1;
  if (r2.winner === 0) keepSecond.w += 1;
}
console.log('  attempt 2 if parts were kept:', `${keepSecond.w}/${keepSecond.n} = ${(keepSecond.w / Math.max(1, keepSecond.n) * 100).toFixed(1)}%`);
