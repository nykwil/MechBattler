import { runBattle } from '@mechbattler/sim';
import { GAMEPLAY_TEMPLATES as T } from '@mechbattler/game';
const a = T.find((x) => x.id === 'mule-needle')!;
const r = runBattle({ builds: [structuredClone(a.build), structuredClone(a.build)], seed: 20260730 });
const f = r.frames!;
for (let i = 0; i < Math.min(f.length, 60); i += 2) {
  const fr = f[i]!;
  const m = fr.mechs[0], e = fr.mechs[1];
  console.log('t', fr.tSec.toFixed(2), 'pos', m.x.toFixed(1), m.y.toFixed(1), 'face', (m.facingRad*57.3).toFixed(0), m.faceMode, 'intent', m.moveIntent, 'dest', m.dest ? `${m.dest.x.toFixed(0)},${m.dest.y.toFixed(0)}` : 'null');
}
