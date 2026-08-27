/**
 * `npm run sim:compare` — two builds side by side on all four descriptors,
 * their part and mod overlap, and one distance number.
 *
 *   npm run sim:compare -- CH-5 W-AC:2 -- CH-9 W-BR:2
 *   npm run sim:compare -- CH-2 W-CB:2 -- CH-2 W-CB:2 --mod W-CB:cold-bore --fight
 *
 * Each side takes the same wish syntax as `sim:try`. A bare `--` separates
 * them. For answering "is this new gun actually different from that one".
 */
import {
  PARTS, assembleBuild, bestVsBest, computeRank, describeBuild, descriptorDistance,
  type WishPart,
} from '../src/index.js';

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
if (argv.includes('--help') || split < 0) {
  console.log(`Usage: npm run sim:compare -- <CHASSIS> <PART[:count]>... -- <CHASSIS> <PART[:count]>... [options]

Options:
  --mod <PART>:<modId>   stamp a modifier on every copy of that part (per side)
  --fight                also fight them head to head, every spawn distance, both sides
`);
  process.exit(argv.includes('--help') ? 0 : 1);
}

const parseSide = (tokens: string[]) => {
  const mods = new Map<string, string[]>();
  const positional: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '--mod') {
      const [partId, modId] = (tokens[++i] ?? '').split(':');
      if (partId && modId) mods.set(partId, [...(mods.get(partId) ?? []), modId]);
    } else if (!tokens[i]!.startsWith('--')) positional.push(tokens[i]!);
  }
  const chassisId = positional[0];
  if (!chassisId) { console.error('Each side needs a chassis.'); process.exit(1); }
  const parts: WishPart[] = positional.slice(1).map((token) => {
    const [partId, count] = token.split(':');
    if (!partId || !PARTS[partId]) { console.error(`Unknown part ${partId}`); process.exit(1); }
    return { partId, count: count ? Number(count) : 1, modifiers: mods.get(partId) };
  });
  return assembleBuild({ chassisId, parts });
};

const left = parseSide(argv.slice(0, split));
const right = parseSide(argv.slice(split + 1));
const dl = describeBuild(left.build);
const dr = describeBuild(right.build);

const partIds = (r: typeof left) => new Set(r.build.parts.map((p) => p.partId));
const modIds = (r: typeof left) => new Set(r.build.parts.flatMap((p) => p.modifiers ?? []));
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((id) => b.has(id));
const row = (label: string, l: string, r: string) => console.log(`  ${label.padEnd(11)} ${l.padEnd(24)} ${r}`);

console.log(`\n  ${''.padEnd(11)} ${left.build.chassisId.padEnd(24)} ${right.build.chassisId}`);
row('rank', String(computeRank(left.build)), String(computeRank(right.build)));
row('range', `${dl.rangeM.toFixed(0)} m (${dl.range})`, `${dr.rangeM.toFixed(0)} m (${dr.range})`);
row('weight', `${dl.loadFactor.toFixed(2)} (${dl.weight})`, `${dr.loadFactor.toFixed(2)} (${dr.weight})`);
row('heat', `${dl.heatMarginKw.toFixed(1)} kW (${dl.heat})`, `${dr.heatMarginKw.toFixed(1)} kW (${dr.heat})`);
row('kills by', dl.kill, dr.kill);

const sharedParts = overlap(partIds(left), partIds(right));
const sharedMods = overlap(modIds(left), modIds(right));
console.log(`\n  shared parts: ${sharedParts.length ? sharedParts.join(', ') : 'none'}`);
console.log(`  shared mods:  ${sharedMods.length ? sharedMods.join(', ') : 'none'}`);
console.log(`\n  distance ${descriptorDistance(dl, dr).toFixed(2)}  (0 = the same mech, 1 = nothing in common)`);

for (const [side, report] of [['left', left], ['right', right]] as const) {
  if (!report.legal) console.log(`  ${side} cannot launch: ${report.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; ')}`);
}

if (argv.includes('--fight') && left.legal && right.legal) {
  const rate = bestVsBest(left.build, right.build, 2);
  console.log(`  head to head: left wins ${(rate * 100).toFixed(0)}% across every spawn distance, both sides`);
}
