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
import type { Build, PartDef, PlacedPart } from './types.js';
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
  /**
   * Multiplier on the lateral-target (leading) penalty for THIS weapon.
   *
   * The mech-wide half of the same penalty is a catalog field
   * (`PartDef.fireControlLateralMult`, e.g. a targeting computer); the two
   * multiply. Before this existed the penalty was a hardcoded binary keyed on
   * one part id, so "reduce this gun's lateral penalty" was not expressible and
   * two targeting computers counted as one.
   */
  lateralPenalty: number;
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
  /** Static: per-cell thermal mass multiplier (heats and cools slower). */
  thermalMass: number;
  // Defense
  /** Static: HP multiplier (stacks with salvage integrity). */
  hp: number;
  /** Static: part mass multiplier. */
  massKg: number;
  /** This part's contribution to the mech's target profile (product). */
  targetProfile: number;
  /** Static: always sheds first in a brownout, ignoring priority. */
  shedFirst: boolean;
  /** Static: takes first claim on power (reactor+capacitor) — brownout-immune. */
  firstPriority: boolean;
  /** Static: a capacitor that converts its own cells' waste heat into charge. */
  harvestsHeat: boolean;
  /** Static: weapon on/off orders take effect this many seconds late. */
  orderLatencyS: number;
  /** Static: while functional, the mech ignores terrain speed penalties. */
  ignoreTerrainSlow: boolean;
}

export function neutralMults(): EffectiveMults {
  return {
    damage: 1, cycleS: 1, dispersionMrad: 1, moveJitter: 1, lateralPenalty: 1,
    overkillCarry: 1,
    drawKw: 1, outputKw: 1,
    radiator: 1, extraHeatKw: 0, conduction: 1, cookoffSplash: 1, thermalMass: 1,
    hp: 1, massKg: 1, targetProfile: 1, shedFirst: false, firstPriority: false,
    harvestsHeat: false, orderLatencyS: 0, ignoreTerrainSlow: false,
  };
}

/**
 * The fields that carry a *percentage* modifier, and therefore have two
 * buckets. Everything else is either a physical quantity summed into a total
 * (`extraHeatKw`, `orderLatencyS`), a boolean, or an override
 * (`conduction`, `cookoffSplash`, which are set to 0 rather than scaled).
 */
export type ScalableField =
  | 'damage' | 'cycleS' | 'dispersionMrad' | 'moveJitter' | 'lateralPenalty'
  | 'overkillCarry' | 'drawKw' | 'outputKw' | 'radiator' | 'thermalMass'
  | 'hp' | 'massKg' | 'targetProfile';

/**
 * A pool that has summed to `1 + add <= 0` has inverted the effect it was
 * reducing — a 100% reduction is not a design any content should reach. The
 * clamp is a safety net, not a balance dial: if it ever fires, the catalog is
 * wrong, and `game:audit` checks that no legal combination can get here.
 */
export const ADDITIVE_POOL_FLOOR = 0;

/**
 * How two sources of the same bonus combine (docs/04 §4b).
 *
 * Two buckets, deliberately:
 *
 *  - `inc(field, pct)` joins the **additive** pool. Sources sum, then apply
 *    once: two "-30%" parts give `1 - 0.6 = 0.4`, not `0.7 x 0.7 = 0.49`.
 *  - `scale(field, mult)` joins the **multiplicative** pool. Each source
 *    multiplies separately and they compound.
 *
 * Final value is `(1 + additivePool) * multiplicativePool`. Both pools are
 * order-independent — multiplication and addition each commute — so a
 * modifier never has to care what ran before it. Order would only matter if a
 * single source could write to both pools for one field, which the verbs make
 * awkward on purpose.
 *
 * Content rule: **a knob's headline effect picks one bucket and stays there.**
 * The additive pool is for sources meant to compete with each other (stacking
 * three of them is deliberately worse than three separate multipliers); the
 * multiplicative pool is for sources meant to reward committing to them.
 */
export class ModBuilder {
  private readonly base = neutralMults();
  /** Lazily populated: untouched fields cost nothing, and most parts touch none. */
  private adds: Partial<Record<ScalableField, number>> | null = null;
  private mults: Partial<Record<ScalableField, number>> | null = null;

  /** Additive pool: percentage points, e.g. `-0.5` for "reduce by 50%". */
  inc(field: ScalableField, pct: number): this {
    (this.adds ??= {})[field] = (this.adds[field] ?? 0) + pct;
    return this;
  }

  /** Multiplicative pool: a factor, e.g. `0.5` to halve. */
  scale(field: ScalableField, mult: number): this {
    (this.mults ??= {})[field] = (this.mults[field] ?? 1) * mult;
    return this;
  }

  /** Sum into a physical quantity (kW of heat, seconds of latency). */
  add(field: 'extraHeatKw' | 'orderLatencyS', amount: number): this {
    this.base[field] += amount;
    return this;
  }

  /** Raise a floor rather than accumulate — the worst offender wins. */
  atLeast(field: 'orderLatencyS', value: number): this {
    this.base[field] = Math.max(this.base[field], value);
    return this;
  }

  /** Booleans and outright overrides. */
  set<K extends 'shedFirst' | 'firstPriority' | 'harvestsHeat' | 'ignoreTerrainSlow'
    | 'conduction' | 'cookoffSplash'>(field: K, value: EffectiveMults[K]): this {
    this.base[field] = value;
    return this;
  }

  /**
   * The additive pool as accumulated so far, for content auditing.
   *
   * `game:audit` runs each modifier against a probe builder and sums the worst
   * case per field, so "no legal combination can reach a 100% reduction" is
   * checked against the catalog rather than trusted. Reading the pool beats
   * parsing `apply` source, which is what the content hash has to resort to.
   */
  peekAdditive(): Readonly<Partial<Record<ScalableField, number>>> {
    return this.adds ?? {};
  }

  resolve(): EffectiveMults {
    const out = this.base;
    const fields = new Set<ScalableField>([
      ...(Object.keys(this.adds ?? {}) as ScalableField[]),
      ...(Object.keys(this.mults ?? {}) as ScalableField[]),
    ]);
    for (const field of fields) {
      const pool = 1 + (this.adds?.[field] ?? 0);
      out[field] = Math.max(ADDITIVE_POOL_FLOOR, pool) * (this.mults?.[field] ?? 1);
    }
    return out;
  }
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
  /** Explicit opportunity cost/downside for build-defining perks. */
  tradeoff?: string;
  /** High-leverage perks may be unique per build to prevent copy loops. */
  maxCopiesPerBuild?: number;
  /** Which parts can carry this modifier (reuse across the catalog). */
  appliesTo: (def: PartDef) => boolean;
  /**
   * Bend the mults. Pure; reads only `ctx` and `def`.
   *
   * Every existing modifier uses `scale` — they were all multiplicative before
   * buckets existed and stayed that way, so the substrate change was inert. New
   * content picks its bucket deliberately.
   */
  apply: (m: ModBuilder, ctx: ModifierCtx, def: PartDef) => void;
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
    apply: (m) => { m.scale('damage', 1.12); m.scale('outputKw', 1.12); m.scale('hp', 0.75); },
  },
  'hot-running': {
    id: 'hot-running', name: 'Hot-running', kind: 'quirk-flaw',
    blurb: '+1.5 kW idle heat while powered',
    appliesTo: any,
    apply: (m) => { m.add('extraHeatKw', 1.5); },
  },
  'heat-loose': {
    id: 'heat-loose', name: 'Heat-loose', kind: 'quirk-gift',
    blurb: 'cycle ×0.8 while its cells are >100 °C',
    appliesTo: isWeapon,
    apply: (m, ctx) => { if (ctx.tempC > 100) m.scale('cycleS', 0.8); },
  },
  'cold-blooded': {
    id: 'cold-blooded', name: 'Cold-blooded', kind: 'quirk-flaw',
    blurb: 'damage/output ×0.85 below 60 °C — wants a warm-up',
    appliesTo: (d) => isWeapon(d) || d.category === 'reactor',
    apply: (m, ctx) => { if (ctx.tempC < 60) { m.scale('damage', 0.85); m.scale('outputKw', 0.85); } },
  },
  'lucky': {
    id: 'lucky', name: 'Lucky', kind: 'quirk-gift',
    blurb: 'dispersion ×0.9',
    appliesTo: isWeapon,
    apply: (m) => { m.scale('dispersionMrad', 0.9); },
  },
  'miswired': {
    id: 'miswired', name: 'Miswired', kind: 'quirk-flaw',
    blurb: 'ignores brownout priority — always sheds first',
    appliesTo: (d) => Boolean(d.draw),
    apply: (m) => { m.set('shedFirst', true); },
  },
  'leaky': {
    id: 'leaky', name: 'Leaky', kind: 'quirk-flaw',
    blurb: '+20% of its power draw emitted as heat',
    appliesTo: (d) => Boolean(d.draw?.continuousKw),
    apply: (m, _ctx, def) => { m.add('extraHeatKw', (def.draw?.continuousKw ?? 0) * 0.2); },
  },
  'frankensteined': {
    id: 'frankensteined', name: 'Frankensteined', kind: 'quirk-gift',
    blurb: '−10% mass, but hogs 2 bench slots',
    appliesTo: any,
    apply: (m) => { m.scale('massKg', 0.9); },
  },
  'sticky': {
    id: 'sticky', name: 'Sticky', kind: 'quirk-flaw',
    blurb: 'weapon on/off orders take effect 0.8 s late',
    appliesTo: isWeapon,
    apply: (m) => { m.atLeast('orderLatencyS', 0.8); },
  },
  'cold-soaked': {
    id: 'cold-soaked', name: 'Cold-soaked', kind: 'quirk-flaw',
    blurb: 'thermal mass ×2 — heats and cools slowly',
    appliesTo: any,
    apply: (m) => { m.scale('thermalMass', 2); },
  },
  // --- Mods (docs/04 §4b) ---------------------------------------------------
  'marsh-pistons': {
    id: 'marsh-pistons', name: 'Marsh pistons', kind: 'mod',
    blurb: 'no water/forest speed penalty · servo draw ×1.5',
    tradeoff: 'Consumes 6 kW instead of 4 kW and occupies the Stride fitting.',
    maxCopiesPerBuild: 1,
    appliesTo: (d) => d.id === 'U-ACT',
    apply: (m) => { m.set('ignoreTerrainSlow', true); m.scale('drawKw', 1.5); },
  },
  'fever-cycle': {
    id: 'fever-cycle', name: 'Fever cycle', kind: 'mod',
    blurb: 'hotter than 50 °C cycles faster · weapon draw ×1.15',
    tradeoff: 'Pays 15% more power at every temperature and must sustain a hot firing rhythm.',
    maxCopiesPerBuild: 1,
    appliesTo: isWeapon,
    // 50 °C → ×1.0, 100 °C → ×0.85. The onset is above a cold weapon's
    // normal operating band but reachable by a deliberately hot-running fit.
    apply: (m, ctx) => {
      m.scale('drawKw', 1.15);
      m.scale('cycleS', Math.max(0.85, 1 - Math.max(0, ctx.tempC - 50) * 0.003));
    },
  },
  'cold-bore': {
    id: 'cold-bore', name: 'Cold bore', kind: 'mod',
    blurb: 'below 40 °C: dispersion ×0.5, move jitter ×0.5, damage ×1.15 · damage ×0.95 always',
    tradeoff: 'Gets a hard overcooled opening, then deals 5% less damage after warming.',
    maxCopiesPerBuild: 1,
    appliesTo: isWeapon,
    apply: (m, ctx) => {
      m.scale('damage', 0.95);
      if (ctx.tempC < 40) {
        m.scale('damage', 1.15);
        m.scale('dispersionMrad', 0.5);
        // The jitter half was added Aug 2026, when raising MOVE_JITTER_MRAD_PER_MPS
        // killed this perk outright: jitter is *added* to dispersion rather than
        // scaled by it, so halving a carbine's 2 mrad saved 1 mrad against 2+ mrad
        // of motion error and the perk measured a delta of exactly zero. A cold,
        // tight barrel steadying the shot is the same story either way.
        m.scale('moveJitter', 0.5);
      }
    },
  },
  'tidecooler': {
    id: 'tidecooler', name: 'Tidecooler', kind: 'mod',
    blurb: 'radiator ×2 while wading — camp the water',
    appliesTo: isRadiator,
    apply: (m, ctx) => { if (ctx.tile === 'water') m.scale('radiator', 2); },
  },
  'gyrostabilized': {
    id: 'gyrostabilized', name: 'Gyrostabilized', kind: 'mod',
    blurb: 'own movement aim jitter ×0.4 · weapon mass ×1.15',
    tradeoff: 'The reinforced mount adds 15% weapon mass and worsens load/CoG pressure.',
    maxCopiesPerBuild: 1,
    appliesTo: isWeapon,
    apply: (m) => { m.scale('moveJitter', 0.4); m.scale('massKg', 1.15); },
  },
  'hull-down': {
    id: 'hull-down', name: 'Hull-down suspension', kind: 'mod',
    blurb: 'below 1.5 m/s target profile ×0.4 · servo mass ×1.15',
    tradeoff: 'Requires a powered two-cell Stride and adds 15% servo mass; moving turns it off.',
    maxCopiesPerBuild: 1,
    appliesTo: (d) => d.id === 'U-ACT',
    apply: (m, ctx) => { m.scale('massKg', 1.15); if (ctx.speedMps < 1.5) m.scale('targetProfile', 0.4); },
  },
  'insulated-mount': {
    id: 'insulated-mount', name: 'Insulated mount', kind: 'mod',
    blurb: 'no heat conduction to grid neighbors — place it anywhere',
    appliesTo: any,
    apply: (m) => { m.set('conduction', 0); },
  },
  'ram-bore': {
    id: 'ram-bore', name: 'Ram bore', kind: 'mod',
    blurb: 'overkill penetration carries 75% instead of 50%',
    appliesTo: isWeapon,
    apply: (m) => { m.scale('overkillCarry', 1.5); },
  },
  'sacrificial-casing': {
    id: 'sacrificial-casing', name: 'Sacrificial casing', kind: 'mod',
    blurb: 'cook-off vents outward — no splash to neighbors',
    appliesTo: (d) => d.id === 'U-AMMO',
    apply: (m) => { m.set('cookoffSplash', 0); },
  },
  'surge-gate': {
    id: 'surge-gate', name: 'Surge gate', kind: 'mod',
    blurb: 'first claim on power — fires from capacitors even while browned out',
    appliesTo: isWeapon,
    apply: (m) => { m.set('firstPriority', true); },
  },
  'thermocouple-skin': {
    id: 'thermocouple-skin', name: 'Thermocouple skin', kind: 'mod',
    blurb: 'trickles its own waste heat back into charge — wants to sit by the reactor',
    appliesTo: (d) => d.category === 'capacitor',
    apply: (m) => { m.set('harvestsHeat', true); },
  },
};

/** Variant stats (docs/04 §4): small static multipliers rolled at drop. */
export type VariantStat = 'damage' | 'cycleS' | 'dispersionMrad' | 'hp';

export function modifierIdsFor(def: PartDef): string[] {
  return Object.values(MODIFIERS).filter((mod) => mod.appliesTo(def)).map((mod) => mod.id);
}

export interface ModifierLoadoutIssue {
  kind: 'unknown' | 'inapplicable' | 'multiple-mods-on-part' | 'copy-limit';
  modifierId: string;
  instanceId?: string;
  message: string;
}

/**
 * Build-level mod audit used by the diversity harness and machinist UI.
 * Quirks may coexist with one mod; multiple mods on one part and copies above
 * an explicit perk limit are rejected as automatic stacking loops.
 */
export function auditModifierLoadout(build: Build): ModifierLoadoutIssue[] {
  const issues: ModifierLoadoutIssue[] = [];
  const counts = new Map<string, number>();
  for (const part of build.parts) {
    const mods: string[] = [];
    for (const id of part.modifiers ?? []) {
      const def = MODIFIERS[id];
      if (!def) {
        issues.push({ kind: 'unknown', modifierId: id, instanceId: part.instanceId, message: `${part.instanceId} has unknown modifier ${id}` });
        continue;
      }
      if (!def.appliesTo(getPart(part.partId))) {
        issues.push({ kind: 'inapplicable', modifierId: id, instanceId: part.instanceId, message: `${def.name} does not apply to ${part.partId}` });
      }
      if (def.kind === 'mod') mods.push(id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    if (mods.length > 1) {
      issues.push({
        kind: 'multiple-mods-on-part', modifierId: mods.join(','), instanceId: part.instanceId,
        message: `${part.instanceId} carries ${mods.length} mods; one mod per part is the build-identity limit`,
      });
    }
  }
  for (const [id, count] of counts) {
    const limit = MODIFIERS[id]?.maxCopiesPerBuild;
    if (limit !== undefined && count > limit) {
      issues.push({ kind: 'copy-limit', modifierId: id, message: `${id} appears ${count} times; build limit is ${limit}` });
    }
  }
  return issues;
}

/**
 * Resolve an instance's effective multipliers for a physical context.
 * Neutral-fast-path: parts without variants or modifiers share one frozen
 * neutral object — the common case costs one branch.
 */
export function effectiveMults(placed: PlacedPart, ctx: ModifierCtx): EffectiveMults {
  const hasVariant = placed.variant && Object.keys(placed.variant).length > 0;
  if (!placed.modifiers?.length && !hasVariant) return NEUTRAL as EffectiveMults;
  const m = new ModBuilder();
  // Variant rolls are multiplicative: a +8% damage roll and a mod that also
  // scales damage compound, rather than competing in one pool.
  if (placed.variant) {
    for (const [stat, mult] of Object.entries(placed.variant)) {
      m.scale(stat as VariantStat, mult);
    }
  }
  const def = getPart(placed.partId);
  for (const id of placed.modifiers ?? []) {
    MODIFIERS[id]?.apply(m, ctx, def);
  }
  return m.resolve();
}
