import { useEffect, useState } from 'react';
import type { TestBenchResult } from '@mechbattler/sim';
import { useBuild, type OverlayMode } from './state/useBuild.js';
import { PartPalette } from './components/PartPalette.js';
import { GridEditor } from './components/GridEditor.js';
import { StatsPanel } from './components/StatsPanel.js';
import { PowerPriorityList } from './components/PowerPriorityList.js';
import { TestBenchPanel } from './components/TestBenchPanel.js';
import './App.css';

const OVERLAYS: { id: OverlayMode; label: string }[] = [
  { id: 'parts', label: 'Parts' },
  { id: 'power', label: 'Power' },
  { id: 'thermal', label: 'Thermal' },
];

export default function App() {
  const {
    state, chassis, build, chassisOptions,
    setChassis, selectPart, rotate, place, remove, movePriority, setOverlay,
    checkCandidate, previewCells,
  } = useBuild('CH-5');

  const [benchResult, setBenchResult] = useState<TestBenchResult | null>(null);

  useEffect(() => {
    setBenchResult(null);
  }, [state.chassisId, state.parts]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'r') rotate();
      if (e.key === 'Escape') selectPart(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rotate, selectPart]);

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
            previewCells={previewCells}
            checkCandidate={checkCandidate}
            onPlace={place}
            onRemove={remove}
            thermalSnapshot={benchResult?.cellTempsFinalC ?? null}
          />
        </div>

        <div className="panel">
          <div className="section">
            <StatsPanel chassis={chassis} build={build} />
          </div>
          <div className="section">
            <PowerPriorityList priority={state.powerPriority} parts={state.parts} onMove={movePriority} />
          </div>
          <div className="section">
            <TestBenchPanel chassis={chassis} build={build} onResult={setBenchResult} />
          </div>
        </div>
      </div>
    </div>
  );
}
