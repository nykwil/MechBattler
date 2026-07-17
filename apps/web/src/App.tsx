import { useCallback, useEffect, useMemo, useState } from 'react';
import { runBattle, runTestBench, type BattleReport, type TestBenchResult } from '@mechbattler/sim';
import { useBuild, type OverlayMode } from './state/useBuild.js';
import { PartPalette } from './components/PartPalette.js';
import { GridEditor } from './components/GridEditor.js';
import { StatsPanel } from './components/StatsPanel.js';
import { PowerPriorityList } from './components/PowerPriorityList.js';
import { TestBenchPanel } from './components/TestBenchPanel.js';
import { PartInspector } from './components/PartInspector.js';
import { ArenaPanel } from './components/ArenaPanel.js';
import { BattleReportScreen } from './components/BattleReportScreen.js';
import type { OpponentDef } from './lib/opponents.js';
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
  const [battle, setBattle] = useState<{ report: BattleReport; opponent: OpponentDef } | null>(null);

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

  const fight = useCallback(
    (opponent: OpponentDef) => {
      const seed = Math.floor(Math.random() * 0x7fffffff);
      const report = runBattle({ builds: [build, opponent.build], seed });
      setBattle({ report, opponent });
    },
    [build],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
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
  }, [rotate, selectPart, selectInstance, remove, state.selectedInstanceId]);

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
          <PartPalette selectedPartId={state.selectedPartId} onSelect={selectPart} />
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
          />
        </div>

        <div className="panel">
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
            <StatsPanel chassis={chassis} build={build} />
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

      {battle && (
        <BattleReportScreen
          report={battle.report}
          opponent={battle.opponent}
          onRematch={() => fight(battle.opponent)}
          onClose={() => setBattle(null)}
        />
      )}
    </div>
  );
}
