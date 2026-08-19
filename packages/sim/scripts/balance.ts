/**
 * Balance harness CLI (docs/05 R4). Run from the repo root:
 *   npm run sim:balance                      (20 seeds/pair, report-only)
 *   npm run sim:balance -- 50                (custom seeds/pair)
 *   npm run sim:balance -- --json out.json   (machine-readable, for the report)
 *   npm run sim:balance -- --strict          (exit 1 on a flagged template)
 *
 * Report-only by default. Balance is worked on deliberately, in its own pass;
 * a red exit code during feature work is noise that trains people to ignore it,
 * and `verify:balance` already discards the status. `--strict` is there for
 * when you ARE balancing and want the gate back.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { TEMPLATES } from '../src/templates.js';
import { runRoundRobin, formatRoundRobin, analyzeRoundRobin } from '../src/harness.js';
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
const seedsPerPair = Number(args.find((a) => /^\d+$/.test(a))) || 20;

const started = Date.now();
const report = runRoundRobin(TEMPLATES, { seedsPerPair });
console.log(formatRoundRobin(report, TEMPLATES));
console.log(`\n${report.battles} battles in ${((Date.now() - started) / 1000).toFixed(1)}s`);

if (wantsJson) {
  const out = outPath(jsonAt!);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({
    schemaVersion: 1,
    kind: 'sim-balance-round-robin',
    simVersion: SIM_VERSION,
    contentHash: simContentHash(),
    seedsPerPair,
    battles: report.battles,
    generatedAt: new Date().toISOString(),
    standings: report.standings,
    matchups: report.matchups,
    flagged: report.flagged,
    summary: analyzeRoundRobin(report),
  }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}

if (report.flagged.length > 0) {
  console.log(`\n${report.flagged.length} template(s) over the 70% kill criterion: ${report.flagged.join(', ')}`);
  if (strict) process.exitCode = 1;
  else console.log('(report-only — pass --strict to make this fail)');
}
