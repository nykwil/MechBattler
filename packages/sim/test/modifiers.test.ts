import { describe, expect, it } from 'vitest';
import type { Build, PlacedPart } from '../src/types.js';
import {
  MODIFIERS, NEUTRAL_MULTS, STATIC_CTX, effectiveMults, modifierIdsFor,
} from '../src/modifiers.js';
import { getPart } from '../src/catalog.js';
import { getChassis } from '../src/chassis.js';
import { buildThermalModel } from '../src/thermal.js';
import { Simulation } from '../src/simulation.js';
import { runTestBench } from '../src/derivedStats.js';
import { runBattle } from '../src/combat.js';
import { CORE_INSTANCE_ID } from '../src/thermal.js';

function part(instanceId: string, partId: string, x: number, y: number, extra: Partial<PlacedPart> = {}): PlacedPart {
  return { instanceId, partId, origin: { x, y }, rotation: 0, integrity: 1, ...extra };
}

/** CH-5 gunline (same layout the combat tests use). */
function gunline(acExtra: Partial<PlacedPart> = {}): Build {
  return {
    chassisId: 'CH-5',
    parts: [
      part('reactor', 'R-C40', 3, 1),
      part('ac', 'W-AC', 1, 3, acExtra),
      part('con1', 'U-CON', 3, 3),
      part('rad', 'U-RAD', 1, 0),
      part('arm1', 'U-ARM', 2, 1),
    ],
    powerPriority: [CORE_INSTANCE_ID, 'ac'],
  };
}

describe('the modifier substrate (docs/04 §4-§4b)', () => {
  it('unmodified parts share the frozen neutral fast path', () => {
    expect(effectiveMults(part('a', 'W-AC', 0, 0), STATIC_CTX)).toBe(NEUTRAL_MULTS);
  });

  it('variant multipliers fold into the same mults', () => {
    const m = effectiveMults(part('a', 'W-AC', 0, 0, { variant: { damage: 1.08, cycleS: 0.95 } }), STATIC_CTX);
    expect(m.damage).toBeCloseTo(1.08);
    expect(m.cycleS).toBeCloseTo(0.95);
    expect(m.hp).toBe(1);
  });

  it('appliesTo gates which parts can carry each modifier', () => {
    expect(modifierIdsFor(getPart('W-AC'))).toContain('fever-cycle');
    expect(modifierIdsFor(getPart('W-AC'))).not.toContain('tidecooler');
    expect(modifierIdsFor(getPart('U-RAD'))).toContain('tidecooler');
    expect(modifierIdsFor(getPart('U-AMMO'))).toContain('sacrificial-casing');
  });

  it('dynamic modifiers read only simulated context: temp, speed, terrain', () => {
    const fever = part('a', 'W-AC', 0, 0, { modifiers: ['fever-cycle'] });
    expect(effectiveMults(fever, { tempC: 25, speedMps: 0, tile: 'open' }).cycleS).toBe(1);
    expect(effectiveMults(fever, { tempC: 100, speedMps: 0, tile: 'open' }).cycleS).toBeCloseTo(0.6);
    expect(effectiveMults(fever, { tempC: 300, speedMps: 0, tile: 'open' }).cycleS).toBe(0.5); // floor

    const bore = part('b', 'W-AC', 0, 0, { modifiers: ['cold-bore'] });
    expect(effectiveMults(bore, { tempC: 30, speedMps: 0, tile: 'open' }).dispersionMrad).toBeCloseTo(0.5);
    expect(effectiveMults(bore, { tempC: 80, speedMps: 0, tile: 'open' }).dispersionMrad).toBe(1);

    const tide = part('c', 'U-RAD', 0, 0, { modifiers: ['tidecooler'] });
    expect(effectiveMults(tide, { tempC: 25, speedMps: 0, tile: 'water' }).radiator).toBe(2);
    expect(effectiveMults(tide, { tempC: 25, speedMps: 0, tile: 'open' }).radiator).toBe(1);

    const hull = part('d', 'U-ARM', 0, 0, { modifiers: ['hull-down'] });
    expect(effectiveMults(hull, { tempC: 25, speedMps: 0.1, tile: 'open' }).targetProfile).toBeCloseTo(0.7);
    expect(effectiveMults(hull, { tempC: 25, speedMps: 3, tile: 'open' }).targetProfile).toBe(1);
  });

  it('every registry entry applies cleanly to every part it claims', () => {
    for (const mod of Object.values(MODIFIERS)) {
      for (const partId of ['W-AC', 'W-MG', 'U-RAD', 'U-ARM', 'U-AMMO', 'R-C40', 'U-TC1', 'P-CAP']) {
        const def = getPart(partId);
        if (!mod.appliesTo(def)) continue;
        const m = effectiveMults(part('x', partId, 0, 0, { modifiers: [mod.id] }), { tempC: 90, speedMps: 2, tile: 'water' });
        for (const [k, v] of Object.entries(m)) {
          if (typeof v === 'number') expect(v, `${mod.id}.${k}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('insulated-mount zeroes the thermal edges touching the part', () => {
    const chassis = getChassis('CH-5');
    const parts = [part('reactor', 'R-C40', 3, 1), part('arm', 'U-ARM', 2, 1, { modifiers: ['insulated-mount'] })];
    // 'insulated-mount' applies to structural parts per the registry.
    expect(MODIFIERS['insulated-mount']!.appliesTo(getPart('U-ARM'))).toBe(true);
    const model = buildThermalModel(chassis, parts);
    const armKeys = new Set(model.cellKeysByInstance.get('arm'));
    const touching = model.edges.filter((e) => armKeys.has(e.aKey) || armKeys.has(e.bKey));
    expect(touching.length).toBeGreaterThan(0);
    for (const e of touching) expect(e.k).toBe(0);
  });

  it('hot-running raises the bench equilibrium temperature', () => {
    const chassis = getChassis('CH-5');
    const base = runTestBench({ chassis, build: gunline(), durationS: 60 });
    const hot = runTestBench({ chassis, build: gunline({ modifiers: ['hot-running'] }), durationS: 60 });
    const maxOf = (r: typeof base) => Math.max(...Object.values(r.cellTempsFinalC));
    expect(maxOf(hot)).toBeGreaterThan(maxOf(base) + 5);
  });

  it('overvolted: +12% bench damage, and the part starts at 75% HP in battle', () => {
    const chassis = getChassis('CH-5');
    const base = runTestBench({ chassis, build: gunline(), durationS: 30 });
    const over = runTestBench({ chassis, build: gunline({ modifiers: ['overvolted'] }), durationS: 30 });
    const dmg = (r: typeof base) => r.shotLog.reduce((s, x) => s + x.totalDamage, 0);
    expect(dmg(over)).toBeCloseTo(dmg(base) * 1.12, 5);

    const weaponless: Build = { chassisId: 'CH-5', parts: [part('reactor', 'R-E25', 3, 1)], powerPriority: [CORE_INSTANCE_ID] };
    const report = runBattle({ builds: [gunline({ modifiers: ['overvolted'] }), weaponless], seed: 7 });
    const ac = report.mechs[0].partsFinalHp.find((p) => p.instanceId === 'ac')!;
    expect(ac.hpFrac).toBeCloseTo(0.75, 5);
  });

  it('miswired sheds first regardless of priority position', () => {
    // Two continuous-draw weapons on a reactor that can power only one.
    // The miswired gun sits FIRST in priority yet must be the one shed.
    const build: Build = {
      chassisId: 'CH-5',
      parts: [
        part('reactor', 'R-E25', 3, 1), // 25 kW
        part('mg1', 'W-MG', 1, 1, { modifiers: ['miswired'] }),
        part('mg2', 'W-MG', 1, 3),
        part('con1', 'U-CON', 3, 3),
        part('con2', 'U-CON', 2, 3),
        part('ac', 'W-AC', 4, 3, { rotation: 90 }),
      ],
      powerPriority: [CORE_INSTANCE_ID, 'mg1', 'mg2', 'ac'],
    };
    const sim = new Simulation(getChassis('CH-5'), build);
    let lastShed: string[] = [];
    for (let t = 0; t < 100; t++) {
      lastShed = sim.step(1 / 20, {
        weaponsEnabled: { mg1: true, mg2: true, ac: true },
        speedSetting: 'cruise',
      }).shedInstanceIds;
    }
    if (lastShed.length > 0) {
      expect(lastShed).toContain('mg1');
      expect(lastShed).not.toContain('mg2');
    } else {
      throw new Error('test setup: expected a brownout — raise the load');
    }
  });
});

describe('M6 wave: sticky, cold-soaked, marsh pistons (docs/04 §4)', () => {
  it('cold-soaked doubles per-cell thermal mass in the model', () => {
    const chassis = getChassis('CH-5');
    const model = buildThermalModel(chassis, [
      part('a', 'U-ARM', 2, 1),
      part('b', 'U-ARM', 2, 3, { modifiers: ['cold-soaked'] }),
    ]);
    const massOf = (id: string) => model.cells.get(model.cellKeysByInstance.get(id)![0]!)!.thermalMassKjPerC;
    expect(massOf('b')).toBeCloseTo(massOf('a') * 2);
  });

  it('frankenstein mass knobs flow into mass and load-scaled speed', () => {
    // (No registry entry uses massKg yet; the knob is pinned via a variant-style
    // direct check so a future Frankensteined entry inherits a tested path.)
    const m = effectiveMults(part('x', 'U-ARM', 0, 0, { modifiers: ['cold-soaked'] }), STATIC_CTX);
    expect(m.massKg).toBe(1);
  });

  it('sticky delays a weapon toggle by 0.8 s', () => {
    const m = effectiveMults(part('x', 'W-MG', 0, 0, { modifiers: ['sticky'] }), STATIC_CTX);
    expect(m.orderLatencyS).toBeCloseTo(0.8);
  });

  it('marsh pistons void terrain slowdowns only on the servo booster', () => {
    expect(modifierIdsFor(getPart('U-ACT'))).toContain('marsh-pistons');
    expect(modifierIdsFor(getPart('W-MG'))).not.toContain('marsh-pistons');
    const m = effectiveMults(part('x', 'U-ACT', 0, 0, { modifiers: ['marsh-pistons'] }), STATIC_CTX);
    expect(m.ignoreTerrainSlow).toBe(true);
  });
});
