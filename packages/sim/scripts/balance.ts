/**
 * Balance harness CLI (docs/05 R4). Run from the repo root:
 *   npm run sim:balance            (20 seeds/pair)
 *   npm run sim:balance -- 50      (custom seeds/pair)
 */
import { TEMPLATES } from '../src/templates.js';
import { runRoundRobin, formatRoundRobin } from '../src/harness.js';

const seedsPerPair = Number(process.argv[2]) || 20;
const started = Date.now();
const report = runRoundRobin(TEMPLATES, { seedsPerPair });
console.log(formatRoundRobin(report, TEMPLATES));
console.log(`\n${report.battles} battles in ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (report.flagged.length > 0) process.exitCode = 1;
