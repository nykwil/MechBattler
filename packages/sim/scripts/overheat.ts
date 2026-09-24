/**
 * How hot does a mech get when the player spends heat (MW spec §4)?
 *
 * Runs each canonical template as side 0 against every other, once with the
 * autopilot's fire discipline and once with OVR held on, and reports the peak
 * weapon-cell and reactor/core temperatures and when (if ever) the reactor or
 * core first reached HEAT_SHUTDOWN_C. That number decides whether a mech-wide
 * shutdown is a real risk, never happens, or is a trap -- measured, not guessed.
 *
 * `npm run sim:overheat [seeds]`. Report-only.
 */
import {
  Battle, TEMPLATES, CORE_INSTANCE_ID, HEAT_SHUTDOWN_C, getPart,
  autopilotController, withManualOrders, type Combatant,
} from '../src/index.js';

const SEEDS = Number(process.argv[2]) || 3;

function peakOf(c: Combatant, ids: string[]): number {
  let max = -Infinity;
  for (const id of ids) {
    for (const k of c.sim.thermal.cellKeysByInstance.get(id) ?? []) {
      const t = c.sim.thermal.cells.get(k)!.tempC;
      if (t > max) max = t;
    }
  }
  return max;
}

interface Row { weaponPeak: number; corePeak: number; firstCrossS: number | null; wins: number; fights: number }

function run(overrideHeat: boolean, ti: number): Row {
  const row: Row = { weaponPeak: -Infinity, corePeak: -Infinity, firstCrossS: null, wins: 0, fights: 0 };
  for (let tj = 0; tj < TEMPLATES.length; tj++) {
    if (tj === ti) continue;
    for (let s = 0; s < SEEDS; s++) {
      const battle = new Battle({
        builds: [TEMPLATES[ti]!.build, TEMPLATES[tj]!.build],
        seed: 4000 + s * 7919,
        controllers: [withManualOrders(autopilotController, () => ({ overrideHeat })), autopilotController],
      });
      const me = battle.combatants[0];
      const weaponIds = me.build.parts.filter((p) => getPart(p.partId).category === 'weapon').map((p) => p.instanceId);
      const coreIds = [CORE_INSTANCE_ID, ...me.build.parts.filter((p) => getPart(p.partId).category === 'reactor').map((p) => p.instanceId)];
      while (battle.step()) {
        row.weaponPeak = Math.max(row.weaponPeak, peakOf(me, weaponIds));
        const core = peakOf(me, coreIds);
        row.corePeak = Math.max(row.corePeak, core);
        if (core >= HEAT_SHUTDOWN_C && (row.firstCrossS === null || battle.timeS < row.firstCrossS)) row.firstCrossS = battle.timeS;
      }
      row.fights++;
      if (battle.report().winner === 0) row.wins++;
    }
  }
  return row;
}

const f = (n: number) => n.toFixed(1).padStart(6);
console.log(`template                  | weapon peak off/on | core peak off/on | core ≥${HEAT_SHUTDOWN_C}°C at (on) | win off/on`);
for (let i = 0; i < TEMPLATES.length; i++) {
  const off = run(false, i);
  const on = run(true, i);
  console.log(
    `${TEMPLATES[i]!.id.padEnd(25)} | ${f(off.weaponPeak)} / ${f(on.weaponPeak)} | ${f(off.corePeak)} / ${f(on.corePeak)} | ${
      on.firstCrossS === null ? '   never' : `${on.firstCrossS.toFixed(1).padStart(6)} s`} | ${
      (off.wins / off.fights).toFixed(2)} / ${(on.wins / on.fights).toFixed(2)}`,
  );
}
