/**
 * Build-diversity and perk stress CLI. Report-only by default, for the reason
 * in `balance.ts`: balance is a deliberate pass, not something feature work
 * should be interrupted by. `--strict` restores the gate.
 *
 *   npm run sim:diversity                     (5 seeds)
 *   npm run sim:diversity -- --json out.json
 *   npm run sim:diversity -- --strict
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { formatDiversityReport, runPerkStress } from '../src/diversity.js';
import { SIM_VERSION, simContentHash } from '../src/version.js';

/**
 * Resolve --json against the repo root, not the cwd. npm runs workspace
 * scripts from packages/sim, so a relative path meant "artifacts/x.json" at
 * the root and silently landed in packages/sim/artifacts instead.
 */
const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const outPath = (p: string) => (p.startsWith('/') ? p : resolve(REPO_ROOT, p));

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const jsonAt = args[args.indexOf('--json') + 1];
const wantsJson = args.includes('--json') && jsonAt !== undefined && !jsonAt.startsWith('--');
const seeds = Number(args.find((a) => /^\d+$/.test(a))) || 5;

const started = Date.now();
const result = runPerkStress(seeds);
console.log(formatDiversityReport(result));
console.log(`\n${((Date.now() - started) / 1000).toFixed(1)}s`);

if (wantsJson) {
  const out = outPath(jsonAt!);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({
    schemaVersion: 1,
    kind: 'sim-perk-stress',
    simVersion: SIM_VERSION,
    contentHash: simContentHash(),
    seeds,
    generatedAt: new Date().toISOString(),
    ...result,
  }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}

const problems = [
  ...result.dominantCombinations.map((id) => `dominant combination: ${id}`),
  ...result.deadPerks.map((id) => `dead perk: ${id}`),
  ...(result.stackingRejection.length === 0 ? ['stacking limits rejected nothing'] : []),
];
if (problems.length > 0) {
  console.log(`\n${problems.length} finding(s):\n  ${problems.join('\n  ')}`);
  if (strict) process.exitCode = 1;
  else console.log('(report-only — pass --strict to make this fail)');
}
