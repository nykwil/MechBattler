/**
 * `npm run sim:try` — assemble a mech from a one-line wish, then fight it.
 *
 * The loop this exists for: you have a new part (or a unique, or a mod) and you
 * want to know what it is like to build around. Twenty variations, seconds
 * each, no source file edited and no four-minute cohort.
 *
 *   npm run sim:try -- CH-5 W-AC:2 R-C40
 *   npm run sim:try -- CH-5 W-AC --unique assize --seeds 10
 *   npm run sim:try -- CH-2 W-CB:2 --mod W-CB:cold-bore --budget 14
 *   npm run sim:try -- CH-9 W-BR:2 --no-armour --json
 *
 * Parts are `PART-ID[:count]`. Everything else is completed for you: a reactor
 * that covers the measured draw, radiators that cover the measured heat, free
 * routing, then armour in whatever cells are left.
 */
import {
  CHASSIS,
  PARTS,
  UNIQUES,
  assembleBuild,
  evaluateBuild,
  formatBuildTrial,
  type BuildWish,
  type WishPart,
} from '../src/index.js';

const argv = process.argv.slice(2);

if (argv.length === 0 || argv.includes('--help')) {
  console.log(`Usage: npm run sim:try -- <CHASSIS> <PART[:count]>... [options]

Options:
  --unique <id>          fit a named unique (its own part id is implied)
  --mod <PART>:<modId>   stamp a modifier on every copy of that part
  --seeds <n>            battles per opponent (default 6)
  --budget <tiers>       cap what completion may spend
  --no-complete          place only what is named; no reactor, cooling or routing
  --no-armour            complete the fit but leave the spare cells empty
  --no-fight             assemble and report, but skip the matchups
  --json                 machine-readable output

Chassis: ${Object.keys(CHASSIS).join(', ')}
Uniques: ${Object.keys(UNIQUES).join(', ')}`);
  process.exit(0);
}

const flag = (name: string) => argv.includes(name);
const value = (name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const values = (name: string): string[] => {
  const found: string[] = [];
  argv.forEach((arg, index) => { if (arg === name && argv[index + 1]) found.push(argv[index + 1]!); });
  return found;
};

const optionNames = new Set(['--unique', '--mod', '--seeds', '--budget']);
const positional = argv.filter((arg, index) => {
  if (arg.startsWith('--')) return false;
  const previous = argv[index - 1];
  return !(previous && optionNames.has(previous));
});

const chassisId = positional[0];
if (!chassisId || !CHASSIS[chassisId]) {
  console.error(`Unknown chassis ${chassisId ?? '(none)'}. Known: ${Object.keys(CHASSIS).join(', ')}`);
  process.exit(1);
}

const modsByPart = new Map<string, string[]>();
for (const spec of values('--mod')) {
  const [partId, modId] = spec.split(':');
  if (!partId || !modId) {
    console.error(`--mod wants PART:modifier, got "${spec}"`);
    process.exit(1);
  }
  modsByPart.set(partId, [...(modsByPart.get(partId) ?? []), modId]);
}

const parts: WishPart[] = [];
for (const token of positional.slice(1)) {
  const [partId, countText] = token.split(':');
  if (!partId || !PARTS[partId]) {
    console.error(`Unknown part ${partId}. Try one of: ${Object.keys(PARTS).join(', ')}`);
    process.exit(1);
  }
  const count = countText ? Number(countText) : 1;
  if (!Number.isFinite(count) || count < 1) {
    console.error(`Bad count in "${token}"`);
    process.exit(1);
  }
  parts.push({ partId, count, modifiers: modsByPart.get(partId) });
}

for (const uniqueId of values('--unique')) {
  const unique = UNIQUES[uniqueId];
  if (!unique) {
    console.error(`Unknown unique ${uniqueId}. Known: ${Object.keys(UNIQUES).join(', ')}`);
    process.exit(1);
  }
  // A named unique is placed first: it is the thing being tested, so it gets
  // first pick of cells rather than whatever is left after the filler.
  parts.unshift({ partId: unique.partId, count: 1, unique: uniqueId });
}

if (parts.length === 0) {
  console.error('Name at least one part, or a --unique.');
  process.exit(1);
}

const wish: BuildWish = {
  chassisId,
  parts,
  complete: !flag('--no-complete'),
  fillArmour: !flag('--no-armour'),
  budget: value('--budget') ? Number(value('--budget')) : undefined,
};

const assembly = assembleBuild(wish);
const verdict = assembly.legal && !flag('--no-fight')
  ? evaluateBuild(assembly.build, { seeds: value('--seeds') ? Number(value('--seeds')) : undefined })
  : undefined;

if (flag('--json')) {
  console.log(JSON.stringify({ wish, assembly, verdict }, null, 2));
} else {
  console.log(formatBuildTrial(assembly, verdict));
}
