import { readFileSync } from 'node:fs';
import {
  createPristineDepthCheckpoints,
  runCheckpointMatchHarness,
  type RunCheckpoint,
} from '../src/index.js';

const argument = process.argv[2];
let checkpoints: RunCheckpoint[];
if (argument && !/^\d+$/.test(argument)) {
  const parsed = JSON.parse(readFileSync(argument, 'utf8')) as
    | RunCheckpoint[]
    | { checkpoints: RunCheckpoint[] };
  checkpoints = Array.isArray(parsed) ? parsed : parsed.checkpoints;
} else {
  const seedsPerKit = Math.max(1, Number.parseInt(argument ?? '1', 10) || 1);
  checkpoints = createPristineDepthCheckpoints({ seedsPerKit });
}
const result = runCheckpointMatchHarness(checkpoints);
console.log(JSON.stringify(result.report, null, 2));
if (!result.report.ok) process.exitCode = 1;
