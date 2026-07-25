import { createPristineDepthCheckpoints } from '../src/index.js';

const seedsPerKit = Math.max(1, Number.parseInt(process.argv[2] ?? '1', 10) || 1);
const checkpoints = createPristineDepthCheckpoints({ seedsPerKit });
console.log(JSON.stringify({
  schemaVersion: 1,
  kind: 'pristine-depth-checkpoint-corpus',
  checkpoints,
}, null, 2));
