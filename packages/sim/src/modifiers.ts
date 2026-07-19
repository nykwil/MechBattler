/**
 * The modifier substrate (docs/04 §4 + §4b): variants, quirks and mods are
 * all per-instance parameter modifiers resolved through this one system.
 *
 * Design rules (04 §4b "what makes a good mod"):
 *  - A modifier bends numbers the sim already simulates — never new rules.
 *  - It reads only simulated physical context (temperature, speed, terrain);
 *    modifiers never reference each other, so synergies emerge from physics.
 *  - `appliesTo` gates which parts can carry it, letting one modifier serve
 *    many parts.
 *
 * Extending: add one `ModifierDef` to the MODIFIERS table. Every knob in
 * `EffectiveMults` is already threaded through the sim's call sites, so a new
 * modifier that uses existing knobs needs zero plumbing. A new knob means one
 * new field here plus one consultation at the relevant call site.
 *
 * Static vs dynamic: `hp`, `conduction` and `shedFirst` are read once at
 * construction (they shape the thermal graph / HP table / priority order), so
 * modifiers must derive them ctx-independently — dynamic effects belong on
 * the per-tick knobs (damage, cycleS, radiator, …).
 */
import type { PartDef, PlacedPart } from './types.js';
import { getPart } from './catalog.js';
import type { TerrainType } from './terrain.js';

/** Physical context a dynamic modifier may read. All simulated quantities. */
export interface ModifierCtx {
  /** Mean temperature of the part's own cells, °C. */
  tempC: number;
  /** The mech's current speed, m/s. */
  speedMps: number;
  /** Terrain tile under the mech. */
  tile: TerrainType;
}

/** Neutral context for construction-time (static) resolution. */
export const STATIC_CTX: ModifierCtx = { tempC: 25, speedMps: 0, tile: 'open' };

/**
 * Every number a modifier may bend. Multiplicative unless noted; neutral = 1
 * (adds neutral = 0). The sim consults these at its existing call sites.
 */
export interface EffectiveMults {
  // Weapon
  damage: number;
  cycleS: number;
  dispersionMrad: number;
  /** Multiplier on the shooter's own-motion aim jitter. */
  moveJitter: number;
  /** Multiplier on the 50% overkill penetration carry (docs/01 §5). */
  overkillCarry: number;
  // Power
  drawKw: number;
  outputKw: number;
  // Thermal
  radiator: number;
  /** Additive: extra heat emitted into the part's cells, kW. */
  extraHeatKw: number;
  /** Static: conduction to grid neighbors (0 = insulated). */
  conduction: number;
  /** 0 disables this part's cook-off splash to neighbors. */
  cookoffSplash: number;
  // Defense
  /** Static: HP multiplier (stacks with salvage integrity). */
  hp: number;
  /** This part's contribution to the mech's target profile (product). */
  targetProfile: number;
  /** Static: always sheds first in a brownout, ignoring priority. */
  shedFirst: boolean;
}

export function neutralMults(): EffectiveMults {
  return {
    damage: 1, cycleS: 1, dispersionMrad: 1, moveJitter: 1, overkillCarry: 1,
    drawKw: 1, outputKw: 1,
    radiator: 1, extraHeatKw: 0, conduction: 1, cookoffSplash: 1,
    hp: 1, targetProfile: 1, shedFirst: false,
  };
}

/** Shared frozen neutral — the fast path for unmodified parts. */
export const NEUTRAL_MULTS: Readonly<EffectiveMults> = Object.freeze(neutralMults());
const NEUTRAL = NEUTRAL_MULTS;

export type ModifierKind = 'quirk-flaw' | 'quirk-gift' | 'mod';

export interface ModifierDef {
  id: string;
  name: string;
  kind: ModifierKind;
  /** One-liner surfaced everywhere the part appears (docs/04 §4). */
  blurb: string;
  /** Which parts can carry this modifier (reuse across the catalog). */
  appliesTo: (def: PartDef) => boolean;
  /** Bend the mults. Pure; reads only `ctx` and `def`. */
  apply: (m: EffectiveMults, ctx: ModifierCtx, def: PartDef) => void;
}

const isWeapon = (d: PartDef) => d.category === 'weapon';
const isRadiator = (d: PartDef) => d.id === 'U-RAD';
const any = () => true;

/** The registry. Quirks from docs/04 §4; mods from §4b. */
export const MODIFIERS: Record<string, ModifierDef> = {
  // --- Quirks (docs/04 §4) --------------------------------------------------
  'overvolted': {
    id: 'overvolted', name: 'Overvolted', kind: 'quirk-gift',
    blurb: '+12% damage/output · −25% max HP',
    appliesTo: (d) => isWeapon(d) || d.category === 'reactor',
    apply: (m) => { m.damage *= 1.12; m.outputKw *= 1.12; m.hp *= 0.75; },
  },
  'hot-running': {
    id: 'hot-running', name: 'Hot-running', kind: 'quirk-flaw',
    blurb: '+1.5 kW idle heat while powered',
    appliesTo: any,
    apply: (m) => { m.extraHeatKw += 1.5; },
  },
  'heat-loose': {
    id: 'heat-loose', name: 'Heat-loose', kind: 'quirk-gift',
    blurb: 'cycle ×0.8 while its cells are >100 °C',
    appliesTo: isWeapon,
    apply: (m, ctx) => { if (ctx.tempC > 100) m.cycleS *= 0.8; },
  },
  'cold-blooded': {
    id: 'cold-blooded', name: 'Cold-blooded', kind: 'quirk-flaw',
    blurb: 'damage/output ×0.85 below 60 °C — wants a warm-up',
    appliesTo: (d) => isWeapon(d) || d.category === 'reactor',
    apply: (m, ctx) => { if (ctx.tempC < 60) { m.damage *= 0.85; m.outputKw *= 0.85; } },
  },
  'lucky': {
    id: 'lucky', name: 'Lucky', kind: 'quirk-gift',
    blurb: 'dispersion ×0.9',
    appliesTo: isWeapon,
    apply: (m) => { m.dispersionMrad *= 0.9; },
  },
  'miswired': {
    id: 'miswired', name: 'Miswired', kind: 'quirk-flaw',
    blurb: 'ignores brownout priority — always sheds first',
    appliesTo: (d) => Boolean(d.draw),
    apply: (m) => { m.shedFirst = true; },
  },
  'leaky': {
    id: 'leaky', name: 'Leaky', kind: 'quirk-flaw',
    blurb: '+20% of its power draw emitted as heat',
    appliesTo: (d) => Boolean(d.draw?.continuousKw),
    apply: (m, _ctx, def) => { m.extraHeatKw += (def.draw?.continuousKw ?? 0) * 0.2; },
  },
  // --- Mods (docs/04 §4b) ---------------------------------------------------
  'fever-cycle': {
    id: 'fever-cycle', name: 'Fever cycle', kind: 'mod',
    blurb: 'fires faster the hotter its mount runs (−1% cycle per °C above 60)',
    appliesTo: isWeapon,
    // 60 °C → ×1.0, 100 °C → ×0.6, floor ×0.5 — riding the shutdown cliff.
    apply: (m, ctx) => { m.cycleS *= Math.max(0.5, 1 - Math.max(0, ctx.tempC - 60) * 0.01); },
  },
  'cold-bore': {
    id: 'cold-bore', name: 'Cold bore', kind: 'mod',
    blurb: 'dispersion ×0.5 below 40 °C — the first shot is the kill shot',
    appliesTo: isWeapon,
    apply: (m, ctx) => { if (ctx.tempC < 40) m.dispersionMrad *= 0.5; },
  },
  'tidecooler': {
    id: 'tidecooler', name: 'Tidecooler', kind: 'mod',
    blurb: 'radiator ×2 while wading — camp the water',
    appliesTo: isRadiator,
    apply: (m, ctx) => { if (ctx.tile === 'water') m.radiator *= 2; },
  },
  'gyrostabilized': {
    id: 'gyrostabilized', name: 'Gyrostabilized', kind: 'mod',
    blurb: 'own movement costs half the usual aim jitter',
    appliesTo: isWeapon,
    apply: (m) => { m.moveJitter *= 0.5; },
  },
  'hull-down': {
    id: 'hull-down', name: 'Hull-down suspension', kind: 'mod',
    blurb: 'below 0.5 m/s the chassis crouches: target profile ×0.7',
    appliesTo: (d) => d.category === 'structural',
    apply: (m, ctx) => { if (ctx.speedMps < 0.5) m.targetProfile *= 0.7; },
  },
  'insulated-mount': {
    id: 'insulated-mount', name: 'Insulated mount', kind: 'mod',
    blurb: 'no heat conduction to grid neighbors — place it anywhere',
    appliesTo: any,
    apply: (m) => { m.conduction = 0; },
  },
  'ram-bore': {
    id: 'ram-bore', name: 'Ram bore', kind: 'mod',
    blurb: 'overkill penetration carries 75% instead of 50%',
    appliesTo: isWeapon,
    apply: (m) => { m.overkillCarry *= 1.5; },
  },
  'sacrificial-casing': {
    id: 'sacrificial-casing', name: 'Sacrificial casing', kind: 'mod',
    blurb: 'cook-off vents outward — no splash to neighbors',
    appliesTo: (d) => d.id === 'U-AMMO',
    apply: (m) => { m.cookoffSplash = 0; },
  },
};

/** Variant stats (docs/04 §4): small static multipliers rolled at drop. */
export type VariantStat = 'damage' | 'cycleS' | 'dispersionMrad' | 'hp';

export function modifierIdsFor(def: PartDef): string[] {
  return Object.values(MODIFIERS).filter((mod) => mod.appliesTo(def)).map((mod) => mod.id);
}

/**
 * Resolve an instance's effective multipliers for a physical context.
 * Neutral-fast-path: parts without variants or modifiers share one frozen
 * neutral object — the common case costs one branch.
 */
export function effectiveMults(placed: PlacedPart, ctx: ModifierCtx): EffectiveMults {
  const hasVariant = placed.variant && Object.keys(placed.variant).length > 0;
  if (!placed.modifiers?.length && !hasVariant) return NEUTRAL as EffectiveMults;
  const m = neutralMults();
  if (placed.variant) {
    for (const [stat, mult] of Object.entries(placed.variant)) {
      m[stat as VariantStat] *= mult;
    }
  }
  const def = getPart(placed.partId);
  for (const id of placed.modifiers ?? []) {
    MODIFIERS[id]?.apply(m, ctx, def);
  }
  return m;
}
