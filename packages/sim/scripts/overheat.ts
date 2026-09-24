/**
 * How hot does a mech get when the player spends heat (MW spec §4)?
 *
 * Runs each canonical template as side 0 against every other in three modes --
 * the autopilot's fire discipline, OVR held on (which is overdrive: guns cycle
 * faster and run hotter), and "alpha spam" (OVR plus an Alpha press on every
 * command window) -- and reports the peak weapon-cell and
 * reactor/core temperatures and when (if ever) the reactor or core first
 * reached HEAT_MECH_SHUTDOWN_C. That number decides whether a mech-wide
 * shutdown is a real risk, never happens, or is a trap -- measured, not guessed.
 *
 * `npm run sim:overheat [seeds]` prints the table at the shipped
 * SHOT_HEAT_TO_REACTOR_FRAC and OVERDRIVE_HEAT_MULT. `npm run sim:overheat --
 * --sweep [seeds]` repeats it over the SWEEP_HEAT_MULTS x SWEEP_FRACS grid,
 * passed through BattleOptions, so both constants are chosen from a
 * measurement rather than typed. OVERDRIVE_CYCLE_MULT is held. Report-only.
 */
import {
  Battle, TEMPLATES, CORE_INSTANCE_ID, HEAT_MECH_SHUTDOWN_C, SHOT_HEAT_TO_REACTOR_FRAC, OVERDRIVE_HEAT_MULT,
  OVERDRIVE_CYCLE_MULT, getPart,
  autopilotController, withManualOrders, type Combatant, type Controller,
} from '../src/index.js';

const args = process.argv.slice(2);
const SWEEP = args.includes('--sweep');
const SEEDS = Number(args.find((a) => !a.startsWith('--'))) || 3;
const SWEEP_HEAT_MULTS = [1.25, 1.5, 2.0, 3.0];
const SWEEP_FRACS = [0.3, 0.5, 1.0];

interface Knobs { frac?: number; heatMult?: number }

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

function run(mode: Mode, ti: number, knobs: Knobs): Row {
  const row: Row = { weaponPeak: -Infinity, corePeak: -Infinity, firstCrossS: null, wins: 0, fights: 0 };
  for (let tj = 0; tj < TEMPLATES.length; tj++) {
    if (tj === ti) continue;
    for (let s = 0; s < SEEDS; s++) {
      const battle = new Battle({
        builds: [TEMPLATES[ti]!.build, TEMPLATES[tj]!.build],
        seed: 4000 + s * 7919,
        controllers: [controllerFor(mode), autopilotController],
        recordFrames: false,
        ...(knobs.frac === undefined ? {} : { shotHeatToReactorFrac: knobs.frac }),
        ...(knobs.heatMult === undefined ? {} : { overdriveHeatMult: knobs.heatMult }),
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

/** The autopilot never sets overdrive, so its rows depend on the fraction alone. */
const autoCache = new Map<string, Row>();

function crossingVerdict(label: string, firsts: (number | null)[]): { splits: boolean; notATrap: boolean; text: string } {
  const crossed = firsts.filter((t): t is number => t !== null);
  const splits = crossed.length > 0 && crossed.length < firsts.length;
  const earliest = crossed.length > 0 ? Math.min(...crossed) : null;
  const notATrap = earliest !== null && earliest > 10;
  return {
    splits, notATrap,
    text: `${label}: ${crossed.length}/${firsts.length} cross, earliest ${earliest === null ? 'n/a' : `${earliest.toFixed(2)} s`}`,
  };
}

/** Prints one table and returns whether it meets Step 5b's two criteria (judged on the OVR column). */
function table(knobs: Knobs): boolean {
  console.log(
    `template                  | core peak auto / ovr / alpha | core ≥${HEAT_MECH_SHUTDOWN_C}°C at auto / ovr / alpha | weapon peak ovr | win auto / ovr / alpha`,
  );
  const autoFirsts: (number | null)[] = [];
  const ovrFirsts: (number | null)[] = [];
  const alphaFirsts: (number | null)[] = [];
  for (let i = 0; i < TEMPLATES.length; i++) {
    const key = `${knobs.frac}:${i}`;
    const auto = autoCache.get(key) ?? run('auto', i, knobs);
    autoCache.set(key, auto);
    const ovr = run('ovr', i, knobs);
    const alpha = run('alpha', i, knobs);
    autoFirsts.push(auto.firstCrossS);
    ovrFirsts.push(ovr.firstCrossS);
    alphaFirsts.push(alpha.firstCrossS);
    console.log(
      `${TEMPLATES[i]!.id.padEnd(25)} | ${f(auto.corePeak)} / ${f(ovr.corePeak)} / ${f(alpha.corePeak)} | ${
        at(auto.firstCrossS)} / ${at(ovr.firstCrossS)} / ${at(alpha.firstCrossS)} | ${f(ovr.weaponPeak)}          | ${
        win(auto)} / ${win(ovr)} / ${win(alpha)}`,
    );
  }
  // Step 5b's two criteria, read off the rows above: the OVR column decides, alpha-spam is reported.
  const autoSafe = autoFirsts.every((t) => t === null);
  const ovr = crossingVerdict('ovr', ovrFirsts);
  const alpha = crossingVerdict('alpha', alphaFirsts);
  const meets = autoSafe && ovr.splits && ovr.notATrap;
  console.log(
    `  autopilot never shuts down: ${autoSafe ? 'yes' : 'NO'} | ${ovr.text} (splits: ${ovr.splits ? 'yes' : 'NO'}, > 10 s: ${
      ovr.notATrap ? 'yes' : 'NO'}) | ${alpha.text} => ${meets ? 'MEETS BOTH' : 'fails'}`,
  );
  return meets;
}

if (SWEEP) {
  const passing: string[] = [];
  for (const heatMult of SWEEP_HEAT_MULTS) {
    for (const frac of SWEEP_FRACS) {
      console.log(`\n### OVERDRIVE_HEAT_MULT = ${heatMult}, SHOT_HEAT_TO_REACTOR_FRAC = ${frac} (cycle x${OVERDRIVE_CYCLE_MULT}, ${SEEDS} seeds)`);
      if (table({ frac, heatMult })) passing.push(`heat x${heatMult}, frac ${frac}`);
    }
  }
  // Grid order is smallest heat multiplier first, then smallest fraction.
  console.log(`\npassing pairs: ${passing.length ? passing.join('; ') : 'none'}${passing.length ? ` -- smallest: ${passing[0]}` : ''}`);
} else {
  console.log(`OVERDRIVE_HEAT_MULT = ${OVERDRIVE_HEAT_MULT}, SHOT_HEAT_TO_REACTOR_FRAC = ${SHOT_HEAT_TO_REACTOR_FRAC} (cycle x${OVERDRIVE_CYCLE_MULT}, ${SEEDS} seeds)`);
  table({});
}
