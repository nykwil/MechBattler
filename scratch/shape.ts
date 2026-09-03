import { assembleBuild, runBattle, TEMPLATES } from '../packages/sim/src/index.js';
const rep = runBattle({ builds: [TEMPLATES[0].build, TEMPLATES[1].build], seed: 1 });
console.log('frame keys:', Object.keys(rep.frames[0]));
console.log('mech keys :', Object.keys((rep.frames[0] as any).mechs[0]));
