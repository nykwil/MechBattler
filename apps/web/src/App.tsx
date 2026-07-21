import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { autoWire, buildTierBudget, computeHeatAdvice, getChassis, getPart, runBattle, runTestBench, validateBuild, type Build, type BattleReport, type TestBenchResult } from '@mechbattler/sim';
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
import { kitBuild, BENCH_CAP, MACHINIST_MOD_COST, PURSE_BASE, PURSE_PER_NODE, SCRAP_BUY_MULT, START_BUDGET, useRun } from './state/runState.js';
import { useProfile, type UnlockGains } from './state/profileState.js';
import type { RunPartOps } from './components/PartInspector.js';
import { ELITE_PURSE_MULT } from './lib/ladder.js';
import { BattleReportScreen } from './components/BattleReportScreen.js';
import { BattleLiveScreen } from './components/BattleLiveScreen.js';
import type { OpponentDef } from './lib/opponents.js';
import type { FightMode } from './components/ArenaPanel.js';
import { BalanceLab } from './components/BalanceLab.js';
import './App.css';

const OVERLAYS: { id: OverlayMode; label: string }[] = [
  { id: 'parts', label: 'Parts' },
  { id: 'power', label: 'Power' },
  { id: 'thermal', label: 'Thermal' },
];

export default function App() {
  const [workspace, setWorkspace] = useState<'workshop' | 'balance'>(() =>
    new URLSearchParams(window.location.search).get('view') === 'balance' ? 'balance' : 'workshop',
  );
  const {
    state, chassis, build, chassisOptions,
    setChassis, selectPart, selectInstance, rotate, place, remove, addParts, loadBuild, movePriority, setOverlay, setIntegrity, applyModifier,
    checkCandidate, previewCells,
  } = useBuild('CH-5');

  const [benchResult, setBenchResult] = useState<TestBenchResult | null>(null);
  const [battle, setBattle] = useState<{ report: BattleReport; opponent: OpponentDef; mode: FightMode } | null>(null);
  const [live, setLive] = useState<{ build: Build; opponent: OpponentDef; seed: number } | null>(null);
  const [hoveredPartId, setHoveredPartId] = useState<string | null>(null);
  const [flashIds, setFlashIds] = useState<Set<string>>(() => new Set());

  // --- Run shell (docs/10 M1) ------------------------------------------------
  const {
    run, start, startCustom, launch, won, lost, abandon, sellBench, addScrap, addBench, takeBench,
    skipNode, rerollYard, markYardMod, persistBuild, restored, clearRestored,
  } = useRun();
  const { profile, lockedPartIds, unlockFrom, history, pushHistory } = useProfile();
  /** Whether the open battle belongs to the run (vs free-play arena). */
  const runFightRef = useRef(false);
  /** A won run fight awaiting its salvage screen (docs/10 M2). */
  const [wreck, setWreck] = useState<{ report: BattleReport; opponent: OpponentDef; nodeIndex: number; unlocks: UnlockGains } | null>(null);
  /** Bench-pool part armed for grid placement (docs/10 M3). */
  const [pendingBench, setPendingBench] = useState<{ index: number; partId: string } | null>(null);

  const runActive = run.phase === 'active';
  const runPrep = run.phase === 'prep';
  const runScrap = runActive ? run.data.scrap : 0;
  const benchUsed = runActive ? run.data.benchPool.length : 0;

  // Memorial (docs/10 M6): a finished run is recorded once.
  const historyPushedRef = useRef(false);
  useEffect(() => {
    if (run.phase === 'over' && !historyPushedRef.current) {
      historyPushedRef.current = true;
      pushHistory({
        kitName: run.data.kitName, fightsWon: run.data.fightsWon,
        cause: run.cause, victorious: run.victorious, endedAt: new Date().toISOString(),
      });
    }
    if (run.phase !== 'over') historyPushedRef.current = false;
  }, [run, pushHistory]);

  /** Custom-frame start (docs/04 §7): bare unlocked chassis, then outfit. */
  const startCustomFrame = useCallback((chassisId: string) => {
    setPendingBench(null);
    setChassis(chassisId); // resets the editor to an empty build
    startCustom(`Custom ${getChassis(chassisId).name}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setChassis, startCustom]);

  // Palette selection always drops any armed bench part — a fresh catalog
  // part and a bench part can't both be on the cursor.
  const selectPalettePart = useCallback((id: string | null) => {
    setPendingBench(null);
    selectPart(id);
  }, [selectPart]);

  /** Arm a bench part: it places with its full salvage state, once. */
  const fitBench = useCallback((index: number) => {
    if (run.phase !== 'active') return;
    const b = run.data.benchPool[index];
    if (!b) return;
    setPendingBench({ index, partId: b.partId });
    selectPart(b.partId, { integrity: b.integrity, modifiers: b.modifiers, variant: b.variant });
  }, [run, selectPart]);

  // Placement with the run economy in the loop (docs/10 M3): a bench part
  // consumes its bench slot; a fresh catalog part is bought at tier ×
  // SCRAP_BUY_MULT (> sell, so the palette can't mint scrap). Free play
  // outside a run is unchanged.
  const placeWithEconomy = useCallback((x: number, y: number) => {
    if (!state.selectedPartId || checkCandidate(x, y) !== null) return;
    if (pendingBench && pendingBench.partId === state.selectedPartId) {
      takeBench(pendingBench.index);
      setPendingBench(null);
      place(x, y);
      selectPart(null); // a bench part is one-of — disarm after placing
      return;
    }
    if (runPrep) {
      // Custom-frame outfitting (docs/04 §7): unlocked parts only, free but
      // capped by the tier budget (wiring is exempt, like the enemy ladder).
      const def = getPart(state.selectedPartId);
      if (lockedPartIds.has(def.id)) return;
      if (!def.isConduit && !def.isHeatPipe && buildTierBudget(build) + def.tier > START_BUDGET) return;
      place(x, y);
      return;
    }
    if (runActive) {
      const cost = getPart(state.selectedPartId).tier * SCRAP_BUY_MULT;
      if (cost > runScrap) return;
      addScrap(-cost);
    }
    place(x, y);
  }, [state.selectedPartId, checkCandidate, pendingBench, takeBench, place, selectPart, runActive, runPrep, runScrap, addScrap, lockedPartIds, build]);

  /** Repair / sell / unplace controls on the part inspector during a run. */
  const runOps: RunPartOps | undefined = runActive ? {
    scrap: runScrap,
    benchFull: benchUsed >= BENCH_CAP,
    onRepair: (instanceId, toIntegrity, cost) => {
      if (cost > runScrap) return;
      addScrap(-cost);
      setIntegrity(instanceId, toIntegrity);
    },
    onSell: (instanceId, value) => {
      addScrap(value);
      remove(instanceId);
    },
    onUnplace: (instanceId) => {
      const p = state.parts.find((x) => x.instanceId === instanceId);
      if (!p || benchUsed >= BENCH_CAP) return;
      addBench({ partId: p.partId, integrity: p.integrity, modifiers: p.modifiers, variant: p.variant });
      remove(instanceId);
    },
  } : undefined;

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
    setPendingBench(null);
    loadBuild(kitBuild(templateId));
    start(kitName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  const autoWireNow = useCallback(() => {
    const { conduits } = autoWire(chassis, build);
    if (conduits.length === 0) return;
    // During a run the conduits are bought like any other part (docs/10 M3) —
    // otherwise auto-wire + sell would mint scrap.
    if (runActive) {
      const cost = conduits.reduce((sum, c) => sum + getPart(c.partId).tier * SCRAP_BUY_MULT, 0);
      if (cost > runScrap) return;
      addScrap(-cost);
    }
    addParts(conduits);
    setFlashIds(new Set(conduits.map((c) => c.instanceId)));
    setTimeout(() => setFlashIds(new Set()), 1700);
  }, [chassis, build, addParts, runActive, runScrap, addScrap]);

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
      // Ladder opponents carry a fixed battleSeed (docs/10 M4): the scouted
      // arena on the intel card is exactly the arena fought.
      const s = seed ?? opponent.battleSeed ?? Math.floor(Math.random() * 0x7fffffff);
      // Drop any open report so aborting the new fight lands in the workshop,
      // not on the stale previous report (docs/09 M1).
      setBattle(null);
      if (mode === 'watch') {
        const report = runBattle({ builds: [build, opponent.build], seed: s, spawnDistanceM: opponent.spawnDistanceM });
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
      if (battle || live || wreck) return; // overlays own the keyboard
      if (e.key.toLowerCase() === 'r') rotate();
      if (e.key === 'Escape') {
        setPendingBench(null);
        selectPart(null);
        selectInstance(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedInstanceId) {
        remove(state.selectedInstanceId);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rotate, selectPart, selectInstance, remove, state.selectedInstanceId, battle, live, wreck]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          MechBattler <span className="tag">Workshop</span>
        </div>
        <nav className="workspace-nav" aria-label="Workspace">
          <button type="button" className={workspace === 'workshop' ? 'active' : ''} onClick={() => setWorkspace('workshop')}>Workshop</button>
          <button type="button" className={workspace === 'balance' ? 'active' : ''} onClick={() => setWorkspace('balance')}>Balance Lab</button>
        </nav>
        {workspace === 'workshop' && <>
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
        </>}
      </header>

      {workspace === 'balance' ? <BalanceLab /> : <div className="layout">
        <div className="panel">
          <PartPalette
            selectedPartId={state.selectedPartId}
            onSelect={selectPalettePart}
            onHover={setHoveredPartId}
            priceMult={runActive ? SCRAP_BUY_MULT : undefined}
            scrap={runActive ? runScrap : undefined}
            lockedPartIds={runPrep ? lockedPartIds : undefined}
          />
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
            onPlace={placeWithEconomy}
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
                runOps={runOps}
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
              onSellBench={(i, v) => { setPendingBench(null); selectPart(null); sellBench(i, v); }}
              onFitBench={fitBench}
              fittingBenchIndex={pendingBench?.index ?? null}
              onBuyOffer={(o) => {
                if (o.price > runScrap || benchUsed >= BENCH_CAP) return;
                addScrap(-o.price);
                addBench({ partId: o.partId, integrity: o.integrity });
              }}
              onRerollYard={rerollYard}
              onSkipNode={() => { setPendingBench(null); skipNode(); }}
              selectedPart={state.parts.find((p) => p.instanceId === state.selectedInstanceId) ?? null}
              onApplyMod={(instanceId, modId) => {
                if (runScrap < MACHINIST_MOD_COST) return;
                addScrap(-MACHINIST_MOD_COST);
                applyModifier(instanceId, modId);
                markYardMod();
              }}
              profile={profile}
              history={history}
              onStartCustom={startCustomFrame}
              onLaunch={launch}
            />
          </div>
          {run.phase === 'none' && (
            <div className="section">
              <ArenaPanel build={build} onFight={(o, m) => { runFightRef.current = false; fight(o, m); }} />
            </div>
          )}
        </div>
      </div>}

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
          purse={Math.round((PURSE_BASE + PURSE_PER_NODE * wreck.nodeIndex) * (wreck.opponent.elite ? ELITE_PURSE_MULT : 1))}
          benchUsed={run.data.benchPool.length}
          guaranteeMod={run.data.fightsWon === 0}
          unlocks={wreck.unlocks}
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
                // Salvage settles the node (docs/04 §2) before the ladder
                // advances; beating the mech registers its unlocks (04 §7).
                const unlocks = unlockFrom(battle.opponent.build);
                setWreck({ report: battle.report, opponent: battle.opponent, nodeIndex: run.data.nodeIndex, unlocks });
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
