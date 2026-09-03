import { assembleBuild, runBattle, TEMPLATES } from '../packages/sim/src/index.js';
const r = assembleBuild({ chassisId: 'CH-5', parts: [{ partId: 'W-KL', count: 2 }] });
const rep = runBattle({ builds: [r.build, TEMPLATES[0].build], seed: 1 });
const m = (rep.frames.at(-5) as any).mechs[0];
console.log('mech frame keys:', Object.keys(m));
for (const k of Object.keys(m)) { const v = (m as any)[k]; if (Array.isArray(v) && v.length && typeof v[0] === 'object') console.log(' array', k, '->', Object.keys(v[0])); }
