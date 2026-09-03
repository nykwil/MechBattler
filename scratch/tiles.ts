import { runBattle, TEMPLATES } from '../packages/sim/src/index.js';
// Ceiling for a terrain-gated defensive mod: what fraction of the fight does a
// mech actually stand on each tile? hull-down manages 6.2% and weaving-gait
// 19.3%, and both sit in deadMods for it.
const counts: Record<string, number> = {}; let total = 0;
const perFight: number[] = [];
for (const a of TEMPLATES) for (const b of TEMPLATES) for (let s = 1; s <= 3; s++) {
  const rep = runBattle({ builds: [a.build, b.build], seed: s });
  let forest = 0, n = 0;
  for (const f of rep.frames as any[]) for (const m of f.mechs) {
    counts[m.tile] = (counts[m.tile] ?? 0) + 1; total += 1; n += 1;
    if (m.tile === 'forest') forest += 1;
  }
  perFight.push(forest / Math.max(n, 1));
}
console.log('tile occupancy over', total, 'mech-frames:');
for (const [t, c] of Object.entries(counts).sort((x, y) => y[1] - x[1]))
  console.log('  ', t.padEnd(8), (100 * c / total).toFixed(1) + '%');
perFight.sort((x, y) => x - y);
const q = (p: number) => (100 * perFight[Math.floor(p * (perFight.length - 1))]!).toFixed(1) + '%';
console.log('per-fight forest share:  p10', q(0.1), ' median', q(0.5), ' p90', q(0.9));
