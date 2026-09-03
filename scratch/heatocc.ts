import { assembleBuild, runBattle, TEMPLATES } from '../packages/sim/src/index.js';
// The contrast that matters: a terrain gate's occupancy is chosen by the pilot
// (measured: 2.6%-15%, and it barely moves). Is a HEAT gate's occupancy chosen
// by the BUILD? If a build can drive it from near-0 to near-1, that is the
// difference between a live conditional and a dead one.
const cases: [string, any][] = [
  ['CH-5 W-CB x2 + 4 radiator', { chassisId: 'CH-5', parts: [{ partId: 'W-CB', count: 2 }, { partId: 'U-RAD', count: 4 }] }],
  ['CH-5 W-CB x2 bare',         { chassisId: 'CH-5', parts: [{ partId: 'W-CB', count: 2 }] }],
  ['CH-5 W-KL x2 bare',         { chassisId: 'CH-5', parts: [{ partId: 'W-KL', count: 2 }] }],
  ['CH-9 W-KL x3 bare',         { chassisId: 'CH-9', parts: [{ partId: 'W-KL', count: 3 }] }],
];
console.log('build                        gun cell temp: share <40C   40-50C   >50C   (mean C)');
for (const [label, wish] of cases) {
  const r = assembleBuild(wish);
  const gunIds = new Set(r.build.parts.filter((p) => p.partId.startsWith('W-')).map((p) => p.instanceId));
  let cold = 0, mid = 0, hot = 0, sum = 0, n = 0;
  for (const opp of TEMPLATES) for (let s = 1; s <= 4; s++) {
    const rep = runBattle({ builds: [r.build, opp.build], seed: s });
    for (const f of rep.frames as any[]) {
      for (const p of f.mechs[0].weapons ?? []) {
        if (!gunIds.has(p.instanceId)) continue;
        const c = p.tempC ?? p.meanC; if (c === undefined) continue;
        n += 1; sum += c;
        if (c < 40) cold += 1; else if (c < 50) mid += 1; else hot += 1;
      }
    }
  }
  if (!n) { console.log(label.padEnd(28), 'no per-part temperature in frames'); continue; }
  console.log(label.padEnd(28),
    (100 * cold / n).toFixed(0).padStart(12) + '%',
    (100 * mid / n).toFixed(0).padStart(7) + '%',
    (100 * hot / n).toFixed(0).padStart(6) + '%',
    (sum / n).toFixed(1).padStart(9));
}
