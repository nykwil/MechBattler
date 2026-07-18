import { useCallback, useEffect, useMemo, useState } from 'react';
import { computeHeatAdvice, runBattle, runTestBench, validateBuild, type Build, type BattleReport, type TestBenchResult } from '@mechbattler/sim';
import { useBuild, type OverlayMode } from './state/useBuild.js';
import { PartPalette } from './components/PartPalette.js';
import { GridEditor } from './components/GridEditor.js';
import { StatsPanel } from './components/StatsPanel.js';
import { PowerPriorityList } from './components/PowerPriorityList.js';
import { TestBenchPanel } from './components/TestBenchPanel.js';
import { PartInspector } from './components/PartInspector.js';
import { BuildWarnings } from './components/BuildWarnings.js';
import { ArenaPanel } from './components/ArenaPanel.js';
import { BattleReportScreen } from './components/BattleReportScreen.js';
import { BattleLiveScreen } from './components/BattleLiveScreen.js';
import type { OpponentDef } from './lib/opponents.js';
import type { FightMode } from './components/ArenaPanel.js';
import './App.css';

const OVERLAYS: { id: OverlayMode; label: string }[] = [
  { id: 'parts', label: 'Parts' },
  { id: 'power', label: 'Power' },
  { id: 'thermal', label: 'Thermal' },
];

export default function App() {
  const {
    state, chassis, build, chassisOptions,
    setChassis, selectPart, selectInstance, rotate, place, remove, movePriority, setOverlay,
    checkCandidate, previewCells,
  } = useBuild('CH-5');

  const [benchResult, setBenchResult] = useState<TestBenchResult | null>(null);
  const [battle, setBattle] = useState<{ report: BattleReport; opponent: OpponentDef; mode: FightMode } | null>(null);
  const [live, setLive] = useState<{ build: Build; opponent: OpponentDef; seed: number } | null>(null);
  const [hoveredPartId, setHoveredPartId] = useState<string | null>(null);

  useEffect(() => {
    setBenchResult(null);
  }, [state.chassisId, state.parts]);

  // Predicted equilibrium temperatures (docs/01 §9): the thermal overlay is
  // always live, not gated on a manual bench run. Runs the real sim for 60
  // simulated seconds at cruise with all weapons firing — milliseconds of
  // wall time on these grid sizes. A manual bench run (which lets the user
  // pick the speed setting) takes precedence while its result is fresh.
  const predictedTemps = useMemo(() => {
    if (state.parts.length === 0) return null;
    return runTestBench({ chassis, build, speedSetting: 'cruise', durationS: 60 }).cellTempsFinalC;
  }, [chassis, build, state.parts.length]);

  const issues = useMemo(() => {
    const base = validateBuild(chassis, build);
    // Prescriptive heat advice from the always-on prediction ("build X so
    // that Y") -- teaches the conduction model through the current build.
    const advice = predictedTemps ? computeHeatAdvice(chassis, build, predictedTemps) : [];
    return [...base, ...advice];
  }, [chassis, build, predictedTemps]);
  const faultInstanceIds = useMemo(
    () => new Set(issues.filter((i) => i.severity === 'error').flatMap((i) => i.instanceIds)),
    [issues],
  );

  const fight = useCallback(
    (opponent: OpponentDef, mode: FightMode, seed?: number) => {
      // A same-seed rematch (seed passed in) replays the exact battlefield
      // against the current build — a controlled experiment after a refit.
      const s = seed ?? Math.floor(Math.random() * 0x7fffffff);
      // Drop any open report so aborting the new fight lands in the workshop,
      // not on the stale previous report (docs/09 M1).
      setBattle(null);
      if (mode === 'watch') {
        const report = runBattle({ builds: [build, opponent.build], seed: s });
        setBattle({ report, opponent, mode });
      } else {
        // Command mode steps the same Battle live (docs/08); the finished
        // battle's report opens in the normal report screen.
        setLive({ build, opponent, seed: s });
      }
    },
    [build],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (battle || live) return; // battle overlays own the keyboard
      if (e.key.toLowerCase() === 'r') rotate();
      if (e.key === 'Escape') {
        selectPart(null);
        selectInstance(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedInstanceId) {
        remove(state.selectedInstanceId);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rotate, selectPart, selectInstance, remove, state.selectedInstanceId, battle, live]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          MechBattler <span className="tag">Workshop</span>
        </div>
        <div className="chassis-select">
          {chassisOptions.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chip${state.chassisId === c.id ? ' active' : ''}`}
              onClick={() => setChassis(c.id)}
              title={c.type}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="overlay-toggle">
          {OVERLAYS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`chip${state.overlay === o.id ? ' active' : ''}`}
              onClick={() => setOverlay(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </header>

      <div className="layout">
        <div className="panel">
          <PartPalette selectedPartId={state.selectedPartId} onSelect={selectPart} onHover={setHoveredPartId} />
        </div>

        <div className="centerpane">
          <GridEditor
            chassis={chassis}
            parts={state.parts}
            overlay={state.overlay}
            selectedPartId={state.selectedPartId}
            selectedInstanceId={state.selectedInstanceId}
            previewCells={previewCells}
            checkCandidate={checkCandidate}
            onPlace={place}
            onSelectInstance={selectInstance}
            thermalSnapshot={benchResult?.cellTempsFinalC ?? predictedTemps}
            faultInstanceIds={faultInstanceIds}
          />
        </div>

        <div className="panel">
          {issues.length > 0 && (
            <div className="section">
              <BuildWarnings issues={issues} />
            </div>
          )}
          {state.selectedInstanceId && (
            <div className="section">
              <PartInspector
                parts={state.parts}
                selectedInstanceId={state.selectedInstanceId}
                onRemove={remove}
                onDeselect={() => selectInstance(null)}
              />
            </div>
          )}
          <div className="section">
            <StatsPanel chassis={chassis} build={build} hoveredPartId={hoveredPartId} />
          </div>
          <div className="section">
            <PowerPriorityList priority={state.powerPriority} parts={state.parts} onMove={movePriority} />
          </div>
          <div className="section">
            <TestBenchPanel chassis={chassis} build={build} onResult={setBenchResult} />
          </div>
          <div className="section">
            <ArenaPanel build={build} onFight={fight} />
          </div>
        </div>
      </div>

      {live && (
        <BattleLiveScreen
          key={live.seed}
          build={live.build}
          opponent={live.opponent}
          seed={live.seed}
          onFinished={(report) => {
            setBattle({ report, opponent: live.opponent, mode: 'command' });
            setLive(null);
          }}
          onAbort={() => setLive(null)}
        />
      )}

      {battle && !live && (
        <BattleReportScreen
          report={battle.report}
          opponent={battle.opponent}
          onRematch={() => fight(battle.opponent, battle.mode)}
          onRematchSameSeed={() => fight(battle.opponent, battle.mode, battle.report.seed)}
          onClose={() => setBattle(null)}
        />
      )}
    </div>
  );
}
