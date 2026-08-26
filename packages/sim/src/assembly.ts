/**
 * Programmatic placement: put a part somewhere legal, by the same rules the
 * workshop enforces.
 *
 * This was private to `adaptation.ts`, which meant the only way to author a
 * build outside the fitting search was to hand-type a cell reference per part
 * — and to re-type them all whenever a placement rule changed, as component
 * height forced in `7ca70de`. It is shared now so the adaptation search and the
 * workbench place parts through one implementation; a rule the placer does not
 * know about is a bug in one place rather than two.
 */
import type { Build, PlacedPart } from './types.js';
import { competesForPowerBudget, getPart } from './catalog.js';
import { getChassis } from './chassis.js';
import { checkPlacement, getOccupiedCells } from './grid.js';
import { checkSpatialPartPlacement } from './spatial.js';
import { connectedInstanceIds } from './spatialPower.js';

/**
 * Ids derive from the build being modified, not a module counter — the sim
 * must hold zero global mutable state (docs/11 M0: server processes are
 * shared, and lockstep replays must not depend on call history).
 */
export function freshId(parts: PlacedPart[], partId: string, prefix = 'adapt'): string {
  let max = 0;
  const pattern = new RegExp(`^${prefix}-.*-(\\d+)$`);
  for (const p of parts) {
    const m = pattern.exec(p.instanceId);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${partId}-${max + 1}`;
}

export function freeCells(build: Build, frontFirst: boolean): { x: number; y: number }[] {
  const chassis = getChassis(build.chassisId);
  const occupied = new Set<string>();
  for (const p of build.parts) {
    for (const c of getOccupiedCells(p, getPart(p.partId))) occupied.add(`${c.x},${c.y}`);
  }
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < chassis.height; y++) {
    for (let x = 0; x < chassis.width; x++) {
      if (!chassis.mask[y]?.[x]) continue;
      if (x === chassis.coreCell.x && y === chassis.coreCell.y) continue;
      if (!occupied.has(`${x},${y}`)) cells.push({ x, y });
    }
  }
  // Grid row 0 is the mech's front (docs/01 §1).
  return frontFirst ? cells.sort((a, b) => a.y - b.y) : cells;
}

export interface PlaceOptions {
  /** Prefer front rows — armour wants the lane it is protecting. */
  frontFirst?: boolean;
  /** Re-check power connectivity, so a powered part lands on the network. */
  requireConnected?: boolean;
  /** Instance-id prefix. Defaults to `adapt` so existing search output is unchanged. */
  prefix?: string;
  /** Modifiers and variant to stamp on each copy (a unique, a quirk, a mod). */
  modifiers?: string[];
  variant?: PlacedPart['variant'];
}

/**
 * Adds `count` copies of a part at the first legal positions, trying both
 * rotations. Returns the build with however many fitted, and how many did —
 * a caller that asked for four plates and got two needs to know which.
 */
export function placeParts(
  build: Build,
  partId: string,
  count: number,
  opts: PlaceOptions = {},
): { build: Build; placed: number } {
  const chassis = getChassis(build.chassisId);
  const def = getPart(partId);
  let parts = [...build.parts];
  let priority = [...build.powerPriority];
  let placedCount = 0;

  for (let n = 0; n < count; n++) {
    let placed: PlacedPart | null = null;
    outer: for (const cell of freeCells({ ...build, parts }, opts.frontFirst ?? false)) {
      for (const rotation of [0, 90] as const) {
        const candidate: PlacedPart = {
          instanceId: freshId(parts, partId, opts.prefix), partId, origin: cell, rotation, integrity: 1,
          ...(opts.modifiers ? { modifiers: [...opts.modifiers] } : {}),
          ...(opts.variant ? { variant: { ...opts.variant } } : {}),
        };
        if (checkPlacement(chassis, parts, candidate, def) !== null) continue;
        // The workshop's rules, not just the grid's: stacking, regions and the
        // ceiling. Without this the auto-placer can hand back a fitting the
        // player could never have built by hand.
        if (checkSpatialPartPlacement(chassis, { parts, routes: build.routes ?? [] }, candidate, def) !== null) continue;
        if (opts.requireConnected) {
          // Ask whichever power model this build actually runs under. This used
          // to call computeConnectivity unconditionally, so on a regioned
          // chassis -- which is all three of them -- the search checked a
          // different question from the one the sim answers, and could report an
          // adaptation whose new part the battle then left unpowered.
          const trial = { ...build, parts: [...parts, candidate] };
          if (!connectedInstanceIds(chassis, trial).has(candidate.instanceId)) continue;
        }
        placed = candidate;
        break outer;
      }
    }
    if (!placed) break;
    parts = [...parts, placed];
    if (competesForPowerBudget(def)) priority = [...priority, placed.instanceId];
    placedCount++;
  }
  return { build: { ...build, parts, powerPriority: priority }, placed: placedCount };
}
