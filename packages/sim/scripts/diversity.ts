import { formatDiversityReport, runPerkStress } from '../src/diversity.js';

const seeds = Number(process.argv[2]) || 5;
const started = Date.now();
const result = runPerkStress(seeds);
console.log(formatDiversityReport(result));
console.log(`\n${((Date.now() - started) / 1000).toFixed(1)}s`);
if (result.dominantCombinations.length > 0 || result.deadPerks.length > 0 || result.stackingRejection.length === 0) {
  process.exitCode = 1;
}
