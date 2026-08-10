import { useState } from 'react';
import {
  runRangeSandbox,
  runTestBench,
  SANDBOX_RANGES_M,
  type Build,
  type ChassisSpec,
  type SandboxTargetResult,
  type SpeedSetting,
  type TestBenchResult,
} from '@mechbattler/sim';
import { MiniChart } from './MiniChart.js';
import { hasWeapon } from '../lib/launchGate.js';
import './TestBenchPanel.css';

const SPEED_OPTIONS: SpeedSetting[] = ['stationary', 'creep', 'cruise', 'flank'];

export function TestBenchPanel({
  chassis, build, onResult,
}: {
  chassis: ChassisSpec;
  build: Build;
  onResult: (result: TestBenchResult | null) => void;
}) {
  const [speedSetting, setSpeedSetting] = useState<SpeedSetting>('cruise');
  const [result, setResult] = useState<TestBenchResult | null>(null);
  const [running, setRunning] = useState(false);

  const hasWeapons = hasWeapon(build);

  function run() {
    setRunning(true);
    // Synchronous, but yield a tick so the "running" state paints first.
    setTimeout(() => {
      const r = runTestBench({ chassis, build, speedSetting, durationS: 60 });
      setResult(r);
      onResult(r);
      setRunning(false);
    }, 0);
  }

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Test bench — 60s live fire</div>
      <div className="bench-controls">
        {SPEED_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className={`chip${speedSetting === s ? ' active' : ''}`}
            onClick={() => setSpeedSetting(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <button type="button" className="run-btn" onClick={run} disabled={running}>
        {running ? 'Running…' : 'Run test bench'}
      </button>

      {!result && (
        <div className="placeholder">
          Runs the real simulation (docs/02 §6: measurements, not estimates) with every weapon
          firing continuously for 60 simulated seconds. Reports what closed-form math can't:
          sustained DPS once heat catches up, and whether anything shuts down or browns out.
        </div>
      )}

      {result && (
        <>
          <div className="bench-result-grid">
            <div className="stat-card">
              <div className="stat-label">Sustained DPS</div>
              <div className="stat-value">{result.sustainedDps.toFixed(1)}</div>
              <div className="stat-sub">final 10s of the run</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Time to overheat</div>
              <div className={`stat-value ${result.timeToOverheatS !== null ? 'bad' : 'good'}`}>
                {result.timeToOverheatS !== null ? `${result.timeToOverheatS.toFixed(1)}s` : 'never'}
              </div>
              <div className="stat-sub">first part to hit 130C</div>
            </div>
          </div>

          <div className="chart-title">Peak cell temperature (C), dashed = 130C shutdown line</div>
          <MiniChart
            series={[{ color: 'var(--signal-red)', points: result.samples.map((s) => s.maxTempC) }]}
            maxY={Math.max(140, ...result.samples.map((s) => s.maxTempC))}
            thresholdY={130}
          />

          <div className="chart-title">Supply (blue) vs demand (amber), kW</div>
          <MiniChart
            series={[
              { color: 'var(--signal-blue)', points: result.samples.map((s) => s.supplyKw) },
              { color: 'var(--signal-amber)', points: result.samples.map((s) => s.demandKw) },
            ]}
            maxY={Math.max(1, ...result.samples.map((s) => Math.max(s.supplyKw, s.demandKw))) * 1.15}
          />

          <div className="chart-title">Events</div>
          <div className="event-log">
            {!hasWeapons && <div className="event-row">No weapons mounted — nothing fired.</div>}
            {result.everShedInstanceIds.length > 0 && (
              <div className="event-row warn">Browned out: {result.everShedInstanceIds.join(', ')}</div>
            )}
            {result.everShutdownInstanceIds.length > 0 && (
              <div className="event-row bad">Overheated shutdown: {result.everShutdownInstanceIds.join(', ')}</div>
            )}
            {result.cookoffLog.length > 0 && (
              <div className="event-row bad">Cook-off: {result.cookoffLog.map((c) => c.instanceId).join(', ')}</div>
            )}
            {result.everShedInstanceIds.length === 0 && result.everShutdownInstanceIds.length === 0 && result.cookoffLog.length === 0 && (
              <div className="event-row">Clean run — nothing browned out or overheated.</div>
            )}
          </div>
        </>
      )}

      <RangeSandbox build={build} hasWeapons={hasWeapons} />
    </div>
  );
}

const DOWN_LABEL: Record<string, string> = {
  range: 'out of reach',
  arc: 'out of arc',
  heat: 'cooling',
  power: 'power-shed',
  shutdown: 'shutdown',
  destroyed: 'destroyed',
};
const DOWN_COLOR: Record<string, string> = {
  range: 'var(--ink-faint)',
  arc: 'var(--ink-faint)',
  heat: 'var(--signal-amber)',
  power: 'var(--signal-red)',
  shutdown: 'var(--signal-red)',
  destroyed: 'var(--signal-red)',
};

/** One gun's window: how much of it was spent firing vs why it was silent (docs/09 M5). */
function UptimeBar({ w }: { w: SandboxTargetResult['weapons'][number] }) {
  const downs = Object.entries(w.downFracs).filter(([, f]) => (f ?? 0) >= 0.005);
  const parts = [
    w.uptimeFrac >= 0.005 ? `up ${Math.round(w.uptimeFrac * 100)}%` : null,
    ...downs.map(([k, f]) => `${DOWN_LABEL[k] ?? k} ${Math.round((f ?? 0) * 100)}%`),
  ].filter(Boolean);
  return (
    <div className="sandbox-uptime">
      <span className="sandbox-uptime-name">{w.name.replace(/ \(.*\)/, '')}</span>
      <span className="sandbox-uptime-bar">
        <span style={{ flexGrow: w.uptimeFrac, background: 'var(--signal-green)' }} />
        {downs.map(([k, f]) => (
          <span key={k} style={{ flexGrow: f, background: DOWN_COLOR[k] ?? 'var(--ink-faint)' }} />
        ))}
      </span>
      <span className="sandbox-uptime-text">{w.dps.toFixed(1)} dps · {parts.join(' · ')}</span>
    </div>
  );
}

/**
 * Range sandbox (docs/02 §6): armor dummies at selectable ranges, shot at with
 * the real combat rules. DPS is averaged over a 45 s window so slow-cycling
 * guns read as a stable number, and a gun fire control would gate (out of
 * reach, cooked) honestly measures 0.
 */
function RangeSandbox({ build, hasWeapons }: { build: Build; hasWeapons: boolean }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Set<number>>(() => new Set(SANDBOX_RANGES_M));
  const [results, setResults] = useState<SandboxTargetResult[] | null>(null);
  const [running, setRunning] = useState(false);

  function toggleRange(r: number) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
    setResults(null);
  }

  function run() {
    setRunning(true);
    setTimeout(() => {
      setResults(runRangeSandbox({ build, rangesM: SANDBOX_RANGES_M.filter((r) => active.has(r)) }));
      setRunning(false);
    }, 0);
  }

  const maxRange = SANDBOX_RANGES_M[SANDBOX_RANGES_M.length - 1]!;

  return (
    <div className="sandbox">
      <button type="button" className="sandbox-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} Range sandbox — live fire at target dummies
      </button>
      {open && (
        <>
          <div className="sandbox-strip">
            <span className="sandbox-shooter" title="Your mech, holding position">◤</span>
            <div className="sandbox-track">
              {SANDBOX_RANGES_M.map((r) => {
                const res = results?.find((x) => x.rangeM === r);
                return (
                  <button
                    key={r}
                    type="button"
                    className={`sandbox-target${active.has(r) ? ' active' : ''}`}
                    style={{ left: `${(r / maxRange) * 92}%` }}
                    onClick={() => toggleRange(r)}
                    title={active.has(r) ? 'Click to remove this target' : 'Click to add a target here'}
                  >
                    <span className="sandbox-target-box">{active.has(r) ? '▣' : '□'}</span>
                    <span className="sandbox-target-range">{r}m</span>
                    {res && (
                      <span className={`sandbox-target-dps${res.dps === 0 ? ' zero' : ''}`}>
                        {res.dps.toFixed(1)}
                        <em>dps</em>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <button type="button" className="run-btn" onClick={run} disabled={running || active.size === 0}>
            {running ? 'Running…' : 'Fire for 45s'}
          </button>
          {!results && (
            <div className="placeholder">
              Parks the mech at each range from an inert armor slab and fires under normal fire
              control for 45 simulated seconds. Measured, not estimated — a gun that's out of
              reach or cooking itself scores the 0 it would score in the arena.
            </div>
          )}
          {results && !hasWeapons && <div className="placeholder">No weapons mounted — nothing to measure.</div>}
          {results && hasWeapons && (
            <div className="sandbox-rows">
              {results.map((res) => (
                <div key={res.rangeM} className="sandbox-block">
                  <div className="sandbox-row">
                    <span className="sandbox-row-range">{res.rangeM}m</span>
                    <span className={`sandbox-row-dps${res.dps === 0 ? ' zero' : ''}`}>{res.dps.toFixed(1)} dps</span>
                    <span className="sandbox-row-detail">
                      {res.shots === 0
                        ? 'held fire — see why below'
                        : `${Math.round((res.hitFrac ?? 0) * 100)}% hit`}
                      {res.targetDestroyed && ' · target destroyed'}
                    </span>
                  </div>
                  {res.weapons.map((w) => <UptimeBar key={w.partId} w={w} />)}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
