import { runBalanceHarness } from '../src/index.js';

const seedsPerKit = Math.max(1, Number.parseInt(process.argv[2] ?? '1', 10) || 1);
const result = runBalanceHarness({ seedsPerKit });
console.log(JSON.stringify(result.report, null, 2));
if (!result.report.ok) process.exitCode = 1;
