/**
 * System-attacking weapons + capacitor depth (docs/07 Track C §4, content
 * pass Jul 22 2026): the flamer cooks the target's cells, the ion cannon
 * bleeds its stored charge, and the Reservoir is the big-alpha capacitor.
 */
import { describe, expect, it } from 'vitest';
import { Battle, runBattle } from '../src/combat.js';
import { Simulation } from '../src/simulation.js';
import { getChassis } from '../src/chassis.js';
import { getPart } from '../src/catalog.js';
import { CORE_INSTANCE_ID } from '../src/thermal.js';
import { targetDummyBuild } from '../src/sandbox.js';
import type { Build, PlacedPart } from '../src/types.js';

function part(instanceId: string, partId: string, x: number, y: number, rotation: 0 | 90 = 0): PlacedPart {
  return { instanceId, partId, origin: { x, y }, rotation, integrity: 1 };
}

/** CH-5 shooter: reactor + the given weapon (2×2 or line), wired by one conduit. */
function shooterWith(weaponId: string): Build {
  const weaponOrigin = weaponId === 'W-ION'
    ? { regionId: 'body', x: 0, y: 4 }
    : { regionId: 'body', x: 1, y: 3 };
  return {
    chassisId: 'CH-5',
    parts: [
      { ...part('reactor', 'R-C40', 3, 2), origin: { regionId: 'body', x: 3, y: 2 } },
      { ...part('con', 'U-CON', 3, 4), origin: { regionId: 'body', x: 3, y: 4 } },
      { ...part('wpn', weaponId, weaponOrigin.x, weaponOrigin.y), origin: weaponOrigin },
    ],
    // Gun first so the 30 kW charged Static is not shed behind locomotion.
    powerPriority: ['wpn', CORE_INSTANCE_ID],
  };
}

describe('catalog: the new content exists and is shaped right', () => {
  it('Scald and Static are system-attacking weapons', () => {
    expect(getPart('W-SC').weapon!.enemyHeatKj).toBeGreaterThan(0);
    expect(getPart('W-SC').weapon!.capDrainKj).toBeUndefined();
    expect(getPart('W-ION').weapon!.capDrainKj).toBeGreaterThan(0);
    expect(getPart('W-ION').weapon!.enemyHeatKj).toBeUndefined();
  });

  it('Reservoir banks far more than the Jolt', () => {
    expect(getPart('P-CAP2').capacitor!.storedKj).toBeGreaterThan(getPart('P-CAP').capacitor!.storedKj * 3);
    expect(getPart('P-CAP2').capacitor!.chargeKw).toBeLessThan(getPart('P-CAP').capacitor!.dischargeKw);
  });
});

describe('Simulation system-attack hooks (docs/07 Track C §4)', () => {
  it('depositHeatAtCell raises exactly the struck cell', () => {
    const sim = new Simulation(getChassis('CH-5'), shooterWith('W-AC'));
    const key = sim.thermal.cellKeysByInstance.get('reactor')![0]!;
    const before = sim.meanCellC('reactor');
    sim.depositHeatAtCell(key, 40);
    expect(sim.meanCellC('reactor')).toBeGreaterThan(before);
    sim.depositHeatAtCell('999,999', 40); // off-grid: no throw, no effect
  });

  it('drainCapacitorChargeKj bleeds charge proportionally and clamps at empty', () => {
    const build: Build = {
      chassisId: 'CH-5',
      parts: [part('reactor', 'R-C40', 3, 1), part('cap', 'P-CAP', 1, 0, 90), part('con', 'U-CON', 2, 1)],
      powerPriority: [CORE_INSTANCE_ID],
    };
    const sim = new Simulation(getChassis('CH-5'), build);
    const stored = () => sim.capacitorLevels().reduce((s, v) => s + v, 0);
    const full = stored(); // fresh caps start full
    expect(full).toBeGreaterThan(0);
    expect(sim.drainCapacitorChargeKj(20)).toBeCloseTo(20, 5);
    expect(stored()).toBeCloseTo(full - 20, 5);
    sim.drainCapacitorChargeKj(1e9); // over-drain clamps to empty
    expect(stored()).toBe(0);
    expect(sim.drainCapacitorChargeKj(10)).toBe(0); // nothing left to take
  });
});

describe('the weapons cook and drain in a real battle', () => {
  it('the flamer heats an inert target that a machine gun leaves at ambient', () => {
    // The dummy is armor-only with no reactor, so it has no heat source of its
    // own — any elevated cell temperature is heat the flamer deposited.
    const peakEnemyTemp = (weaponId: string): number => {
      const battle = new Battle({
        builds: [shooterWith(weaponId), targetDummyBuild()],
        seed: 3, spawnDistanceM: 25, suppressSurrender: true,
      });
      let peak = 25;
      for (let t = 0; t < 400 && !battle.finished; t++) {
        battle.step();
        const f = battle.latestFrame();
        if (f) peak = Math.max(peak, f.mechs[1].hottestCellC);
      }
      return peak;
    };
    expect(peakEnemyTemp('W-MG')).toBeLessThan(35);   // MG deposits no enemy heat
    // Most accurate hits land on chassis tickets now; equipment hits still
    // carry enough Scald heat to rise clearly above the inert MG control.
    expect(peakEnemyTemp('W-SC')).toBeGreaterThan(40);
  });

  it('the ion cannon leaves a cap-fed enemy with less stored charge than an MG does', () => {
    // An idle Reservoir stays full under MG fire; Static drains it on every
    // successful mech hit, including a chassis-ticket impact.
    const railTarget: Build = {
      chassisId: 'CH-5',
      parts: [
        { ...part('reactor', 'R-C40', 3, 2), origin: { regionId: 'body', x: 3, y: 2 } },
        { ...part('cap', 'P-CAP2', 0, 3), origin: { regionId: 'body', x: 0, y: 3 } },
        { ...part('con', 'U-CON', 2, 3), origin: { regionId: 'body', x: 2, y: 3 } },
        { ...part('arm', 'U-ARM', 1, 0), origin: { regionId: 'left-shoulder', x: 1, y: 0 } },
      ],
      powerPriority: [CORE_INSTANCE_ID],
    };
    // Read the *lowest* charge the battle ever drove it to, not the charge at
    // the end. A weaponless mech used to run when its guns died, and spent its
    // power doing it; it stands still now, so its reactor tops the Reservoir
    // back up between hits and the final reading is full either way. The drain
    // is still there — the end state just cannot see it.
    const lowestEnemyCharge = (weaponId: string): number => {
      const battle = new Battle({
        builds: [shooterWith(weaponId), railTarget],
        seed: 7, spawnDistanceM: 60, suppressSurrender: true,
      });
      let lowest = Infinity;
      for (let t = 0; t < 300 && !battle.finished; t++) {
        battle.step();
        lowest = Math.min(lowest, battle.latestFrame()?.mechs[1].capacitorKj ?? Infinity);
      }
      return lowest;
    };
    expect(lowestEnemyCharge('W-ION')).toBeLessThan(lowestEnemyCharge('W-MG'));
  });

  it('a flamer-armed mech still resolves a battle to a normal decision', () => {
    const report = runBattle({ builds: [shooterWith('W-SC'), targetDummyBuild()], seed: 1, spawnDistanceM: 30 });
    expect(['chassis-failure', 'mission-kill', 'judges']).toContain(report.reason);
  });
});
