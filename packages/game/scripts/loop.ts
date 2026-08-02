import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  runProgressionCohort,
  type ProgressionPolicyId,
  type ProgressionProfileId,
} from '../src/index.js';

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseSeeds(raw: string | undefined): number[] {
  if (!raw) return [73001];
  if (raw.includes(',')) {
    const seeds = raw.split(',').map((value) => Number.parseInt(value, 10)).filter(Number.isFinite);
    if (seeds.length === 0) throw new Error('--seeds requires integers');
    return seeds;
  }
  const count = Number.parseInt(raw, 10);
  if (!Number.isFinite(count) || count < 1) throw new Error('--seeds requires a positive count or comma-separated seed list');
  return Array.from({ length: count }, (_, index) => 73001 + index * 997);
}

function selection<T extends string>(raw: string | undefined, allowed: readonly T[], label: string): T[] | undefined {
  if (!raw || raw === 'all' || raw === 'both') return undefined;
  const values = raw.split(',') as T[];
  const invalid = values.filter((value) => !allowed.includes(value));
  if (invalid.length > 0) throw new Error(`${label} must be one of ${allowed.join(', ')}, or all`);
  return values;
}

if (process.argv.includes('--help')) {
  console.log(`Usage: npm run game:loop -- [options]

  --seeds N|A,B       Number of deterministic seeds, or explicit seed values (default 1)
  --battles N         Resolved battles per case (default 8)
  --profile VALUE     fresh, one-hour, or both (default both)
  --policy VALUE      survival, range, thermal, armor, or all (default all)
  --json PATH         Also write the full JSON report to PATH`);
  process.exit(0);
}

const profiles = selection(
  valueAfter('--profile'),
  ['fresh', 'one-hour'] as const,
  '--profile',
) as ProgressionProfileId[] | undefined;
const policies = selection(
  valueAfter('--policy'),
  ['survival', 'range', 'thermal', 'armor'] as const,
  '--policy',
) as ProgressionPolicyId[] | undefined;
const battlesRaw = valueAfter('--battles');
const battles = battlesRaw ? Number.parseInt(battlesRaw, 10) : undefined;
if (battles !== undefined && (!Number.isFinite(battles) || battles < 1)) {
  throw new Error('--battles requires a positive integer');
}

const report = runProgressionCohort({
  seeds: parseSeeds(valueAfter('--seeds')),
  battles,
  profiles,
  policies,
});
const json = JSON.stringify(report, null, 2);
const jsonPath = valueAfter('--json');
if (jsonPath) {
  const absolute = resolve(jsonPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${json}\n`);
}
console.log(json);
if (!report.ok) process.exitCode = 1;
