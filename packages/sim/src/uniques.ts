/**
 * Uniques (docs/04 §4b): named pieces of legendary metal.
 *
 * A unique is **not a new rule**. It is one ordinary part carrying one mod, an
 * extreme variant roll and some quirks — every one of which the substrate
 * already resolves — pre-rolled together and given a proper name and a
 * provenance. That was the standing lean in 04 §4b and it is now the decision:
 * a unique is legendary metal, not rules text. It follows that a unique is
 * legal under the same rules as anything else (one mod per part, quirks on
 * top), that nothing in combat has to know it exists, and that authoring one is
 * naming and numbers rather than plumbing.
 *
 * Because a dropped unique writes its modifiers and variant onto the part
 * instance, a battle is fully determined by the build. Uniques are therefore
 * acquisition content and deliberately outside `simContentHash()`, alongside
 * a mod's tier.
 */
import type { PlacedPart } from './types.js';
import { getPart } from './catalog.js';
import { MODIFIERS } from './modifiers.js';

export interface UniqueDef {
  id: string;
  /** The proper name the part wears once it is this one. */
  name: string;
  /** The ordinary catalog part underneath. */
  partId: string;
  /** Its single mod — the standing one-mod-per-part rule applies to uniques too. */
  modifierId: string;
  /** Quirks pre-rolled onto it. Pair a gift with something that costs. */
  quirkIds: string[];
  /** The extreme variant roll: multipliers on the stats variants already bend. */
  variant: NonNullable<PlacedPart['variant']>;
  /** Where it came from and why it is like this. One line, on the card. */
  blurb: string;
  /**
   * How scarce it is where uniques are handed out, on the same scale as a
   * mod's tier: the draw weight is `2 ^ (1 - tier)` at that roll site too.
   */
  tier: number;
}

/**
 * The registry. Every entry pairs what it gives with something it costs — a
 * unique that is only better than its stock part is a reward, not an identity,
 * and identity is the whole point of the layer.
 */
export const UNIQUES: Record<string, UniqueDef> = {
  'assize': {
    id: 'assize', name: 'Assize', partId: 'W-AC',
    modifierId: 'cold-bore',
    quirkIds: ['cold-blooded'],
    variant: { damage: 1.1, hp: 0.9 },
    blurb: 'A court gun kept in an unheated vault between hearings. It argues best on the first word.',
    tier: 3,
  },
  'fell-ford-widow': {
    id: 'fell-ford-widow', name: 'Widow of Fell Ford', partId: 'W-BR',
    modifierId: 'ram-bore',
    quirkIds: ['overvolted'],
    variant: { damage: 1.12, hp: 0.85 },
    blurb: 'Bored out after the ford was lost, by a town that had decided never to be pushed off it again.',
    tier: 3,
  },
  'kiln-sister': {
    id: 'kiln-sister', name: 'Kiln Sister', partId: 'W-LAS',
    modifierId: 'fever-cycle',
    quirkIds: ['heat-loose'],
    variant: { cycleS: 0.92, hp: 0.9 },
    blurb: 'Salvaged from a pottery works and never really retired from it. It wants to be hot.',
    tier: 2,
  },
  'tidewarden': {
    id: 'tidewarden', name: 'Tidewarden', partId: 'U-RAD',
    modifierId: 'tidecooler',
    quirkIds: ['cold-soaked'],
    variant: { hp: 1.2 },
    blurb: 'River-Claim plate, cast thick and slow. Wade with it and it will hold your whole build together.',
    tier: 2,
  },
  'long-argument': {
    id: 'long-argument', name: 'The Long Argument', partId: 'W-RG',
    modifierId: 'surge-gate',
    quirkIds: ['lucky'],
    variant: { dispersionMrad: 0.88, cycleS: 1.1 },
    blurb: 'Wired to speak whatever else is browning out, because its owners were tired of being interrupted.',
    tier: 3,
  },
};

/** Uniques that can appear on a given part, if any. */
export function uniquesForPart(partId: string): UniqueDef[] {
  return Object.values(UNIQUES).filter((unique) => unique.partId === partId);
}

/**
 * Stamp a unique onto a placed part. Overwrites modifiers and variant rather
 * than merging: a unique *is* the roll, so nothing it inherited can survive to
 * break the one-mod-per-part rule.
 */
export function applyUnique<T extends PlacedPart>(placed: T, unique: UniqueDef): T {
  return {
    ...placed,
    modifiers: [unique.modifierId, ...unique.quirkIds],
    variant: { ...unique.variant },
  };
}

/**
 * Recognise a unique from what a part instance actually carries.
 *
 * Derived rather than stamped: an explicit `uniqueId` field would have to
 * survive every mapping between `PlacedPart`, `PartInstance` and
 * `SalvageCandidate`, several of which copy fields one at a time, and a missed
 * one would silently anonymise the piece with nothing to catch it. A unique is
 * exactly its mod, its quirks and its variant, so those *are* the identity.
 *
 * A random roll reproducing all three is not a false positive worth guarding
 * against — a variant multiplier alone is one of dozens of values on one of
 * four stats, and it would have to land beside the right mod and the right
 * quirks. If it ever did, the part genuinely is that piece of metal.
 */
export function identifyUnique(placed: {
  partId: string;
  modifiers?: string[];
  variant?: PlacedPart['variant'];
}): UniqueDef | undefined {
  const carried = new Set(placed.modifiers ?? []);
  return Object.values(UNIQUES).find((unique) => {
    if (unique.partId !== placed.partId) return false;
    if (carried.size !== unique.quirkIds.length + 1) return false;
    if (!carried.has(unique.modifierId)) return false;
    if (!unique.quirkIds.every((id) => carried.has(id))) return false;
    const variant = placed.variant ?? {};
    const keys = new Set([...Object.keys(unique.variant), ...Object.keys(variant)]);
    for (const key of keys) {
      const want = unique.variant[key as keyof typeof unique.variant];
      const has = variant[key as keyof typeof variant];
      if (want === undefined || has === undefined || Math.abs(want - has) > 1e-6) return false;
    }
    return true;
  });
}

export interface UniqueIssue {
  uniqueId: string;
  message: string;
}

/**
 * Content validity for the table, in the shape `game:audit` consumes. Every
 * check here is one a generated unique can plausibly fail: a part that does not
 * exist, a mod that cannot legally ride it, more than one mod, or a quirk
 * misfiled as a mod.
 */
export function auditUniques(): UniqueIssue[] {
  const issues: UniqueIssue[] = [];
  for (const unique of Object.values(UNIQUES)) {
    const def = getPart(unique.partId);
    if (!def) {
      issues.push({ uniqueId: unique.id, message: `names unknown part ${unique.partId}` });
      continue;
    }
    const mod = MODIFIERS[unique.modifierId];
    if (!mod) issues.push({ uniqueId: unique.id, message: `names unknown modifier ${unique.modifierId}` });
    else if (mod.kind !== 'mod') issues.push({ uniqueId: unique.id, message: `${mod.id} is a ${mod.kind}, not a mod` });
    else if (!mod.appliesTo(def)) issues.push({ uniqueId: unique.id, message: `${mod.id} cannot ride ${unique.partId}` });
    for (const quirkId of unique.quirkIds) {
      const quirk = MODIFIERS[quirkId];
      if (!quirk) issues.push({ uniqueId: unique.id, message: `names unknown quirk ${quirkId}` });
      else if (quirk.kind === 'mod') issues.push({ uniqueId: unique.id, message: `${quirk.id} is a mod, not a quirk — a part may carry only one mod` });
      else if (!quirk.appliesTo(def)) issues.push({ uniqueId: unique.id, message: `${quirk.id} cannot ride ${unique.partId}` });
    }
  }
  return issues;
}
