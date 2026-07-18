import { describe, expect, it } from 'vitest';
import type { Build, PlacedPart } from '../src/types.js';
import { Simulation } from '../src/simulation.js';
import { getChassis } from '../src/chassis.js';
import { runBattle } from '../src/combat.js';
import {
  generateTerrain, terrainAt, WATER_RADIATOR_MULT, type TerrainGrid, type TerrainType,
} from '../src/terrain.js';
import { CORE_INSTANCE_ID } from '../src/thermal.js';

function muleGunline(): Build {
  const parts: PlacedPart[] = [
    { instanceId: 'reactor', partId: 'R-C40', origin: { x: 3, y: 1 }, rotation: 0, integrity: 1 },
    { instanceId: 'ac', partId: 'W-AC', origin: { x: 1, y: 3 }, rotation: 0, integrity: 1 },
    { instanceId: 'con1', partId: 'U-CON', origin: { x: 3, y: 3 }, rotation: 0, integrity: 1 },
    { instanceId: 'rad', partId: 'U-RAD', origin: { x: 1, y: 0 }, rotation: 0, integrity: 1 },
  ];
  return { chassisId: 'CH-5', parts, powerPriority: [CORE_INSTANCE_ID, 'ac'] };
}

/** A uniform single-type grid for controlled battles. */
function flatTerrain(type: TerrainType): TerrainGrid {
  return {
    cellSizeM: 20, cols: 12, rows: 12,
    cells: Array.from({ length: 12 }, () => Array<TerrainType>(12).fill(type)),
  };
}

describe('terrain grid (docs/03 §2)', () => {
  it('generation is deterministic from the seed and mostly open', () => {
    const a = generateTerrain(1234, 240, 240);
    const b = generateTerrain(1234, 240, 240);
    expect(a).toEqual(b);
    expect(a.cols).toBe(12);
    expect(a.rows).toBe(12);
    const flat = a.cells.flat();
    const open = flat.filter((t) => t === 'open').length;
    expect(open / flat.length).toBeGreaterThan(0.5);
    for (const t of ['forest', 'hill', 'water'] as const) {
      expect(flat).toContain(t);
    }
    expect(generateTerrain(1235, 240, 240)).not.toEqual(a);
  });

  it('terrainAt maps arena-centered world coords to tiles and clamps at the walls', () => {
    const g = flatTerrain('open');
    g.cells[0]![0] = 'water'; // tile covering x,y in [-120,-100)
    expect(terrainAt(g, -110, -110)).toBe('water');
    expect(terrainAt(g, -119.9, -119.9)).toBe('water');
    expect(terrainAt(g, -99, -110)).toBe('open');
    expect(terrainAt(g, -500, -500)).toBe('water'); // clamps to edge tile
  });

  it('water multiplies radiator dissipation (coolant bath pulls more heat out of the mech)', () => {
    const chassis = getChassis('CH-5');
    const build = muleGunline();
    // Conduction limits how fast the hot spot itself drains (k=0.03), so the
    // honest measure is total heat retained across the mech, not peak temp.
    const run = (radiatorMult: number) => {
      const sim = new Simulation(chassis, build);
      let sum = 0;
      for (let i = 0; i < 2400; i++) {
        const snap = sim.step(0.05, { weaponsEnabled: { ac: true }, speedSetting: 'stationary', radiatorMult });
        sum = Object.values(snap.cellTempsC).reduce((s, t) => s + (t - 25), 0);
      }
      return sum;
    };
    const dry = run(1);
    const wet = run(WATER_RADIATOR_MULT);
    expect(wet).toBeLessThan(dry - 4);
  });

  it('forest cover makes a defender measurably harder to hit', () => {
    const seeds = [11, 12, 13, 14, 15];
    const rate = (terrain: TerrainGrid) => {
      let hit = 0;
      let fired = 0;
      for (const s of seeds) {
        const r = runBattle({ builds: [muleGunline(), muleGunline()], seed: s, terrain, timeoutS: 30 });
        hit += r.mechs[0].shotsHit;
        fired += r.mechs[0].shotsFired;
      }
      return hit / Math.max(fired, 1);
    };
    // Mech 0 shoots at a target either in the open or under tree cover.
    const openRate = rate(flatTerrain('open'));
    const coverRate = rate(flatTerrain('forest'));
    expect(coverRate).toBeLessThan(openRate);
  });

  it('a hill shooter reaches beyond its flat-ground despawn bound', () => {
    // W-AC despawn = 150 * 1.3 = 195; on a hill it stretches to ~244. At a
    // 220 m spawn the hill gunners open fire immediately; flat gunners must
    // close first. Compare time of first shot.
    const firstShotT = (terrain: TerrainGrid) => {
      const r = runBattle({ builds: [muleGunline(), muleGunline()], seed: 5, terrain, spawnDistanceM: 220, timeoutS: 30 });
      const first = r.events.find((e) => e.type === 'shot');
      return first ? first.tSec : Infinity;
    };
    expect(firstShotT(flatTerrain('hill'))).toBeLessThan(firstShotT(flatTerrain('open')));
  });

  it('battles with generated terrain stay deterministic', () => {
    const a = runBattle({ builds: [muleGunline(), muleGunline()], seed: 99 });
    const b = runBattle({ builds: [muleGunline(), muleGunline()], seed: 99 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
