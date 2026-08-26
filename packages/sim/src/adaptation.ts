/**
 * Adaptation search: the harness-side proof of the game's core promise --
 * a bad matchup is fixed by REFITTING, never by rebuilding.
 *
 * Definitions (docs/05 R10):
 *  - A build's KEYSTONES are its chassis, weapons, and reactors -- the
 *    identity kernel a player commits to across a run.
 *  - Everything else (armor, cooling, conduits, capacitors, utility) is the
 *    FITTING -- the cheap layer adjusted between fights off the intel card.
 *  - An adaptation op mutates only the fitting (and the brownout priority).
 *
 * searchAdaptation() tries each op against a specific opponent and reports
 * which (if any) recovers a losing matchup -- automating the "read intel,
 * adjust the build" loop so matchup softness becomes a measured property.
 */
import type { Build } from './types.js';
import { getPart } from './catalog.js';
import { placeParts, type PlaceOptions } from './assembly.js';
import { runBattle } from './combat.js';

export const KEYSTONE_CATEGORIES = new Set(['weapon', 'reactor']);

export function isKeystone(partId: string): boolean {
  return KEYSTONE_CATEGORIES.has(getPart(partId).category);
}

export interface AdaptationOp {
  id: string;
  describe: string;
  /** Returns the modified build, or null when the op doesn't apply (no room, nothing to remove...). */
  apply(build: Build): Build | null;
}

/**
 * Fitting-search wrapper over the shared placer: an op either applies fully
 * enough to be worth reporting, or it does not apply at all.
 */
function addParts(build: Build, partId: string, count: number, opts: PlaceOptions = {}): Build | null {
  const { build: next, placed } = placeParts(build, partId, count, opts);
  return placed === 0 ? null : next;
}

function removeParts(build: Build, partId: string): Build | null {
  const removed = build.parts.filter((p) => p.partId === partId);
  if (removed.length === 0) return null;
  const removedIds = new Set(removed.map((p) => p.instanceId));
  return {
    ...build,
    parts: build.parts.filter((p) => !removedIds.has(p.instanceId)),
    powerPriority: build.powerPriority.filter((id) => !removedIds.has(id)),
  };
}

/** The standard fitting-layer op catalog. Keystones are never touched. */
export function standardOps(): AdaptationOp[] {
  return [
    { id: 'armor-front-2', describe: 'add 2 armor plates, front rows first', apply: (b) => addParts(b, 'U-ARM', 2, { frontFirst: true }) },
    { id: 'armor-front-4', describe: 'add 4 armor plates, front rows first', apply: (b) => addParts(b, 'U-ARM', 4, { frontFirst: true }) },
    { id: 'strip-armor', describe: 'remove all armor (lighter -> faster)', apply: (b) => removeParts(b, 'U-ARM') },
    { id: 'add-tc', describe: 'add a targeting computer (counter-strafe)', apply: (b) => addParts(b, 'U-TC1', 1, { requireConnected: true }) },
    { id: 'add-heatsink-2', describe: 'add 2 heat sinks (burst thermal buffer)', apply: (b) => addParts(b, 'U-HS', 2) },
    { id: 'add-radiator', describe: 'add a radiator (sustained cooling)', apply: (b) => addParts(b, 'U-RAD', 1) },
    { id: 'add-cap', describe: 'add a capacitor (brownout shock absorber)', apply: (b) => addParts(b, 'P-CAP', 1, { requireConnected: true }) },
    {
      id: 'guns-first',
      describe: 'brownout priority: weapons above locomotion',
      apply: (b) => {
        const weapons = b.powerPriority.filter((id) => b.parts.some((p) => p.instanceId === id && getPart(p.partId).category === 'weapon'));
        if (weapons.length === 0) return null;
        const rest = b.powerPriority.filter((id) => !weapons.includes(id));
        const next = [...weapons, ...rest];
        return next.join() === b.powerPriority.join() ? null : { ...b, powerPriority: next };
      },
    },
  ];
}

/** Win rate of `self` vs `opponent`, spawn-side balanced. */
export function evaluateMatchup(self: Build, opponent: Build, seeds: number, baseSeed = 9000): number {
  let wins = 0;
  for (let s = 0; s < seeds; s++) {
    const flip = s % 2 === 1;
    const r = runBattle({ builds: flip ? [opponent, self] : [self, opponent], seed: baseSeed + s, recordFrames: false });
    if (r.winner !== 'draw' && (r.winner === 0) === !flip) wins++;
  }
  return wins / seeds;
}

export interface AdaptationResult {
  stockWinRate: number;
  attempts: { opId: string; describe: string; winRate: number }[];
  /** Best op found, or null when no op improved on stock. */
  best: { opId: string; describe: string; winRate: number } | null;
}

/**
 * Tries every applicable fitting op for `loser` against `opponent`.
 * `seeds` battles per evaluation; deterministic for a given baseSeed.
 */
export function searchAdaptation(
  loser: Build,
  opponent: Build,
  options: { seeds?: number; ops?: AdaptationOp[]; baseSeed?: number } = {},
): AdaptationResult {
  const seeds = options.seeds ?? 20;
  const ops = options.ops ?? standardOps();
  const baseSeed = options.baseSeed ?? 9000;

  const stockWinRate = evaluateMatchup(loser, opponent, seeds, baseSeed);
  const attempts: AdaptationResult['attempts'] = [];
  for (const op of ops) {
    const modified = op.apply(loser);
    if (!modified) continue;
    attempts.push({ opId: op.id, describe: op.describe, winRate: evaluateMatchup(modified, opponent, seeds, baseSeed) });
  }
  attempts.sort((a, b) => b.winRate - a.winRate);
  const top = attempts[0];
  return {
    stockWinRate,
    attempts,
    best: top && top.winRate > stockWinRate ? top : null,
  };
}
