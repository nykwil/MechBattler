/**
 * Budget-driven opponent generation (docs/10 M4, docs/04 §5). A pure, seeded
 * function: given a tier budget, pick the biggest hand-authored template that
 * fits, then spend the leftover budget on extra parts placed legally on the
 * free cells. Deterministic per seed; the sim never knows about runs (R6) —
 * the web's ladder just calls this with `budget = f(node)`.
 *
 * Budget accounting: the sum of part tiers, *excluding* conduits and heat
 * pipes — wiring is structure tax, laid free by auto-wire, so fill parts
 * never get crowded out of the budget by their own plumbing.
 */
import type { Build, PlacedPart, Rotation } from './types.js';
import { getPart } from './catalog.js';
import { getChassis } from './chassis.js';
import { checkPlacement } from './grid.js';
import { applyAutoWire } from './autowire.js';
import { TEMPLATES, type TemplateDef } from './templates.js';
import { Pcg32 } from './rng.js';

export interface GeneratedOpponent {
  build: Build;
  templateId: string;
  templateName: string;
  blurb: string;
  /** Tier total of the base template (conduits/pipes excluded). */
  baseTier: number;
  /** Tier total actually spent, base + fill (conduits/pipes excluded). */
  spentTier: number;
}

/** Tier total of a build, excluding conduits and heat pipes (structure tax). */
export function buildTierBudget(build: Build): number {
  return build.parts.reduce((sum, p) => {
    const def = getPart(p.partId);
    return def.isConduit || def.isHeatPipe ? sum : sum + def.tier;
  }, 0);
}

/** The intel headline: the build's highest-tier weapon, if any. */
export function headlineWeapon(build: Build): { partId: string; name: string } | null {
  let best: { partId: string; name: string; tier: number } | null = null;
  for (const p of build.parts) {
    const def = getPart(p.partId);
    if (def.category === 'weapon' && (!best || def.tier > best.tier)) {
      best = { partId: def.id, name: def.name, tier: def.tier };
    }
  }
  return best && { partId: best.partId, name: best.name };
}

/**
 * Hand-authored fill pool (like the templates: curated, not procedural, so
 * fights stay readable). Order is irrelevant — picks are seeded.
 */
const FILL_POOL = ['W-AC', 'W-MG', 'U-RAD', 'U-TC1', 'U-ARM'];
/** At most this many weapons added on top of the template's own. */
const FILL_WEAPON_CAP = 2;

function drawsFromReactor(partId: string): boolean {
  const def = getPart(partId);
  return Boolean(def.draw?.continuousKw || def.draw?.chargedEnergyPerShotKj);
}

function shuffled<T>(items: T[], rng: Pcg32): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.nextFloat() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function generateOpponent({
  budget,
  seed,
  fillPartIds = FILL_POOL,
}: {
  budget: number;
  seed: number;
  /** Run content may supply a tagged pool; omission preserves the canonical cohort. */
  fillPartIds?: readonly string[];
}): GeneratedOpponent {
  const rng = new Pcg32(seed);

  // Template: the biggest bases that fit the budget (window of 3 tiers off the
  // top keeps some variety), seeded pick. If nothing fits, the cheapest base.
  const withBase = TEMPLATES.map((t) => ({ t, base: buildTierBudget(t.build) }));
  const eligible = withBase.filter((x) => x.base <= budget);
  let pick: { t: TemplateDef; base: number };
  if (eligible.length === 0) {
    pick = withBase.reduce((min, x) => (x.base < min.base ? x : min));
  } else {
    const top = Math.max(...eligible.map((x) => x.base));
    const window = eligible.filter((x) => x.base >= top - 6);
    pick = window[Math.floor(rng.nextFloat() * window.length)]!;
  }

  const chassis = getChassis(pick.t.build.chassisId);
  const parts: PlacedPart[] = structuredClone(pick.t.build.parts);
  const powerPriority = [...pick.t.build.powerPriority];
  let remaining = budget - pick.base;
  let weaponsAdded = 0;
  let genN = 0;

  // All mask cells in a seeded order — each fill part scans for its first
  // legal placement (checkPlacement handles overlap, core, perimeter rules).
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < chassis.height; y++) {
    for (let x = 0; x < chassis.width; x++) {
      if (chassis.mask[y]?.[x]) cells.push({ x, y });
    }
  }

  const pool = [...fillPartIds];
  while (remaining > 0 && pool.length > 0) {
    const affordable = pool.filter((id) => {
      const def = getPart(id);
      return def.tier <= remaining && (def.category !== 'weapon' || weaponsAdded < FILL_WEAPON_CAP);
    });
    if (affordable.length === 0) break;
    const partId = affordable[Math.floor(rng.nextFloat() * affordable.length)]!;
    const def = getPart(partId);

    let placed: PlacedPart | null = null;
    outer: for (const cell of shuffled(cells, rng)) {
      for (const rotation of shuffled([0, 90, 180, 270] as Rotation[], rng)) {
        const candidate: PlacedPart = {
          instanceId: '__gen-candidate__', partId,
          origin: cell, rotation, integrity: 1,
        };
        if (checkPlacement(chassis, parts, candidate, def) === null) {
          placed = { ...candidate, instanceId: `gen-${partId}-${++genN}` };
          break outer;
        }
      }
    }
    if (!placed) {
      // No room anywhere for this part — drop it from the pool for good.
      pool.splice(pool.indexOf(partId), 1);
      continue;
    }
    parts.push(placed);
    remaining -= def.tier;
    if (def.category === 'weapon') weaponsAdded++;
    if (drawsFromReactor(partId)) powerPriority.push(placed.instanceId);
  }

  // Wiring is free structure: power everything the fill added. A fill part
  // that landed in a pocket no conduit path can reach gets dropped again —
  // generated mechs never field dead weight (R4: no unexplainable passengers).
  const wired = applyAutoWire(chassis, { chassisId: chassis.id, parts, powerPriority });
  let build = wired.build;
  const unreachable = new Set(wired.result.unreachableInstanceIds.filter((id) => id.startsWith('gen-')));
  if (unreachable.size > 0) {
    for (const id of unreachable) {
      const def = getPart(build.parts.find((p) => p.instanceId === id)!.partId);
      remaining += def.tier;
    }
    build = {
      ...build,
      parts: build.parts.filter((p) => !unreachable.has(p.instanceId)),
      powerPriority: build.powerPriority.filter((id) => !unreachable.has(id)),
    };
  }
  return {
    build,
    templateId: pick.t.id,
    templateName: pick.t.name,
    blurb: pick.t.blurb,
    baseTier: pick.base,
    spentTier: budget - remaining,
  };
}
