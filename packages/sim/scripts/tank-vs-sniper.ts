/**
 * The core-loop demonstration (the user's "this is the core of the game").
 * Two findings, both emergent from physics — no synergy tags:
 *
 *  1. A rock-paper-scissors triangle between three same-era archetypes: the
 *     fast carbine sniper out-ranges the gunline, the gunline out-trades the
 *     tank, and the tank survives-and-deletes the sniper. No archetype
 *     dominates; each has a build it beats and a build it loses to.
 *  2. Armor is a legible build lever: strip the tank's front armor and it can
 *     no longer survive the crossing to the sniper — the matchup flips. This
 *     is the workshop counterplay loop (read the intel card, adjust the build).
 *
 * Run: npm run sim:demo --workspace=@mechbattler/sim
 */
import { runBattle, type Build } from '../src/index.js';
import { TEMPLATES } from '../src/templates.js';
import { getPart } from '../src/catalog.js';

const build = (id: string) => TEMPLATES.find((t) => t.id === id)!.build;
const sniper = build('vulture-sniper');
const gunline = build('mule-gunline');
const tank = build('bastion-tank');

/** Win rate of `a` over `b`, spawn-side-balanced across `seeds` battles. */
function winRate(a: Build, b: Build, seeds = 60): number {
  let aWins = 0;
  for (let s = 0; s < seeds; s++) {
    const flip = s % 2 === 1;
    const r = runBattle({ builds: flip ? [b, a] : [a, b], seed: 5000 + s });
    if (r.winner !== 'draw' && (r.winner === 0) === !flip) aWins++;
  }
  return Math.round((100 * aWins) / seeds);
}

function stripFrontArmor(b: Build, keep: number): Build {
  let seen = 0;
  return { ...b, parts: b.parts.filter((p) => getPart(p.partId).id !== 'U-ARM' || seen++ < keep) };
}

console.log('Rock-paper-scissors triangle (win% of row vs column):\n');
console.log('  fast sniper  beats  gunline :', winRate(sniper, gunline), '%');
console.log('  gunline      beats  tank    :', winRate(gunline, tank), '%');
console.log('  tank         beats  sniper  :', winRate(tank, sniper), '%');
console.log('\n  (each > 50% means the triangle holds: no dominant archetype)\n');

console.log('Armor is the build lever — tank win% vs the same sniper:\n');
console.log('  full armor (16 plates)   :', winRate(tank, sniper), '%');
console.log('  8 plates removed         :', winRate(stripFrontArmor(tank, 8), sniper), '%');
console.log('  all 16 plates removed    :', winRate(stripFrontArmor(tank, 0), sniper), '%');
