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
      spawnDistanceM: opp.spawnDistanceM,
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

