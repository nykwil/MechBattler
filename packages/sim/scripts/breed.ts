/**
 * `npm run sim:breed` — breed the best mech at each rank on each chassis, then
 * check the three invariants against what it found.
 *
 *   npm run sim:breed -- --locks 1 --budget 40 --ranks 8,12        # smoke, seconds
 *   npm run sim:breed -- --locks 8 --json artifacts/breed.json     # the real sweep
 *
 * This is a "kick it off and come back" tool. One screen is ~0.45 s and the
 * default budget is 600 screens per chassis and rank, so a full sweep is
 * minutes-to-an-hour. Start with `--budget 40` to prove the wiring, then spend.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { cpus } from 'node:os';
import {
  ALL_CELL_KEYS, CHASSIS, checkChassisParity, checkCoverage, checkRankMonotonicity,
  CONFIRM_SEEDS, confirmFitness, confirmNoiseBand, drawLock, panelStamp,
  ranksOfCorrectBuilding, saturationRank,
  type RankResult,
} from '../src/index.js';
import { searchLadderParallel } from '../src/breedParallel.js';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const num = (name: string, fallback: number) => { const v = value(name); return v === undefined ? fallback : Number(v); };

if (flag('--help')) {
  console.log(`Usage: npm run sim:breed -- [options]

Options:
  --locks <n>          how many random gear locks to sweep (default 4)
  --seed <n>           base seed (default 1)
  --ranks <a,b,c>      ranks to breed at (default 6,8,10,12,14,16,18,20)
  --chassis <ids>      comma-separated (default every chassis)
  --budget <n>         screens per chassis/rank (default 600)
  --confirm-seeds <n>  battles per opponent when confirming an elite (default 20).
                       Fewer widens the noise band the report prints; 3 cannot
                       resolve a 5-point difference at all.
  --workers <n>        worker threads for screening (default: cores - 1; 1 = serial)
  --json <path>        write the machine-readable report
`);
  process.exit(0);
}

const locks = num('--locks', 4);
const baseSeed = num('--seed', 1);
const ranks = (value('--ranks') ?? '6,8,10,12,14,16,18,20').split(',').map(Number);
const chassisIds = (value('--chassis') ?? Object.keys(CHASSIS).join(',')).split(',');
const budget = num('--budget', 600);
const confirmSeeds = num('--confirm-seeds', CONFIRM_SEEDS);
const workers = num('--workers', Math.max(1, cpus().length - 1));

const stamp = panelStamp();
const band = confirmNoiseBand(confirmSeeds);
const started = Date.now();
const perLock: { lock: ReturnType<typeof drawLock>; byChassis: Map<string, RankResult[]> }[] = [];

for (let l = 0; l < locks; l++) {
  const lock = drawLock(baseSeed * 7919 + l);
  process.stderr.write(`lock ${l + 1}/${locks}: ${lock.parts.join(' ')} | ${lock.mods.join(' ')}\n`);
  const byChassis = new Map<string, RankResult[]>();
  for (const chassisId of chassisIds) {
    process.stderr.write(`  ${chassisId} `);
    byChassis.set(chassisId, await searchLadderParallel({
      lock, chassisId, ranks, seed: baseSeed + l, budget, workers,
      onRank: (r) => process.stderr.write(r.legalFound === 0 ? '-' : '.'),
    }));
    process.stderr.write('\n');
  }
  perLock.push({ lock, byChassis });
}

// Confirm: the screen was 3 opponents at one seed and is not a number worth
// publishing. Anything that claimed a cell is re-fought on the full roster.
for (const { byChassis } of perLock) {
  for (const results of byChassis.values()) {
    for (const result of results) {
      if (!result.best) continue;
      result.ceiling = confirmFitness(result.best.build, confirmSeeds).overall;
      result.best.fitness = result.ceiling;
    }
  }
}

const allResults = perLock.flatMap((p) => [...p.byChassis.values()].flat());
const allArchives = allResults.map((r) => r.archive);

const i1 = perLock.flatMap((p) => [...p.byChassis.values()].flatMap((rs) => checkRankMonotonicity(rs)));
const i2 = perLock.flatMap((p) => checkChassisParity(p.byChassis));
// Coverage is measured against what the sweep actually offered. Against the
// whole catalog, a narrow sweep reports almost everything as dead content,
// which is true of the experiment and not of the gear.
const offered = new Set(perLock.flatMap((p) => [...p.lock.parts, ...p.lock.mods]));
const i3 = checkCoverage(allArchives, offered);
const saturation = perLock.flatMap((p, l) => [...p.byChassis]
  .map(([chassisId, rs]) => ({ lock: l, chassisId, rank: saturationRank(rs) })));
const ceilings = allResults.map((r) => ({
  chassisId: r.chassisId, rank: r.rank, ceiling: r.ceiling, legalFound: r.legalFound,
}));
const headline = perLock.flatMap((p) => [...p.byChassis]
  .map(([chassisId, rs]) => ({ chassisId, ...ranksOfCorrectBuilding(rs, ranks[0]!) })));

const gallery = perLock.flatMap((p, l) => [...p.byChassis].flatMap(([chassisId, rs]) => rs.flatMap((r) =>
  [...r.archive.cells()].map(([cell, entry]) => ({
    lock: l, chassisId, rank: r.rank, cell,
    fitness: entry.fitness,
    descriptors: entry.descriptors,
    parts: entry.build.parts.map((part) => ({ partId: part.partId, modifiers: part.modifiers })),
  })))));

const report = {
  stamp,
  parameters: { locks, baseSeed, ranks, chassisIds, budget, confirmSeeds, workers },
  noiseBand: band,
  elapsedS: (Date.now() - started) / 1000,
  invariants: { i1, i2, i3: { deadParts: i3.deadParts, deadMods: i3.deadMods, neverOffered: i3.neverOffered } },
  saturation,
  ceilings,
  headline,
  gallery,
  emptyCells: ALL_CELL_KEYS.filter((key) => !allArchives.some((a) => a.cells().has(key))),
  coverage: [...i3.usage].sort((a, b) => b[1] - a[1]),
};

// Written FIRST, and to a path resolved against the repo root rather than the
// npm workspace's own cwd. A sweep is minutes to hours of battles, and the
// first real run of it did all of that work and then died on
// ENOENT writing `artifacts/` -- which resolves inside packages/sim when npm
// runs the script there. Losing an hour to a missing directory is not a thing
// that should be able to happen twice.
const jsonPath = value('--json');
if (jsonPath) {
  const target = resolve(process.env.INIT_CWD ?? process.cwd(), jsonPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(report, null, 2));
  process.stderr.write(`wrote ${target}\n`);
}


const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
console.log(`\nsim:breed — ${locks} lock(s), ${chassisIds.join('/')}, ranks ${ranks.join(',')}, budget ${budget}, ${workers} worker(s)`);
console.log(`content hash ${stamp.contentHash} — results are comparable only while the catalog holds still.`);
console.log('Every ceiling below is the BEST FOUND, not the best that exists. A failing invariant is');
console.log('real evidence; a passing one is only an absence of counter-evidence. Read the failures first.');
console.log(`Seed ${baseSeed}, budget ${budget} and ${workers} worker(s) together identify this experiment: any`);
console.log('fixed set of the three reproduces exactly, and changing any of them searches differently.');
console.log(`\n>> NOISE BAND +/-${(band * 100).toFixed(0)} points, at ${confirmSeeds} seeds x ${stamp.fullPanel.length} opponents.`);
console.log('>> Two ceilings closer together than that are the SAME NUMBER. Do not read a trend');
console.log('>> across them -- a declining curve was once reported out of exactly that mistake');
console.log('>> (docs/17 F6). Raise --confirm-seeds to narrow the band.\n');

console.log('1. INVARIANTS');
const i1Fail = i1.filter((f) => !f.pass);
const i1Mirror = i1.filter((f) => f.mirror);
const i1Real = i1.length - i1Mirror.length;
console.log(`  I1 rank monotonicity   ${i1Real - i1Fail.length}/${i1Real} pass`
  + (i1Mirror.length > 0 ? `  (${i1Mirror.length} pair(s) excluded: same mech at both ranks)` : ''));
for (const f of i1Fail.slice(0, 12)) {
  console.log(`     FAIL ${f.chassisId} rank ${f.highRank} beats rank ${f.lowRank} only ${pct(f.winRate)} (wanted ${pct(f.threshold)})`);
}
const i2Fail = i2.filter((f) => !f.pass);
console.log(`  I2 chassis parity      ${i2.length - i2Fail.length}/${i2.length} pass`);
for (const f of i2Fail.slice(0, 12)) {
  const note = f.spread < band ? '  [WITHIN NOISE — not a finding]' : '';
  console.log(`     FAIL rank ${f.rank}: ${f.best} is ${pct(f.spread)} ahead of ${f.worst}${note}`);
}
const dead = i3.deadParts.length + i3.deadMods.length;
console.log(`  I3 no dead gear        ${dead === 0 ? 'pass' : 'FAIL'}  (of ${offered.size} offered)`);
if (i3.deadParts.length) console.log(`     offered but never wanted — parts: ${i3.deadParts.join(', ')}`);
if (i3.deadMods.length) console.log(`     offered but never wanted — mods:  ${i3.deadMods.join(', ')}`);
if (i3.neverOffered.length) {
  console.log(`     never offered by any lock (a gap in this sweep, not in the gear): ${i3.neverOffered.length} ids`);
  console.log('     widen it with more --locks before reading anything into their absence.');
}

if (i1Mirror.length > 0) {
  console.log('     Saturated pairs — the higher rank found nothing better than the lower:');
  for (const f of i1Mirror.slice(0, 8)) {
    console.log(`       ${f.chassisId} rank ${f.lowRank} and ${f.highRank}: the same mech`);
  }
}

console.log('\n2. SATURATION — where a chassis stops being able to spend');
for (const s of saturation) {
  console.log(`  lock ${s.lock} ${s.chassisId.padEnd(6)} ${s.rank ?? 'still climbing at the top of the range searched'}`);
}

console.log('\n3. CEILING CURVE — does rank mean anything?');
console.log(`  ${'chassis'.padEnd(8)}${ranks.map((r) => String(r).padStart(6)).join('')}`);
for (const chassisId of chassisIds) {
  const row = ranks.map((rank) => {
    const at = ceilings.filter((c) => c.chassisId === chassisId && c.rank === rank && c.legalFound > 0);
    return at.length === 0 ? '    --' : pct(Math.max(...at.map((c) => c.ceiling))).padStart(6);
  }).join('');
  console.log(`  ${chassisId.padEnd(8)}${row}`);
}

console.log('\n4. GALLERY — what each lock supported');
for (const entry of gallery.slice(0, 30)) {
  const guns = entry.parts.filter((p) => p.partId.startsWith('W-'))
    .map((p) => p.partId + (p.modifiers?.length ? `[${p.modifiers.join('+')}]` : '')).join(' ');
  console.log(`  ${entry.chassisId} r${String(entry.rank).padStart(2)} ${entry.cell.padEnd(22)} ${pct(entry.fitness).padStart(4)}  ${entry.descriptors.kill.padEnd(6)} ${guns || '(no guns)'}`);
}
if (gallery.length > 30) console.log(`  ... and ${gallery.length - 30} more (use --json for all of them)`);
if (report.emptyCells.length) console.log(`  never filled anywhere: ${report.emptyCells.join(', ')}`);

console.log('\n5. WHAT IS CORRECT BUILDING WORTH?');
for (const h of headline) {
  console.log(`  ${h.chassisId}: a best-built rank-${ranks[0]} mech falls to a coin flip against rank +${h.k ?? '(never, within the range searched)'}`);
}
console.log('  Both sides are flown by the same autopilot, so this measures correct BUILDING,');
console.log('  not correct PILOTING. A human who kites better than the autopilot is worth more.');
console.log(`\n${(report.elapsedS / 60).toFixed(1)} min.`);
