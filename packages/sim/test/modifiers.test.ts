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
    expect(effectiveMults(fever, { tempC: 100, speedMps: 0, tile: 'open' }).cycleS).toBeCloseTo(0.85);
    expect(effectiveMults(fever, { tempC: 300, speedMps: 0, tile: 'open' }).cycleS).toBe(0.85); // floor

    const bore = part('b', 'W-AC', 0, 0, { modifiers: ['cold-bore'] });
    expect(effectiveMults(bore, { tempC: 30, speedMps: 0, tile: 'open' }).dispersionMrad).toBeCloseTo(0.5);
    expect(effectiveMults(bore, { tempC: 30, speedMps: 0, tile: 'open' }).damage).toBeCloseTo(1.0925);
    expect(effectiveMults(bore, { tempC: 80, speedMps: 0, tile: 'open' }).dispersionMrad).toBe(1);
    expect(effectiveMults(bore, { tempC: 80, speedMps: 0, tile: 'open' }).damage).toBeCloseTo(0.95);

    const tide = part('c', 'U-RAD', 0, 0, { modifiers: ['tidecooler'] });
    expect(effectiveMults(tide, { tempC: 25, speedMps: 0, tile: 'water' }).radiator).toBe(2);
    expect(effectiveMults(tide, { tempC: 25, speedMps: 0, tile: 'open' }).radiator).toBe(1);

    const hull = part('d', 'U-ACT', 0, 0, { modifiers: ['hull-down'] });
    expect(effectiveMults(hull, { tempC: 25, speedMps: 0.1, tile: 'open' }).targetProfile).toBeCloseTo(0.4);
    expect(effectiveMults(hull, { tempC: 25, speedMps: 2, tile: 'open' }).targetProfile).toBe(1);
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
    // A miswired laser sits FIRST in priority yet must be the one shed.
    //
    // A laser, because Miswired only rolls onto parts that draw
    // (`appliesTo: Boolean(d.draw)`) and ballistic guns no longer do -- they
    // fire mechanically, so nothing about brownout order can reach them. The
    // machine guns stay in the build precisely to show that: they are enabled
    // and firing throughout, and never appear in the shed list.
    const build: Build = {
      chassisId: 'CH-5',
      parts: [
        { ...part('reactor', 'R-E25', 3, 3), origin: { regionId: 'body', x: 3, y: 3 } },
        { ...part('mg1', 'W-MG', 3, 1), origin: { regionId: 'right-shoulder', x: 3, y: 1 } },
        { ...part('mg2', 'W-MG', 1, 1), origin: { regionId: 'left-shoulder', x: 1, y: 1 } },
        { ...part('las', 'W-LAS', 1, 3, { modifiers: ['miswired'] }), origin: { regionId: 'body', x: 1, y: 3 } },
        { ...part('act', 'U-ACT', 3, 5), origin: { regionId: 'body', x: 3, y: 5 } },
        { ...part('tc', 'U-TC1', 5, 3), origin: { regionId: 'body', x: 5, y: 3 } },
      ],
      routes: [
        { kind: 'wire', regionId: 'body', x: 1, y: 2 },
        { kind: 'wire', regionId: 'body', x: 4, y: 2 },
      ],
      powerPriority: [CORE_INSTANCE_ID, 'las', 'act', 'tc'],
    };
    const sim = new Simulation(getChassis('CH-5'), build);
    let lastShed: string[] = [];
    for (let t = 0; t < 100; t++) {
      lastShed = sim.step(1 / 20, {
        weaponsEnabled: { mg1: true, mg2: true, las: true },
        speedSetting: 'cruise',
      }).shedInstanceIds;
    }
    if (lastShed.length > 0) {
      expect(lastShed).toContain('las');
      // Mechanical guns are not shed-able at all, whatever the bus is doing.
      expect(lastShed).not.toContain('mg1');
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

  it('frankensteined trims part mass by 10%', () => {
    expect(effectiveMults(part('x', 'W-AC', 0, 0, { modifiers: ['frankensteined'] }), STATIC_CTX).massKg).toBeCloseTo(0.9);
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

describe('content-depth mods: surge gate, thermocouple skin (docs/04 §4b)', () => {
  it('surge gate gives its weapon first claim while a plain twin sheds', () => {
    // R-C40 cannot cover two lasers charging at 30 kW each. The surge-gate
    // laser must take first claim while the plain twin sheds — the mirror of
    // the Miswired test. Capacitors use the same acceptance order.
    const build: Build = {
      chassisId: 'CH-5',
      parts: [
        part('reactor', 'R-C40', 3, 1),
        part('mg1', 'W-LAS', 1, 3, { modifiers: ['surge-gate'] }),
        part('mg2', 'W-LAS', 2, 0),
      ],
      powerPriority: [CORE_INSTANCE_ID, 'mg2', 'mg1'], // mg1 last on paper — surge overrides
    };
    const sim = new Simulation(getChassis('CH-5'), build);
    let mg1ShedCount = 0;
    let mg2ShedCount = 0;
    for (let t = 0; t < 400; t++) {
      const shed = new Set(sim.step(1 / 20, { weaponsEnabled: { mg1: true, mg2: true }, speedSetting: 'stationary' }).shedInstanceIds);
      if (shed.has('mg1')) mg1ShedCount++;
      if (shed.has('mg2')) mg2ShedCount++;
    }
    expect(mg2ShedCount).toBeGreaterThan(0);        // the plain gun starves
    expect(mg1ShedCount).toBeLessThan(mg2ShedCount); // the surge gun stays fed
  });

  it('thermocouple skin cools its own cells by bleeding heat into charge', () => {
    // Identical reactor+capacitor builds; the thermocouple cap's cells must run
    // cooler than a plain cap's because it is pulling heat out into charge.
    const build = (thermo: boolean): Build => ({
      chassisId: 'CH-5',
      parts: [
        part('reactor', 'R-C40', 3, 1), // combustion → real waste heat
        part('cap', 'P-CAP', 3, 3, thermo ? { modifiers: ['thermocouple-skin'] } : {}),
        part('con1', 'U-CON', 2, 1),
        part('mg', 'W-MG', 1, 1),
      ],
      powerPriority: [CORE_INSTANCE_ID, 'mg'],
    });
    const capTemp = (thermo: boolean): number => {
      const sim = new Simulation(getChassis('CH-5'), build(thermo));
      for (let t = 0; t < 400; t++) sim.step(1 / 20, { weaponsEnabled: { mg: true }, speedSetting: 'stationary' });
      return sim.meanCellC('cap');
    };
    expect(capTemp(true)).toBeLessThan(capTemp(false) - 1);
  });

  it('appliesTo gates the new mods to their part classes', () => {
    expect(modifierIdsFor(getPart('W-AC'))).toContain('surge-gate');
    expect(modifierIdsFor(getPart('P-CAP'))).toContain('thermocouple-skin');
    expect(modifierIdsFor(getPart('P-CAP'))).not.toContain('surge-gate');
    expect(modifierIdsFor(getPart('W-AC'))).not.toContain('thermocouple-skin');
  });
});

describe('movement mods: coil-sprung, gyro flywheel, weaving gait', () => {
  it('coil-sprung buys down the mech-wide move-jitter share, at 15% servo mass', () => {
    const act = part('a', 'U-ACT', 0, 0, { modifiers: ['coil-sprung'] });
    expect(effectiveMults(act, { tempC: 25, speedMps: 6, tile: 'open' }).mechMoveJitter).toBeCloseTo(0.6);
    expect(effectiveMults(act, { tempC: 25, speedMps: 0, tile: 'open' }).massKg).toBeCloseTo(1.15);
    // Only scopes actuators, same as Hull-down — a weapon can't carry it.
    expect(MODIFIERS['coil-sprung']!.appliesTo(getPart('U-ACT'))).toBe(true);
    expect(MODIFIERS['coil-sprung']!.appliesTo(getPart('W-AC'))).toBe(false);
  });

  it('gyro flywheel halves the turn-jitter share and sheds heat whether or not you turn', () => {
    const act = part('a', 'U-ACT', 0, 0, { modifiers: ['gyro-flywheel'] });
    expect(effectiveMults(act, { tempC: 25, speedMps: 0, tile: 'open' }).turnJitter).toBeCloseTo(0.5);
    expect(effectiveMults(act, { tempC: 25, speedMps: 6, tile: 'open' }).turnJitter).toBeCloseTo(0.5);
    expect(effectiveMults(act, { tempC: 25, speedMps: 0, tile: 'open' }).extraHeatKw).toBeCloseTo(0.5);
  });

  it('weaving gait trades mech-wide move-jitter for a smaller profile above 4 m/s', () => {
    const act = part('a', 'U-ACT', 0, 0, { modifiers: ['weaving-gait'] });
    // The jitter cost is unconditional (it is inert at 0 m/s regardless).
    expect(effectiveMults(act, { tempC: 25, speedMps: 0, tile: 'open' }).mechMoveJitter).toBeCloseTo(1.3);
    expect(effectiveMults(act, { tempC: 25, speedMps: 6, tile: 'open' }).mechMoveJitter).toBeCloseTo(1.3);
    // The profile benefit only switches on above the 4 m/s threshold.
    expect(effectiveMults(act, { tempC: 25, speedMps: 3, tile: 'open' }).targetProfile).toBe(1);
    expect(effectiveMults(act, { tempC: 25, speedMps: 5, tile: 'open' }).targetProfile).toBeCloseTo(0.8);
  });

  it('appliesTo scopes all three to actuators only', () => {
    for (const id of ['coil-sprung', 'gyro-flywheel', 'weaving-gait']) {
      expect(modifierIdsFor(getPart('U-ACT')), id).toContain(id);
      expect(modifierIdsFor(getPart('W-AC')), id).not.toContain(id);
    }
  });
});
