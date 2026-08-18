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

/** Where a weapon's window went when it wasn't cleared to fire. */
export type SandboxDownCause = 'range' | 'arc' | 'minrange' | 'heat' | 'power' | 'shutdown' | 'destroyed';

export interface SandboxWeaponRow {
  partId: string;
  name: string;
  shots: number;
  hits: number;
  dps: number;
  /** Fraction of the window this gun was cleared to fire (docs/09 M5). */
  uptimeFrac: number;
  /** Fractions of the window by silence cause; sums with uptimeFrac to ~1. */
  downFracs: Partial<Record<SandboxDownCause, number>>;
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
      // Frames feed the uptime attribution below (docs/09 M5).
      recordFrames: true,
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

    // Every mounted gun gets a row, so a weapon that never fired still shows
    // its window attribution instead of silently vanishing.
    const perWeapon = new Map<string, SandboxWeaponRow>();
    const rowByInstance = new Map<string, SandboxWeaponRow>();
    for (const p of options.build.parts) {
      const def = getPart(p.partId);
      if (def.category !== 'weapon') continue;
      let row = perWeapon.get(p.partId);
      if (!row) {
        row = { partId: p.partId, name: def.name, shots: 0, hits: 0, dps: 0, uptimeFrac: 0, downFracs: {} };
        perWeapon.set(p.partId, row);
      }
      rowByInstance.set(p.instanceId, row);
    }
    let shots = 0;
    let hits = 0;
    let damage = 0;
    for (const ev of battle.events as BattleEvent[]) {
      if (ev.type !== 'shot' || ev.mech !== 0) continue;
      const row = perWeapon.get(ev.partId);
      if (!row) continue;
      row.shots++;
      shots++;
      if (ev.hit) { row.hits++; hits++; }
      row.dps += ev.totalDamageDealt;
      damage += ev.totalDamageDealt;
    }
    const elapsedS = Math.max(battle.timeS, 1e-6);
    for (const row of perWeapon.values()) row.dps /= elapsedS;

    // Uptime attribution (docs/09 M5): per frame, a gun is either cleared to
    // fire or silenced for a nameable cause — the M2 gate reasons plus the
    // power/heat status ladder. Duplicate mounts pool into one row.
    const frameCount = battle.frames.length;
    if (frameCount > 0) {
      for (const frame of battle.frames) {
        for (const wf of frame.mechs[0].weapons) {
          const row = rowByInstance.get(wf.instanceId);
          if (!row) continue;
          // gate=null while disabled is the 4 Hz order-reissue lag (the gun is
          // physically clear; fire control just hasn't ticked) — count it as
          // up rather than inventing a spurious cause.
          const cause: SandboxDownCause | 'up' =
            wf.status === 'destroyed' ? 'destroyed'
              : wf.status === 'shutdown' ? 'shutdown'
                : wf.status === 'shed' ? 'power'
                  : wf.enabled ? 'up'
                    : wf.gate ?? 'up';
          if (cause === 'up') row.uptimeFrac += 1;
          else row.downFracs[cause] = (row.downFracs[cause] ?? 0) + 1;
        }
      }
      const instancesPerRow = new Map<SandboxWeaponRow, number>();
      for (const row of rowByInstance.values()) instancesPerRow.set(row, (instancesPerRow.get(row) ?? 0) + 1);
      for (const [row, n] of instancesPerRow) {
        const total = frameCount * n;
        row.uptimeFrac /= total;
        for (const k of Object.keys(row.downFracs) as SandboxDownCause[]) row.downFracs[k]! /= total;
      }
    }

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
