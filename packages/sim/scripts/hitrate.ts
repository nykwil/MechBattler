/**
 * Hit rate across the template round robin, broken down by weapon and by how
 * fast the target was crossing.
 *
 * This exists because "I'm still seeing every single bullet hit" was reported
 * three separate times from play, and each time the answer was a single pooled
 * percentage. A pooled number cannot tell an accurate gun from a game with no
 * misses in it, and it cannot show whether movement buys anything -- which is
 * the actual design question. Sorting shots by the target's crossing speed at
 * the moment of firing answers it directly: if the slow and fast columns are
 * the same number, evasion is decorative.
 *
 * `npm run sim:hitrate`. Takes about a minute.
 */
import { Battle, TEMPLATES } from '../src/index.js';

const SEEDS = Number(process.argv[2]) || 6;
/** Crossing-speed buckets, m/s of target motion across the line of sight. */
const BANDS = [0.5, 2, 4];

interface Tally { shots: number; hits: number }
const tally = (): Tally => ({ shots: 0, hits: 0 });
const pct = (t: Tally) => (t.shots === 0 ? '   —  ' : `${((100 * t.hits) / t.shots).toFixed(1)}%`.padStart(6));

const overall = tally();
const byWeapon = new Map<string, Tally>();
const byBand = BANDS.map(() => tally()).concat([tally()]);
const byWeaponBand = new Map<string, Tally[]>();

const started = Date.now();
for (let i = 0; i < TEMPLATES.length; i++) {
  for (let j = i + 1; j < TEMPLATES.length; j++) {
    for (let s = 0; s < SEEDS; s++) {
      const battle = new Battle({
        builds: [TEMPLATES[i].build, TEMPLATES[j].build],
        seed: 1000 + s * 7919,
      });
      while (!battle.finished) battle.step();
      const report = battle.report();
      const frames = report.frames;
      for (const e of report.events) {
        if (e.type !== 'shot') continue;
        overall.shots++;
        if (e.hit) overall.hits++;

        const w = byWeapon.get(e.partId) ?? tally();
        w.shots++;
        if (e.hit) w.hits++;
        byWeapon.set(e.partId, w);

        // Frames carry position and time but not velocity, so the target's motion
        // is differenced across the frame pair straddling the shot rather than
        // guessed at -- the sim's own state, one derivative down.
        const fi = Math.min(frames.length - 2, Math.max(0, Math.round((e.tSec / report.durationS) * (frames.length - 1))));
        const f = frames[fi];
        const g = frames[fi + 1];
        const dt = Math.max(1e-6, g.tSec - f.tSec);
        const foe = (1 - e.mech) as 0 | 1;
        const shooter = f.mechs[e.mech];
        const target = f.mechs[foe];
        const vx = (g.mechs[foe].x - target.x) / dt;
        const vy = (g.mechs[foe].y - target.y) / dt;
        const dx = target.x - shooter.x;
        const dy = target.y - shooter.y;
        const d = Math.hypot(dx, dy) || 1;
        // Only motion *across* the sight line creates lead error; closing straight
        // in does not. Same decomposition the hit model uses.
        const cross = Math.abs((-dy / d) * vx + (dx / d) * vy);
        let band = BANDS.length;
        for (let b = 0; b < BANDS.length; b++) {
          if (cross < BANDS[b]) { band = b; break; }
        }
        byBand[band].shots++;
        if (e.hit) byBand[band].hits++;
        const wb = byWeaponBand.get(e.partId) ?? BANDS.map(() => tally()).concat([tally()]);
        wb[band].shots++;
        if (e.hit) wb[band].hits++;
        byWeaponBand.set(e.partId, wb);
      }
    }
  }
}

const headers = BANDS.map((b, i) => (i === 0 ? `<${b}` : `${BANDS[i - 1]}-${b}`)).concat([`${BANDS[BANDS.length - 1]}+`]);
console.log(`Hit rate over ${overall.shots} shots (${TEMPLATES.length} templates, ${SEEDS} seeds each pairing)\n`);
console.log(`overall ${pct(overall)}`);
console.log(`\nBy target crossing speed (m/s across the line of sight):`);
console.log(`  ${'weapon'.padEnd(8)}${headers.map((h) => h.padStart(8)).join('')}${'all'.padStart(9)}`);
console.log(`  ${'every'.padEnd(8)}${byBand.map((t) => pct(t).padStart(8)).join('')}${pct(overall).padStart(9)}`);
for (const [id, t] of [...byWeapon].sort((a, b) => b[1].shots - a[1].shots)) {
  const wb = byWeaponBand.get(id)!;
  console.log(`  ${id.padEnd(8)}${wb.map((x) => pct(x).padStart(8)).join('')}${pct(t).padStart(9)}  (${t.shots})`);
}

/**
 * The one number this script exists to defend: how much less often a fast
 * crosser is hit than a near-stationary target. If it collapses, movement has
 * stopped being a defence and the accuracy model has quietly flattened again --
 * which is the regression that prompted three separate play reports of "every
 * bullet hits", none of which a pooled percentage could have caught.
 *
 * The floor is deliberately far below the measured value (53 points as of Aug
 * 2026) because this is a canary for the model going flat, not a balance target;
 * tuning within the band above it is expected and must not fail the run.
 */
const MIN_EVASION_SPREAD_POINTS = 25;

const spread = (byBand[0].shots > 0 && byBand[byBand.length - 1].shots > 0)
  ? (byBand[0].hits / byBand[0].shots) - (byBand[byBand.length - 1].hits / byBand[byBand.length - 1].shots)
  : 0;
const spreadPoints = 100 * spread;
console.log(`\nevasion is worth ${spreadPoints.toFixed(1)} points of hit rate`);
console.log(`${((Date.now() - started) / 1000).toFixed(1)}s`);
if (spreadPoints < MIN_EVASION_SPREAD_POINTS) {
  console.error(
    `\nFAIL: evasion is worth only ${spreadPoints.toFixed(1)} points, floor is ${MIN_EVASION_SPREAD_POINTS}.`
    + `\nCrossing in front of a gun has stopped mattering — check TRACKING_LAG_S,`
    + ` MOVE_JITTER_MRAD_PER_MPS, the lateral penalty, and projectile speeds.`,
  );
  process.exitCode = 1;
}
