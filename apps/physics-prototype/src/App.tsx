import { useEffect, useMemo, useState } from 'react';
import {
  PROTOTYPE_LOADOUTS,
  describeLoadout,
} from './model.js';
import {
  PrototypeCanvas,
  type DebugOptions,
  type PrototypeTelemetry,
  type SceneCommand,
} from './Scene.js';

const INITIAL_TELEMETRY: PrototypeTelemetry = {
  speedMps: 0,
  tiltDeg: 0,
  support: 'stable',
  gaitPhase: 'initializing',
  distanceM: 0,
  position: [0, 0, 0],
};

function formatMass(value: number) {
  return `${value.toFixed(2)} t`;
}

export default function App() {
  const [loadoutId, setLoadoutId] = useState('vulture-longshot');
  const [destination, setDestination] = useState<[number, number] | null>(null);
  const [faceTarget, setFaceTarget] = useState<[number, number]>([3.5, 5]);
  const [faceTargetEnabled, setFaceTargetEnabled] = useState(false);
  const [paused, setPaused] = useState(false);
  const [slowMotion, setSlowMotion] = useState(false);
  const [fireToken, setFireToken] = useState(0);
  const [resetToken, setResetToken] = useState(0);
  const [telemetry, setTelemetry] = useState(INITIAL_TELEMETRY);
  const [debug, setDebug] = useState<DebugOptions>({
    physics: false,
    centerOfMass: true,
    supportPolygon: true,
    footTargets: false,
    forces: false,
  });

  const loadout = PROTOTYPE_LOADOUTS.find((candidate) => candidate.id === loadoutId) ?? PROTOTYPE_LOADOUTS[0]!;
  const mech = useMemo(() => describeLoadout(loadout), [loadout]);
  const command: SceneCommand = useMemo(
    () => ({ destination, faceTarget, faceTargetEnabled }),
    [destination, faceTarget, faceTargetEnabled],
  );
  const recoil = [...mech.parts].sort((a, b) => (b.recoilKnS ?? 0) - (a.recoilKnS ?? 0))[0]?.recoilKnS ?? 0;
  const comOffset = Math.hypot(mech.centerOfMassLocalM[0], mech.centerOfMassLocalM[2]);

  const reset = () => {
    setPaused(false);
    setTelemetry(INITIAL_TELEMETRY);
    setDestination(null);
    setResetToken((token) => token + 1);
  };

  const selectLoadout = (id: string) => {
    setLoadoutId(id);
    setDestination(null);
    setTelemetry(INITIAL_TELEMETRY);
    setResetToken((token) => token + 1);
  };

  const onGround = (point: [number, number], target: boolean) => {
    if (target) setFaceTarget(point);
    else setDestination(point);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code === 'Space') {
        event.preventDefault();
        setFireToken((token) => token + 1);
      } else if (event.key.toLowerCase() === 'r') {
        reset();
      } else if (event.key.toLowerCase() === 'f') {
        setFaceTargetEnabled((value) => !value);
      } else if (event.key.toLowerCase() === 'p') {
        setPaused((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const setDebugValue = (key: keyof DebugOptions, value: boolean) => {
    setDebug((current) => ({ ...current, [key]: value }));
  };

  return (
    <main className="prototype-shell">
      <section className="viewport" aria-label="3D locomotion arena">
        <PrototypeCanvas
          mech={mech}
          command={command}
          debug={debug}
          paused={paused}
          slowMotion={slowMotion}
          fireToken={fireToken}
          resetToken={resetToken}
          onGround={onGround}
          onTelemetry={setTelemetry}
        />
      </section>

      <header className="brand-strip">
        <div className="brand-mark" aria-hidden="true">MB</div>
        <div>
          <p className="eyebrow">MECHBATTLER · EXPERIMENT 01</p>
          <h1>Load-Bearing Lab</h1>
        </div>
        <div className="lab-status">
          <span className={`status-light ${telemetry.support}`} />
          {paused ? 'SIM PAUSED' : telemetry.support === 'fallen' ? 'GAIT FAILURE' : 'PHYSICS LIVE'}
        </div>
      </header>

      <aside className="control-panel" aria-label="Prototype controls">
        <div className="panel-section loadout-section">
          <span className="section-index">01</span>
          <label htmlFor="loadout">Test article</label>
          <select
            id="loadout"
            data-testid="loadout-select"
            value={loadoutId}
            onChange={(event) => selectLoadout(event.target.value)}
          >
            {PROTOTYPE_LOADOUTS.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
            ))}
          </select>
          <p className="loadout-blurb">{loadout.blurb}</p>
          {loadout.featured && <span className="warning-chip">ILLEGAL STRESS RIG</span>}
        </div>

        <div className="panel-section">
          <span className="section-index">02</span>
          <p className="section-label">Standing orders</p>
          <button
            type="button"
            className={`mode-button ${faceTargetEnabled ? 'active' : ''}`}
            aria-pressed={faceTargetEnabled}
            onClick={() => setFaceTargetEnabled((value) => !value)}
          >
            <span className="button-icon">F</span>
            <span>
              <strong>{faceTargetEnabled ? 'Face marker' : 'Face travel'}</strong>
              <small>{faceTargetEnabled ? 'Strafe independently' : 'Turn into movement'}</small>
            </span>
          </button>
          <div className="coordinate-row">
            <span>MOVE</span>
            <code>{destination ? `${destination[0].toFixed(1)}, ${destination[1].toFixed(1)}` : 'HOLD'}</code>
          </div>
          <div className="coordinate-row">
            <span>FACE</span>
            <code>{faceTarget[0].toFixed(1)}, {faceTarget[1].toFixed(1)}</code>
          </div>
        </div>

        <div className="panel-section action-grid">
          <span className="section-index">03</span>
          <p className="section-label">Actuators</p>
          <button
            type="button"
            className="fire-button"
            onClick={() => setFireToken((token) => token + 1)}
            disabled={paused || recoil <= 0}
          >
            FIRE <kbd>SPACE</kbd>
          </button>
          <button type="button" onClick={reset}>RESET <kbd>R</kbd></button>
          <button type="button" className={paused ? 'active' : ''} onClick={() => setPaused((value) => !value)}>
            {paused ? 'RESUME' : 'PAUSE'} <kbd>P</kbd>
          </button>
          <button type="button" className={slowMotion ? 'active' : ''} onClick={() => setSlowMotion((value) => !value)}>
            ½ SPEED
          </button>
        </div>

        <div className="panel-section">
          <span className="section-index">04</span>
          <p className="section-label">Diagnostic overlays</p>
          <div className="toggle-grid">
            {([
              ['centerOfMass', 'Center of mass'],
              ['supportPolygon', 'Support polygon'],
              ['footTargets', 'Foot targets'],
              ['forces', 'Support forces'],
              ['physics', 'Colliders'],
            ] as const).map(([key, label]) => (
              <label key={key} className="check-row">
                <input
                  type="checkbox"
                  checked={debug[key]}
                  onChange={(event) => setDebugValue(key, event.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      </aside>

      <div className="instruction-card">
        <span className="mouse-glyph">↖</span>
        <p><strong>Click</strong> to move</p>
        <p><strong>Shift + click</strong> to place facing marker</p>
        <p><strong>Right-drag</strong> to orbit · <strong>Wheel</strong> to zoom</p>
      </div>

      <section
        className="telemetry-bar"
        aria-label="Live telemetry"
        data-telemetry={JSON.stringify(telemetry)}
      >
        <article>
          <span>ALL-UP MASS</span>
          <strong>{formatMass(mech.totalMassT)}</strong>
          <small>{Math.round(mech.loadRatio * 100)}% rated load</small>
        </article>
        <article>
          <span>PAYLOAD</span>
          <strong>{formatMass(mech.payloadMassT)}</strong>
          <small>{mech.parts.length} mounted parts</small>
        </article>
        <article>
          <span>COM OFFSET</span>
          <strong>{comOffset.toFixed(2)} m</strong>
          <small>{mech.centerOfMassLocalM[2] < -0.12 ? 'rear-heavy' : 'within envelope'}</small>
        </article>
        <article>
          <span>GROUND SPEED</span>
          <strong>{telemetry.speedMps.toFixed(1)} m/s</strong>
          <small>{telemetry.distanceM.toFixed(1)} m to order</small>
        </article>
        <article>
          <span>BODY TILT</span>
          <strong>{telemetry.tiltDeg.toFixed(1)}°</strong>
          <small className={telemetry.tiltDeg > 25 ? 'danger-text' : ''}>
            {telemetry.tiltDeg > 25 ? 'recovery margin low' : 'upright assist active'}
          </small>
        </article>
        <article>
          <span>GAIT</span>
          <strong>{mech.legRig.gait.toUpperCase()}</strong>
          <small>{telemetry.gaitPhase}</small>
        </article>
        <article className="recoil-readout">
          <span>PEAK RECOIL</span>
          <strong>{recoil.toFixed(1)} kN·s</strong>
          <small>real catalog impulse</small>
        </article>
      </section>
    </main>
  );
}
