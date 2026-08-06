import { runBattle } from '@mechbattler/sim';
import { GAMEPLAY_TEMPLATES as T } from '@mechbattler/game';
const id = process.argv[2] ?? 'vulture-sniper';
const a = T.find((x) => x.id === id)!;
const r = runBattle({ builds: [structuredClone(a.build), structuredClone(a.build)], seed: 20260730 });
const f = r.frames!;
for (let i = 0; i < Math.min(f.length, 200); i += 2) {
  const fr = f[i]!;
  const m = fr.mechs[0], e = fr.mechs[1];
  const range = Math.hypot(m.x - e.x, m.y - e.y);
  const bearingToEnemy = Math.atan2(e.y - m.y, e.x - m.x) * 57.3;
  console.log('t', fr.tSec.toFixed(2), 'range', range.toFixed(0), 'face', (m.facingRad*57.3).toFixed(0), 'bearingToEnemy', bearingToEnemy.toFixed(0), m.faceMode, 'intent', m.moveIntent, 'w0en', m.weapons[0]?.enabled, m.weapons[0]?.gate);
}
console.log('shots', r.mechs[0].shotsFired, r.mechs[1].shotsFired);
