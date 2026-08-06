import { runBattle, STARTER_TEMPLATES } from '@mechbattler/sim';
import { ladderOpponents, generateRunNodes } from '@mechbattler/game';
const start = STARTER_TEMPLATES.find((t) => t.id === 'mule-needle')!;
const seed = 42;
const nodes = generateRunNodes(seed, 20);
const first = nodes.find((n) => n.kind === 'fight')!;
console.log('opponent count', (first as any).opponents.length);
const opp = (first as any).opponents[0];
console.log('opp name?', opp.name, opp.threat, opp.confirmed);
const r = runBattle({ builds: [structuredClone(start.build), structuredClone(opp.build)], seed: 20260730 });
const f = r.frames!;
for (let i = 0; i < Math.min(f.length, 100); i += 4) {
  const fr = f[i]!;
  const m = fr.mechs[0], e = fr.mechs[1];
  const range = Math.hypot(m.x - e.x, m.y - e.y);
  console.log('t', fr.tSec.toFixed(2), 'pos', m.x.toFixed(0), m.y.toFixed(0), 'range', range.toFixed(0), 'face', (m.facingRad*57.3).toFixed(0), m.faceMode, 'intent', m.moveIntent, 'w0', m.weapons[0]?.enabled, m.weapons[0]?.gate, 'eShots?', e.weapons.map((w:any)=>w.enabled).join(','));
}
console.log('shots', r.mechs[0].shotsFired, r.mechs[1].shotsFired);
