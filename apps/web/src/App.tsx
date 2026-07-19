import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { autoWire, computeHeatAdvice, runBattle, runTestBench, validateBuild, type Build, type BattleReport, type TestBenchResult } from '@mechbattler/sim';
import { useBuild, type OverlayMode } from './state/useBuild.js';
import { PartPalette } from './components/PartPalette.js';
import { GridEditor } from './components/GridEditor.js';
import { StatsPanel } from './components/StatsPanel.js';
import { PowerPriorityList } from './components/PowerPriorityList.js';
import { TestBenchPanel } from './components/TestBenchPanel.js';
import { PartInspector } from './components/PartInspector.js';
import { BuildWarnings } from './components/BuildWarnings.js';
import { ArenaPanel } from './components/ArenaPanel.js';
import { RunPanel } from './components/RunPanel.js';
import { WreckScreen } from './components/WreckScreen.js';
import { kitBuild, PURSE_BASE, PURSE_PER_NODE, useRun } from './state/runState.js';
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
    setChassis, selectPart, selectInstance, rotate, place, remove, addParts, loadBuild, movePriority, setOverlay,
    checkCandidate, previewCells,
  } = useBuild('CH-5');

  const [benchResult, setBenchResult] = useState<TestBenchResult | null>(null);
  const [battle, setBattle] = useState<{ report: BattleReport; opponent: OpponentDef; mode: FightMode } | null>(null);
  const [live, setLive] = useState<{ build: Build; opponent: OpponentDef; seed: number } | null>(null);
  const [hoveredPartId, setHoveredPartId] = useState<string | null>(null);
  const [flashIds, setFlashIds] = useState<Set<string>>(() => new Set());

  // --- Run shell (docs/10 M1) ------------------------------------------------
  const { run, start, won, lost, abandon, sellBench, persistBuild, restored, clearRestored } = useRun();
  /** Whether the open battle belongs to the run (vs free-play arena). */
  const runFightRef = useRef(false);
  /** A won run fight awaiting its salvage screen (docs/10 M2). */
  const [wreck, setWreck] = useState<{ report: BattleReport; opponent: OpponentDef; nodeIndex: number } | null>(null);

  // Restore a reloaded run's build into the editor, once.
  useEffect(() => {
    if (restored) {
      loadBuild(restored);
      clearRestored();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored]);

  // The run snapshot follows every edit AND every run-data change (scrap,
  // bench, node) — depending on `run` itself, not just the phase, is what
  // keeps a post-salvage reload honest.
  useEffect(() => {
    persistBuild(build);
  }, [build, run, persistBuild]);

  const startKit = useCallback((templateId: string, kitName: string) => {
    loadBuild(kitBuild(templateId));
    start(kitName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  const autoWireNow = useCallback(() => {
    const { conduits } = autoWire(chassis, build);
    if (conduits.length === 0) return;
    addParts(conduits);
    setFlashIds(new Set(conduits.map((c) => c.instanceId)));
    setTimeout(() => setFlashIds(new Set()), 1700);
  }, [chassis, build, addParts]);

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
            flashInstanceIds={flashIds}
            onAutoWire={autoWireNow}
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
            <RunPanel
              run={run}
              build={build}
              onStartKit={startKit}
              onFight={(o, m) => { runFightRef.current = true; fight(o, m); }}
              onAbandon={abandon}
              onNewRun={abandon}
              onSellBench={sellBench}
            />
          </div>
          {run.phase === 'none' && (
            <div className="section">
              <ArenaPanel build={build} onFight={(o, m) => { runFightRef.current = false; fight(o, m); }} />
            </div>
          )}
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
          onAbort={() => { runFightRef.current = false; setLive(null); }}
        />
      )}

      {wreck && run.phase === 'active' && (
        <WreckScreen
          report={wreck.report}
          enemyBuild={wreck.opponent.build}
          opponentName={wreck.opponent.name}
          purse={PURSE_BASE + PURSE_PER_NODE * wreck.nodeIndex}
          benchUsed={run.data.benchPool.length}
          onFinish={(scrapGained, loot) => {
            won(scrapGained, loot);
            setWreck(null);
          }}
        />
      )}

      {battle && !live && !wreck && (
        <BattleReportScreen
          report={battle.report}
          opponent={battle.opponent}
          onRematch={() => fight(battle.opponent, battle.mode)}
          onRematchSameSeed={() => fight(battle.opponent, battle.mode, battle.report.seed)}
          onClose={() => {
            // A closed run-fight report settles the node (docs/10 M1): a win
            // advances the ladder; losing the core ends the run. Other losses
            // (mission-kill, judges) keep the node — pick again or refit.
            if (runFightRef.current) {
              runFightRef.current = false;
              if (battle.report.winner === 0 && run.phase === 'active') {
                // Salvage settles the node (docs/04 §2) before the ladder advances.
                setWreck({ report: battle.report, opponent: battle.opponent, nodeIndex: run.data.nodeIndex });
              } else if (battle.report.winner === 1 && battle.report.reason === 'core-kill') {
                lost(`Core destroyed by ${battle.opponent.name}`);
              }
            }
            setBattle(null);
          }}
        />
      )}
    </div>
  );
}
