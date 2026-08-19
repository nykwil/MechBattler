/**
 * Adaptation sweep (docs/05 R10): for every stock matchup outside the 35-65%
 * band, search the fitting-only op catalog for a recovery path. Output labels
 * each bad matchup SOFT (adaptation found) or HARD (no path -- design flag).
 * Run: npm run sim:adapt [seeds]
 */
import { TEMPLATES } from '../src/templates.js';
import { evaluateMatchup, searchAdaptation } from '../src/adaptation.js';
import { MATCHUP_BAND_LOW } from '../src/harness.js';

// Report-only by default (see scripts/balance.ts): balance is a deliberate
// pass, not something feature work should be blocked by. --strict gates it.
const strict = process.argv.includes('--strict');

const seeds = Number(process.argv[2]) || 20;
const started = Date.now();
const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);

let hardCount = 0;
console.log(`Adaptation sweep: fitting-only recovery for sub-${pct(MATCHUP_BAND_LOW)} matchups (${seeds} seeds/eval)\n`);

for (let i = 0; i < TEMPLATES.length; i++) {
  for (let j = 0; j < TEMPLATES.length; j++) {
    if (i === j) continue;
    const self = TEMPLATES[i]!;
    const opponent = TEMPLATES[j]!;
    const stock = evaluateMatchup(self.build, opponent.build, seeds);
    if (stock >= MATCHUP_BAND_LOW) continue;

    const result = searchAdaptation(self.build, opponent.build, { seeds });
    const best = result.best;
    const recovered = best !== null && best.winRate >= MATCHUP_BAND_LOW;
    if (!recovered) hardCount++;
    const label = recovered ? 'SOFT' : 'HARD';
    const fix = best ? `${best.opId} -> ${pct(best.winRate)}` : 'no op improves it';
    console.log(`${label}  ${self.id.padEnd(20)} vs ${opponent.id.padEnd(20)} stock ${pct(stock)}  best: ${fix}`);
  }
}

console.log(`\n${hardCount} HARD matchup(s). ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (hardCount > 0 && strict) process.exitCode = 1;
else if (hardCount > 0) console.log('(report-only — pass --strict to make this fail)');
