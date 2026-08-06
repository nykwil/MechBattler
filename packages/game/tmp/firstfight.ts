import { ladderOpponents } from './src/nodes.js';
import { STARTER_TEMPLATES } from '@mechbattler/sim';
const start = STARTER_TEMPLATES.find((t) => t.id === 'mule-needle')!;
console.log('start build parts', start.build.parts.map((p: any) => p.partId));
const opps = ladderOpponents({ seed: 1, node: 1, playerBudget: 14 });
console.log(JSON.stringify(opps, null, 1).slice(0, 800));
