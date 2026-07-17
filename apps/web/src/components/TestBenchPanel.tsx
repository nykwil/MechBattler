import { useState } from 'react';
import {
  runTestBench,
  type Build,
  type ChassisSpec,
  type SpeedSetting,
  type TestBenchResult,
} from '@mechbattler/sim';
import { MiniChart } from './MiniChart.js';
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

  const hasWeapons = build.parts.some((p) => p.partId.startsWith('W-'));

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
    </div>
  );
}
