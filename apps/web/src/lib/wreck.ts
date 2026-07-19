/**
 * Wreck salvage math (docs/04 §2): after a win, the enemy wreck is read as
 * its actual chassis grid. Destroyed parts auto-scrap; intact parts loot at
 * integrity = 1 − damage taken − seeded extraction wear. Mission-kill hauls
 * (pristine non-weapon systems) fall out of per-part damage for free.
 */
import {
  MODIFIERS, Pcg32, getPart, modifierIdsFor,
  type BattleReport, type Build, type PartDef, type PlacedPart,
} from '@mechbattler/sim';
import { EXTRACTION_WEAR_MAX, SCRAP_WRECK_MULT } from '../state/runState.js';

export interface WreckPart {
  placed: PlacedPart;
  def: PartDef;
  destroyed: boolean;
  /** 0-1 loot integrity for intact parts; null when destroyed. */
  lootIntegrity: number | null;
  /** Scrap paid if this part is left behind (or was destroyed). */
  scrapValue: number;
  /** Modifiers riding the loot: inherited from the carrier + rolled quirks (docs/04 §4). */
  modifiers: string[];
  /** Variant rolls (docs/04 §4): small multipliers on headline stats. */
  variant: PlacedPart['variant'];
}

// --- Salvage-roll dials (docs/04 §4/§8 — tuning deferred) --------------------
/** Chance a looted part carries a quirk. */
export const QUIRK_CHANCE = 0.3;
/** Of quirked drops: flaws vs gifts, 2:1. */
export const QUIRK_FLAW_WEIGHT = 2 / 3;
/** Variant band: rolled multipliers stay within ±this. */
export const VARIANT_BAND = 0.1;

const VARIANT_STATS_BY_CATEGORY: Record<string, ('damage' | 'cycleS' | 'dispersionMrad' | 'hp')[]> = {
  weapon: ['damage', 'cycleS', 'dispersionMrad', 'hp'],
};
const VARIANT_STATS_DEFAULT: 'hp'[] = ['hp'];

/** One near-baseline-weighted multiplier in [1−band, 1+band]. */
function rollVariantMult(rng: Pcg32): number {
  const v = Math.max(-1, Math.min(1, rng.gaussian() * 0.4));
  return Math.round((1 + v * VARIANT_BAND) * 100) / 100;
}

function rollQuirk(rng: Pcg32, def: PartDef): string | null {
  if (rng.nextFloat() >= QUIRK_CHANCE) return null;
  const wantFlaw = rng.nextFloat() < QUIRK_FLAW_WEIGHT;
  const pool = modifierIdsFor(def).filter((id) => {
    const kind = MODIFIERS[id]!.kind;
    return wantFlaw ? kind === 'quirk-flaw' : kind === 'quirk-gift';
  });
  return pool.length > 0 ? pool[Math.floor(rng.nextFloat() * pool.length)]! : null;
}

export function buildWreck(
  report: BattleReport,
  enemyBuild: Build,
  opts: { guaranteeMod?: boolean } = {},
): WreckPart[] {
  const lost = new Set(report.mechs[1].partsLost.map((p) => p.instanceId));

  // Final condition straight from the sim's HP table (report.partsFinalHp):
  // covers shot damage, heat damage and the wreck's own cook-off splash alike.
  const hpFracByInstance = new Map(report.mechs[1].partsFinalHp.map((p) => [p.instanceId, p.hpFrac]));

  const wearRng = new Pcg32(report.seed ^ 0x5a17a6e);
  // Separate stream for variant/quirk rolls so wear math stays reproducible.
  const rollRng = new Pcg32(report.seed ^ 0x0ddba11);
  const wreck = enemyBuild.parts.map((placed) => {
    const def = getPart(placed.partId);
    const destroyed = lost.has(placed.instanceId);
    let lootIntegrity: number | null = null;
    if (!destroyed) {
      const wear = wearRng.nextFloat() * EXTRACTION_WEAR_MAX;
      lootIntegrity = Math.max(0.05, (hpFracByInstance.get(placed.instanceId) ?? 1) - wear);
    } else {
      wearRng.nextFloat(); // keep the wear stream aligned with part order
    }

    // Salvage randomness (docs/04 §4): the carrier's own modifiers ride
    // along (that's how enemy mods are won), plus fresh variant + quirk rolls.
    // One draw block per part regardless of state keeps the stream aligned.
    const stats = VARIANT_STATS_BY_CATEGORY[def.category] ?? VARIANT_STATS_DEFAULT;
    const stat = stats[Math.floor(rollRng.nextFloat() * stats.length)]!;
    const mult = rollVariantMult(rollRng);
    const quirk = rollQuirk(rollRng, def);
    const variant: PlacedPart['variant'] = mult !== 1 ? { [stat]: mult } : undefined;
    const modifiers = [...(placed.modifiers ?? []), ...(quirk && !placed.modifiers?.includes(quirk) ? [quirk] : [])];

    return { placed, def, destroyed, lootIntegrity, scrapValue: def.tier * SCRAP_WRECK_MULT, modifiers, variant };
  });

  // First-wreck guarantee (docs/04 §4b): one lootable part carries a mod —
  // the run's identity seed. Seeded pick among intact parts with any
  // applicable mod; skipped only if the wreck has no candidates.
  if (opts.guaranteeMod && !wreck.some((w) => !w.destroyed && w.modifiers.some((id) => MODIFIERS[id]?.kind === 'mod'))) {
    const candidates = wreck.filter((w) => !w.destroyed
      && modifierIdsFor(w.def).some((id) => MODIFIERS[id]!.kind === 'mod'));
    if (candidates.length > 0) {
      const target = candidates[Math.floor(rollRng.nextFloat() * candidates.length)]!;
      const pool = modifierIdsFor(target.def).filter((id) => MODIFIERS[id]!.kind === 'mod');
      target.modifiers = [...target.modifiers, pool[Math.floor(rollRng.nextFloat() * pool.length)]!];
    }
  }
  return wreck;
}
