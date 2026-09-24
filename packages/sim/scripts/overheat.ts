/**
 * How hot does a mech get when the player spends heat (MW spec §4)?
 *
 * Runs each canonical template as side 0 against every other in three modes --
 * the autopilot's fire discipline, OVR held on, and "alpha spam" (OVR plus an
 * Alpha press on every command window) -- and reports the peak weapon-cell and
 * reactor/core temperatures and when (if ever) the reactor or core first
 * reached HEAT_MECH_SHUTDOWN_C. That number decides whether a mech-wide
 * shutdown is a real risk, never happens, or is a trap -- measured, not guessed.
 *
 * `npm run sim:overheat [seeds]` prints the table at the shipped
 * SHOT_HEAT_TO_REACTOR_FRAC. `npm run sim:overheat -- --sweep [seeds]` repeats
 * it for each fraction in SWEEP_FRACS, passed through BattleOptions, so the
 * constant is chosen from a measurement rather than typed. Report-only.
 */
import {
  Battle, TEMPLATES, CORE_INSTANCE_ID, HEAT_MECH_SHUTDOWN_C, SHOT_HEAT_TO_REACTOR_FRAC, getPart,
  autopilotController, withManualOrders, type Combatant, type Controller,
} from '../src/index.js';

const args = process.argv.slice(2);
const SWEEP = args.includes('--sweep');
const SEEDS = Number(args.find((a) => !a.startsWith('--'))) || 3;
const SWEEP_FRACS = [0.1, 0.2, 0.3, 0.5, 0.75, 1.0];

type Mode = 'auto' | 'ovr' | 'alpha';

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

function controllerFor(mode: Mode): Controller {
  if (mode === 'auto') return autopilotController;
  if (mode === 'ovr') return withManualOrders(autopilotController, () => ({ overrideHeat: true }));
  // A fresh token every command window is a fresh Alpha press (MW spec §3).
  let presses = 0;
  return withManualOrders(autopilotController, () => ({ overrideHeat: true, alpha: ++presses }));
}

interface Row { weaponPeak: number; corePeak: number; firstCrossS: number | null; wins: number; fights: number }

function run(mode: Mode, ti: number, frac: number | undefined): Row {
  const row: Row = { weaponPeak: -Infinity, corePeak: -Infinity, firstCrossS: null, wins: 0, fights: 0 };
  for (let tj = 0; tj < TEMPLATES.length; tj++) {
    if (tj === ti) continue;
    for (let s = 0; s < SEEDS; s++) {
      const battle = new Battle({
        builds: [TEMPLATES[ti]!.build, TEMPLATES[tj]!.build],
        seed: 4000 + s * 7919,
        controllers: [controllerFor(mode), autopilotController],
        recordFrames: false,
        ...(frac === undefined ? {} : { shotHeatToReactorFrac: frac }),
      });
      const me = battle.combatants[0];
      const weaponIds = me.build.parts.filter((p) => getPart(p.partId).category === 'weapon').map((p) => p.instanceId);
      const coreIds = [CORE_INSTANCE_ID, ...me.build.parts.filter((p) => getPart(p.partId).category === 'reactor').map((p) => p.instanceId)];
      while (battle.step()) {
        row.weaponPeak = Math.max(row.weaponPeak, peakOf(me, weaponIds));
        const core = peakOf(me, coreIds);
        row.corePeak = Math.max(row.corePeak, core);
        if (core >= HEAT_MECH_SHUTDOWN_C && (row.firstCrossS === null || battle.timeS < row.firstCrossS)) row.firstCrossS = battle.timeS;
      }
      row.fights++;
      if (battle.report().winner === 0) row.wins++;
    }
  }
  return row;
}

const f = (n: number) => n.toFixed(1).padStart(6);
const at = (s: number | null) => (s === null ? '   never' : `${s.toFixed(1).padStart(6)} s`);
const win = (r: Row) => (r.wins / r.fights).toFixed(2);

function table(frac: number | undefined): void {
  console.log(
    `template                  | core peak auto / ovr / alpha | core ≥${HEAT_MECH_SHUTDOWN_C}°C at auto / ovr / alpha | weapon peak ovr | win auto / ovr / alpha`,
  );
  const crossings: { auto: number[]; alpha: (number | null)[] } = { auto: [], alpha: [] };
  for (let i = 0; i < TEMPLATES.length; i++) {
    const auto = run('auto', i, frac);
    const ovr = run('ovr', i, frac);
    const alpha = run('alpha', i, frac);
    if (auto.firstCrossS !== null) crossings.auto.push(auto.firstCrossS);
    crossings.alpha.push(alpha.firstCrossS);
    console.log(
      `${TEMPLATES[i]!.id.padEnd(25)} | ${f(auto.corePeak)} / ${f(ovr.corePeak)} / ${f(alpha.corePeak)} | ${
        at(auto.firstCrossS)} / ${at(ovr.firstCrossS)} / ${at(alpha.firstCrossS)} | ${f(ovr.weaponPeak)}          | ${
        win(auto)} / ${win(ovr)} / ${win(alpha)}`,
    );
  }
  // Step 5b's two criteria, read off the rows above.
  const crossed = crossings.alpha.filter((s): s is number => s !== null);
  const autoSafe = crossings.auto.length === 0;
  const splits = crossed.length > 0 && crossed.length < crossings.alpha.length;
  const earliest = crossed.length > 0 ? Math.min(...crossed) : null;
  const notATrap = earliest !== null && earliest > 10;
  console.log(
    `  autopilot never shuts down: ${autoSafe ? 'yes' : 'NO'} | alpha-spam splits the roster: ${splits ? 'yes' : 'NO'} `
    + `(${crossed.length}/${crossings.alpha.length} cross) | earliest alpha crossing ${earliest === null ? 'n/a' : `${earliest.toFixed(2)} s`} > 10 s: ${notATrap ? 'yes' : 'NO'}`
    + ` => ${autoSafe && splits && notATrap ? 'MEETS BOTH' : 'fails'}`,
  );
}

if (SWEEP) {
  for (const frac of SWEEP_FRACS) {
    console.log(`\n### SHOT_HEAT_TO_REACTOR_FRAC = ${frac} (${SEEDS} seeds)`);
    table(frac);
  }
} else {
  console.log(`SHOT_HEAT_TO_REACTOR_FRAC = ${SHOT_HEAT_TO_REACTOR_FRAC} (${SEEDS} seeds)`);
  table(undefined);
}
