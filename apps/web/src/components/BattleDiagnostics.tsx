import {
  CELL_SIZE_M, TICK_S,
  computeHitModel, falloffAt, getChassis, getPart, meanSilhouetteHalfWidthM,
  MOVE_JITTER_MRAD_PER_MPS, SPEED_SETTING_FRACTIONS, TRACKING_LAG_BASE_S,
  type BattleFrame,
} from '@mechbattler/sim';
import { crossingSpeedMps } from '../lib/evade.js';
import { frameIndexAt, type BattleView } from './BattleHud.js';
import './BattleDiagnostics.css';

/**
 * The diagnostics overlay from docs/prototypes/mobile-battle.html — every term the
 * movement and gunnery models use, live, laid on the glass and toggled by the ƒx
 * button. It was in the prototype and never ported.
 *
 * It is a debugging instrument, not a player-facing screen: it exists so a wrong
 * number can be traced to the term that produced it. Deliberately dense.
 *
 * Every figure is read from the sim — `computeHitModel` for the shot, the frame for
 * kinematics, `falloffAt` for damage against range. Nothing here re-derives the
 * models it is reporting on, because an instrument that computes its own answer
 * cannot disagree with the thing it is measuring, which is the only reason to have
 * it.
 */
export function BattleDiagnostics({ view, frame, tSec }: {
  view: BattleView;
  frame: BattleFrame;
  tSec: number;
}) {
  const me = frame.mechs[0];
  const foe = frame.mechs[1];
  const chassis = getChassis(view.mechs[0].chassisId);
  const speeds = chassis.speedsMps;

  const idx = frameIndexAt(view, tSec);
  const prev = idx > 0 ? view.frames[idx - 1] : undefined;
  const speed = prev ? Math.hypot(me.x - prev.mechs[0].x, me.y - prev.mechs[0].y) / TICK_S : 0;
  const heading = prev && speed > 0.01
    ? Math.atan2(me.y - prev.mechs[0].y, me.x - prev.mechs[0].x)
    : me.facingRad;
  const angleOff = Math.atan2(Math.sin(heading - me.facingRad), Math.cos(heading - me.facingRad));
  const throttle = SPEED_SETTING_FRACTIONS[me.speedSetting];

  // The speed envelope: forward right, reverse left, strafe vertical. Interpolated
  // between the chassis's three axis speeds, which is the shape the sim moves on.
  const R = 34;
  const scale = R / Math.max(speeds.fwd, 1e-6);
  const ceilingAt = (a: number) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const along = c >= 0 ? speeds.fwd : speeds.rev;
    return Math.hypot(c * along, s * speeds.strafe);
  };
  let path = '';
  for (let i = 0; i <= 72; i += 1) {
    const a = (i / 72) * Math.PI * 2;
    const v = ceilingAt(a) * scale;
    path += `${i ? 'L' : 'M'}${(40 + Math.cos(a) * v).toFixed(1)} ${(40 + Math.sin(a) * v).toFixed(1)} `;
  }
  const ceiling = ceilingAt(angleOff);
  const useOfMax = ceiling > 0 ? speed / ceiling : 0;

  const gun = me.weapons.find((w) => w.status === 'ok') ?? me.weapons[0];
  const def = gun ? getPart(gun.partId) : undefined;
  const w = def?.weapon;
  const rangeM = Math.hypot(foe.x - me.x, foe.y - me.y);
  const lateral = prev ? crossingSpeedMps(prev.mechs[0], me, foe, TICK_S) : 0;
  const sigmaRad = w ? (w.dispersionMrad + MOVE_JITTER_MRAD_PER_MPS * speed) * 0.001 : 0;
  const model = w
    ? computeHitModel({
      rangeM,
      sigmaRad,
      lateralSpeedMps: lateral,
      lagS: TRACKING_LAG_BASE_S,
      projectileSpeed: w.projectileSpeed,
      targetHalfWidthM: meanSilhouetteHalfWidthM(getChassis(view.mechs[1].chassisId)),
    })
    : undefined;
  const dispersionM = sigmaRad * rangeM;
  const leadErrorM = model ? lateral * model.aimStalenessS : 0;

  const row = (k: string, v: string, cls = '') => (
    <div className="drow" key={k}>
      <span>{k}</span>
      <b className={cls}>{v}</b>
    </div>
  );

  return (
    <div className="diag" aria-hidden="true">
      <div className="dhead">Movement</div>
      <div className="dbody">
        <svg className="dell" viewBox="0 0 80 80">
          <line x1="40" y1="6" x2="40" y2="74" className="dax" />
          <line x1="6" y1="40" x2="74" y2="40" className="dax" />
          <path d={`${path}Z`} className="denv" />
          <line
            x1="40" y1="40"
            x2={(40 + Math.cos(angleOff) * ceiling * scale).toFixed(1)}
            y2={(40 + Math.sin(angleOff) * ceiling * scale).toFixed(1)}
            className="dmax"
          />
          <line
            x1="40" y1="40"
            x2={(40 + Math.cos(angleOff) * speed * scale).toFixed(1)}
            y2={(40 + Math.sin(angleOff) * speed * scale).toFixed(1)}
            className="dvel"
          />
          <text x="70" y="38" className="dlbl">F</text>
          <text x="7" y="38" className="dlbl">R</text>
        </svg>
        <div className="dcols">
          {row('fwd / strafe / rev', `${speeds.fwd} · ${speeds.strafe} · ${speeds.rev} m/s`)}
          {row('heading off facing', `${((angleOff * 180) / Math.PI).toFixed(0)}°`)}
          {row('ceiling this way', `${ceiling.toFixed(2)} m/s`)}
          {row('throttle', `${(throttle * 100).toFixed(0)}% → ${(ceiling * throttle).toFixed(2)} m/s`)}
          {row('actual speed', `${speed.toFixed(2)} m/s`)}
          {row(
            '% of directional max',
            `${(useOfMax * 100).toFixed(0)}%`,
            useOfMax > 0.66 ? 'bad' : useOfMax > 0.33 ? 'warn' : 'good',
          )}
        </div>
      </div>

      <div className="dhead">
        Shot · {def ? def.name.split(' (')[0] : 'no gun'} at {rangeM.toFixed(0)} m
      </div>
      <div className="dcols wide">
        {w && model ? (
          <>
            {row('your speed → jitter', `${speed.toFixed(2)} → +${(MOVE_JITTER_MRAD_PER_MPS * speed).toFixed(2)} mrad`)}
            {row('total dispersion', `${(sigmaRad * 1000).toFixed(2)} mrad → ${dispersionM.toFixed(2)} m`)}
            {row('target crossing', `${lateral.toFixed(2)} m/s`)}
            {row('lag + time of flight', `${model.aimStalenessS.toFixed(2)} s`)}
            {row('lead error', `${leadErrorM.toFixed(2)} m`, leadErrorM > dispersionM ? 'bad' : '')}
            {row('sigma vs target', `${model.sigmaM.toFixed(2)} m vs ${meanSilhouetteHalfWidthM(getChassis(view.mechs[1].chassisId)).toFixed(2)} m`)}
            {row('damage at range', `×${falloffAt(def!, rangeM).toFixed(2)}`, falloffAt(def!, rangeM) < 0.6 ? 'warn' : '')}
            {row(
              'hit chance',
              `${(model.pHit * 100).toFixed(0)}%`,
              model.pHit < 0.35 ? 'bad' : model.pHit < 0.7 ? 'warn' : 'good',
            )}
            {row('fire control', gun?.gate ? gun.gate : 'clear', gun?.gate ? 'warn' : 'good')}
            {row('t', `${tSec.toFixed(1)} s · cell ${CELL_SIZE_M} m`)}
          </>
        ) : row('no weapon', '—')}
      </div>
    </div>
  );
}
