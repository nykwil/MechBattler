import { runBalanceHarness } from '../src/index.js';

const seedsPerKit = Math.max(1, Number.parseInt(process.argv[2] ?? '1', 10) || 1);
const recoveryPolicy = process.argv.includes('--recover-larger') ? 'larger-affordable' as const : 'never' as const;
const result = runBalanceHarness({ seedsPerKit, recoveryPolicy });
console.log(JSON.stringify(result.report, null, 2));
if (!result.report.ok) process.exitCode = 1;
