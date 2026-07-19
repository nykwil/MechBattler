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

  // Damage taken per enemy part, from the shot events' penetration records.
  const damageByInstance = new Map<string, number>();
  for (const ev of report.events) {
    if (ev.type !== 'shot' || ev.mech !== 0 || !ev.damaged) continue;
    for (const d of ev.damaged) {
      damageByInstance.set(d.instanceId, (damageByInstance.get(d.instanceId) ?? 0) + d.damage);
    }
  }

  const wearRng = new Pcg32(report.seed ^ 0x5a17a6e);
  return enemyBuild.parts.map((placed) => {
    const def = getPart(placed.partId);
    const destroyed = lost.has(placed.instanceId);
    let lootIntegrity: number | null = null;
    if (!destroyed) {
      const damageFrac = Math.min((damageByInstance.get(placed.instanceId) ?? 0) / Math.max(def.hp, 1), 1);
      const wear = wearRng.nextFloat() * EXTRACTION_WEAR_MAX;
      lootIntegrity = Math.max(0.05, 1 - damageFrac - wear);
    } else {
      wearRng.nextFloat(); // keep the wear stream aligned with part order
    }
    return { placed, def, destroyed, lootIntegrity, scrapValue: def.tier * SCRAP_WRECK_MULT };
  });
}
