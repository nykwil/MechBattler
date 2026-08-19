import { runBalanceHarness } from '../src/index.js';

// Report-only by default (see scripts/balance.ts): balance is a deliberate
// pass, not something feature work should be blocked by. --strict gates it.
const strict = process.argv.includes('--strict');

const seedsPerKit = Math.max(1, Number.parseInt(process.argv[2] ?? '1', 10) || 1);
const result = runBalanceHarness({ seedsPerKit });
console.log(JSON.stringify(result.report, null, 2));
if (!result.report.ok && strict) process.exitCode = 1;
else if (!result.report.ok) console.log('(report-only — pass --strict to make this fail)');
