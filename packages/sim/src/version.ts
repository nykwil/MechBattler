/**
 * Sim versioning for multiplayer lock-in (docs/11 M0): a locked build, a
 * stored replay, or a lockstep match is only meaningful against the exact
 * content it was created with. `SIM_VERSION` is bumped by hand on any
 * behavior-affecting change; `simContentHash()` is computed from the data
 * that defines behavior (part catalog, chassis, templates, the modifier
 * registry, and the headline dial constants). The lateral-penalty values left
 * this list in Aug 2026 when they became catalog fields -- `PARTS` covers them
 * now, and duplicating them here would have hashed the same number twice. and catches what humans forget.
 * Stamp both into anything that outlives a session.
 */
import { PARTS } from './catalog.js';
import { CHASSIS } from './chassis.js';
import { TEMPLATES } from './templates.js';
import { ADDITIVE_POOL_FLOOR, MODIFIERS } from './modifiers.js';
import { AMBIENT_C, RADIATOR_CAP_KW, RADIATOR_K, CONDUCTION_K_NORMAL, CONDUCTION_K_PIPE } from './thermal.js';
import {
  CELL_SIZE_M, CORE_HP, DEFAULT_ARENA_LENGTH_M, DEFAULT_ARENA_WIDTH_M,
  DEFAULT_SPAWN_DISTANCE_M, DEFAULT_TIMEOUT_S, TICK_S, AUTOPILOT_PERIOD_TICKS,
  TRACKING_LAG_S, MOVE_JITTER_MRAD_PER_MPS,
} from './combat.js';
import { RAM_AIR_MAX_BONUS, SPEED_SETTING_FRACTIONS, THERMOCOUPLE_K, THERMOCOUPLE_EFFICIENCY } from './simulation.js';
import { COOLANT_CONDUCTANCE, EXTERIOR_PASSIVE_K, ROUTE_MASS_KG, WIRE_CAPACITY_KW } from './spatial.js';
import {
  FOREST_COVER_MULT, HILL_RANGE_MULT, TERRAIN_CELL_SIZE_M, TERRAIN_SPEED_MULT, WATER_RADIATOR_MULT,
} from './terrain.js';

/** Bump on any behavior-affecting sim change (rules, math, formats). */
export const SIM_VERSION = '2.12.0';

/** FNV-1a 32-bit over a string; returned as 8 hex chars. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

let cached: string | null = null;

/**
 * Hash of everything data-shaped that defines sim behavior. Deterministic:
 * JSON.stringify follows insertion order, and all hashed objects are module
 * literals. Modifier `apply` functions can't be serialized — their source
 * text stands in for them (a changed formula changes the hash).
 */
export function simContentHash(): string {
  if (cached) return cached;
  const modifierFingerprint = Object.values(MODIFIERS).map((m) => ({
    id: m.id, kind: m.kind, blurb: m.blurb, tradeoff: m.tradeoff,
    maxCopiesPerBuild: m.maxCopiesPerBuild, apply: m.apply.toString(),
  }));
  cached = fnv1a(JSON.stringify({
    PARTS, CHASSIS, TEMPLATES, modifierFingerprint,
    dials: {
      AMBIENT_C, RADIATOR_CAP_KW, RADIATOR_K, CONDUCTION_K_NORMAL, CONDUCTION_K_PIPE,
      CELL_SIZE_M, CORE_HP, DEFAULT_ARENA_LENGTH_M, DEFAULT_ARENA_WIDTH_M,
      DEFAULT_SPAWN_DISTANCE_M, DEFAULT_TIMEOUT_S, TICK_S, AUTOPILOT_PERIOD_TICKS,
      TRACKING_LAG_S, MOVE_JITTER_MRAD_PER_MPS, ADDITIVE_POOL_FLOOR,
      RAM_AIR_MAX_BONUS, SPEED_SETTING_FRACTIONS, THERMOCOUPLE_K, THERMOCOUPLE_EFFICIENCY,
      COOLANT_CONDUCTANCE, EXTERIOR_PASSIVE_K, ROUTE_MASS_KG, WIRE_CAPACITY_KW,
      FOREST_COVER_MULT, HILL_RANGE_MULT, TERRAIN_CELL_SIZE_M, TERRAIN_SPEED_MULT, WATER_RADIATOR_MULT,
    },
  }));
  return cached;
}
