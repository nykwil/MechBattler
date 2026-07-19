/**
 * Wreck salvage math (docs/04 §2): after a win, the enemy wreck is read as
 * its actual chassis grid. Destroyed parts auto-scrap; intact parts loot at
 * integrity = 1 − damage taken − seeded extraction wear. Mission-kill hauls
 * (pristine non-weapon systems) fall out of per-part damage for free.
 */
import { Pcg32, getPart, type BattleReport, type Build, type PartDef, type PlacedPart } from '@mechbattler/sim';
import { EXTRACTION_WEAR_MAX, SCRAP_WRECK_MULT } from '../state/runState.js';

export interface WreckPart {
  placed: PlacedPart;
  def: PartDef;
  destroyed: boolean;
  /** 0-1 loot integrity for intact parts; null when destroyed. */
  lootIntegrity: number | null;
  /** Scrap paid if this part is left behind (or was destroyed). */
  scrapValue: number;
}

export function buildWreck(report: BattleReport, enemyBuild: Build): WreckPart[] {
  const lost = new Set(report.mechs[1].partsLost.map((p) => p.instanceId));

  // Final condition straight from the sim's HP table (report.partsFinalHp):
  // covers shot damage, heat damage and the wreck's own cook-off splash alike.
  const hpFracByInstance = new Map(report.mechs[1].partsFinalHp.map((p) => [p.instanceId, p.hpFrac]));

  const wearRng = new Pcg32(report.seed ^ 0x5a17a6e);
  return enemyBuild.parts.map((placed) => {
    const def = getPart(placed.partId);
    const destroyed = lost.has(placed.instanceId);
    let lootIntegrity: number | null = null;
    if (!destroyed) {
      const wear = wearRng.nextFloat() * EXTRACTION_WEAR_MAX;
      lootIntegrity = Math.max(0.05, (hpFracByInstance.get(placed.instanceId) ?? 1) - wear);
    } else {
      wearRng.nextFloat(); // keep the wear stream aligned with part order
    }
    return { placed, def, destroyed, lootIntegrity, scrapValue: def.tier * SCRAP_WRECK_MULT };
  });
}
