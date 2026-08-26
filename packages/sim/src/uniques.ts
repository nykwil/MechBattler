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
 * modifier rarity and pricing.
 */
import type { PlacedPart } from './types.js';
import { getPart } from './catalog.js';
import { MODIFIERS, type ModifierRarity } from './modifiers.js';

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
  /** How scarce it is where uniques are handed out. */
  rarity: ModifierRarity;
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
    rarity: 'rare',
  },
  'fell-ford-widow': {
    id: 'fell-ford-widow', name: 'Widow of Fell Ford', partId: 'W-BR',
    modifierId: 'ram-bore',
    quirkIds: ['overvolted'],
    variant: { damage: 1.12, hp: 0.85 },
    blurb: 'Bored out after the ford was lost, by a town that had decided never to be pushed off it again.',
    rarity: 'rare',
  },
  'kiln-sister': {
    id: 'kiln-sister', name: 'Kiln Sister', partId: 'W-LAS',
    modifierId: 'fever-cycle',
    quirkIds: ['heat-loose'],
    variant: { cycleS: 0.92, hp: 0.9 },
    blurb: 'Salvaged from a pottery works and never really retired from it. It wants to be hot.',
    rarity: 'uncommon',
  },
  'tidewarden': {
    id: 'tidewarden', name: 'Tidewarden', partId: 'U-RAD',
    modifierId: 'tidecooler',
    quirkIds: ['cold-soaked'],
    variant: { hp: 1.2 },
    blurb: 'River-Claim plate, cast thick and slow. Wade with it and it will hold your whole build together.',
    rarity: 'uncommon',
  },
  'long-argument': {
    id: 'long-argument', name: 'The Long Argument', partId: 'W-RG',
    modifierId: 'surge-gate',
    quirkIds: ['lucky'],
    variant: { dispersionMrad: 0.88, cycleS: 1.1 },
    blurb: 'Wired to speak whatever else is browning out, because its owners were tired of being interrupted.',
    rarity: 'rare',
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
