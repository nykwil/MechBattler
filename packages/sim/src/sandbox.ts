/**
 * Workshop range sandbox (docs/02 §6 bench diagnostics): park the player's
 * build at a fixed distance from an inert armor dummy and measure damage with
 * the real combat rules -- arcs, dispersion, falloff, tracking, heat, power.
 * DPS is averaged over a long window (default 45 s) so slow-cycling weapons
 * (a 5 s railgun fires ~9 times) produce a stable number instead of noise.
 *
 * The shooter holds position facing the target with weapons on normal fire
 * control, so a gun the autopilot would gate (out of reach, overheated,
 * browned out) honestly measures 0 -- the readout shows doctrine, not theory.
 * Terrain is all-open: range is the only variable across targets.
 */
import { Battle, autopilotController, withManualOrders, type BattleEvent } from './combat.js';
import { getChassis } from './chassis.js';
import { getPart } from './catalog.js';
import type { Build } from './types.js';
import { TERRAIN_CELL_SIZE_M, type TerrainGrid } from './terrain.js';

export const SANDBOX_RANGES_M = [30, 60, 100, 150, 200] as const;
export const SANDBOX_DURATION_S = 45;

export interface SandboxWeaponRow {
  partId: string;
  name: string;
  shots: number;
  hits: number;
  dps: number;
}

export interface SandboxTargetResult {
  rangeM: number;
  /** Measurement window: durationS, or less if the dummy's core was destroyed. */
  elapsedS: number;
  dps: number;
  /** 0-1 across all shots fired; null if nothing fired. */
  hitFrac: number | null;
  shots: number;
  weapons: SandboxWeaponRow[];
  targetDestroyed: boolean;
}

function openTerrain(lengthM: number, widthM: number): TerrainGrid {
  const cols = Math.ceil(lengthM / TERRAIN_CELL_SIZE_M);
  const rows = Math.ceil(widthM / TERRAIN_CELL_SIZE_M);
  return {
    cellSizeM: TERRAIN_CELL_SIZE_M,
    cols,
    rows,
    cells: Array.from({ length: rows }, () => Array<'open'>(cols).fill('open')),
  };
}

/** An inert CH-9 slab of armor plate: no weapons, no power, just mass and HP. */
export function targetDummyBuild(): Build {
  const chassis = getChassis('CH-9');
  const parts: Build['parts'] = [];
  for (let y = 0; y < chassis.height; y++) {
    for (let x = 0; x < chassis.width; x++) {
      if (!chassis.mask[y]?.[x]) continue;
      if (x === chassis.coreCell.x && y === chassis.coreCell.y) continue;
      parts.push({
        instanceId: `dummy-${x}-${y}`,
        partId: 'U-ARM',
        origin: { x, y },
        rotation: 0,
        integrity: 1,
      });
    }
  }
  return { chassisId: 'CH-9', parts, powerPriority: [] };
}

export function runRangeSandbox(options: {
  build: Build;
  rangesM?: readonly number[];
  durationS?: number;
  seed?: number;
}): SandboxTargetResult[] {
  const rangesM = options.rangesM ?? SANDBOX_RANGES_M;
  const durationS = options.durationS ?? SANDBOX_DURATION_S;
  const seed = options.seed ?? 1;
  const dummy = targetDummyBuild();

  return rangesM.map((rangeM) => {
    const arenaLengthM = rangeM + 40;
    const arenaWidthM = 12; // narrow: spawn jitter shrinks to ±1 m, so range is exact
    const battle = new Battle({
      builds: [options.build, dummy],
      seed,
      spawnDistanceM: rangeM,
      arenaLengthM,
      arenaWidthM,
      terrain: openTerrain(arenaLengthM, arenaWidthM),
      timeoutS: durationS + 10,
      recordFrames: false,
      suppressSurrender: true,
      controllers: [
        withManualOrders(autopilotController, () => ({ move: 'hold', face: { mode: 'target' } })),
        () => [
          { verb: 'move', intent: 'hold', dest: null },
          { verb: 'throttle', setting: 'creep' },
        ],
      ],
    });
    while (battle.timeS < durationS && battle.step()) { /* run the window */ }

    const perWeapon = new Map<string, SandboxWeaponRow>();
    let shots = 0;
    let hits = 0;
    let damage = 0;
    for (const ev of battle.events as BattleEvent[]) {
      if (ev.type !== 'shot' || ev.mech !== 0) continue;
      let row = perWeapon.get(ev.partId);
      if (!row) {
        row = { partId: ev.partId, name: getPart(ev.partId).name, shots: 0, hits: 0, dps: 0 };
        perWeapon.set(ev.partId, row);
      }
      row.shots++;
      shots++;
      if (ev.hit) { row.hits++; hits++; }
      row.dps += ev.totalDamageDealt;
      damage += ev.totalDamageDealt;
    }
    const elapsedS = Math.max(battle.timeS, 1e-6);
    for (const row of perWeapon.values()) row.dps /= elapsedS;

    return {
      rangeM,
      elapsedS: battle.timeS,
      dps: damage / elapsedS,
      hitFrac: shots > 0 ? hits / shots : null,
      shots,
      weapons: [...perWeapon.values()].sort((a, b) => b.dps - a.dps),
      targetDestroyed: battle.finished,
    };
  });
}
