import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getOccupiedCells, autoWire, buildTierBudget, computeEnergyMargin, computeHeatAdvice, computeHeatBalance, computeSpeedProfile, getChassis, getPart, runBattle, runTestBench, validateBuild, type Build, type BattleReport, type TestBenchResult } from '@mechbattler/sim';
import { useBuild, type OverlayMode } from './state/useBuild.js';
import { PartInspector } from './components/PartInspector.js';
import { ArenaPanel } from './components/ArenaPanel.js';
import { RunPanel } from './components/RunPanel.js';
import { WreckScreen } from './components/WreckScreen.js';
import {
  BENCH_CAP, MACHINIST_MOD_COST, PURSE_BASE, PURSE_PER_NODE,
  START_BUDGET, repairCost, useRun,
} from './state/runState.js';
import { useProfile } from './state/profileState.js';
import type { RunPartOps } from './components/PartInspector.js';
import { ELITE_PURSE_MULT } from './lib/ladder.js';
import { BattleReportScreen } from './components/BattleReportScreen.js';
import { BattleLiveScreen } from './components/BattleLiveScreen.js';
import type { OpponentDef } from './lib/opponents.js';
import type { FightMode } from './components/ArenaPanel.js';
import { BalanceLab } from './components/BalanceLab.js';
import { ReadoutSheet } from './components/ReadoutSheet.js';
import { Plate } from './components/Plate.js';
import { Readout } from './components/Readout.js';
import { ActionBar } from './components/ActionBar.js';
import { PartsSheet } from './components/PartsSheet.js';
import { Sheet } from './components/Sheet.js';
import { NewRunScreen, ProfileScreen, TitleScreen } from './components/GameFrontDoor.js';
import { createSalvageCandidates, settleBuildDamage, type SavedMech } from '@mechbattler/game';
import './App.css';

const PLATE_VIEWS: { id: OverlayMode; label: string }[] = [
  { id: 'parts', label: 'Parts' },
  { id: 'power', label: 'Power' },
  { id: 'thermal', label: 'Heat' },
];

/** docs/14 §10: name the cause and the fix, briefly enough for the action bar. */
const REJECTION_COPY: Record<string, string> = {
  overlap: 'Overlaps a fitted part',
  'out-of-mask': 'Hangs off the chassis',
  'core-occupied': 'The core cell is reserved',
  'perimeter-required': 'Needs a chassis rim cell',
};

export default function App() {
  const directView = new URLSearchParams(window.location.search).get('view');
  const [screen, setScreen] = useState<'title' | 'new-run' | 'profile' | 'workspace'>(
    directView === 'workshop' || directView === 'balance' ? 'workspace' : 'title',
  );
  const [workspace, setWorkspace] = useState<'workshop' | 'balance'>(() =>
    directView === 'balance' ? 'balance' : 'workshop',
  );
  const {
    state, chassis, build, chassisOptions,
    setChassis, selectPart, selectInstance, rotate, detach, aim, nudge, place, remove, addParts, loadBuild, movePriority, setOverlay, setIntegrity, applyModifier,
    checkCandidate, previewCells,
  } = useBuild('CH-5');

  const [benchResult, setBenchResult] = useState<TestBenchResult | null>(null);
  const [battle, setBattle] = useState<{ report: BattleReport; opponent: OpponentDef; mode: FightMode } | null>(null);
  const [live, setLive] = useState<{ build: Build; opponent: OpponentDef; seed: number } | null>(null);
  const [readoutOpen, setReadoutOpen] = useState(false);
  const [partsOpen, setPartsOpen] = useState(false);
  const [chassisOpen, setChassisOpen] = useState(false);

  // --- Run shell (docs/10 M1) ------------------------------------------------
  const {
    run, startCustom, renamePrep, launch, won, lost, recordBattle, beginSalvage, abandon, sellBench, addScrap, addBench, takeBench, applyBenchModifier, repairBench,
    skipNode, rerollYard, markMilestoneMod, clearModService, persistBuild, restored, clearRestored,
  } = useRun();
  const { profile, recordBattleOutcome, pushHistory, saveMech, removeSavedMech } = useProfile();
  /** Whether the open battle belongs to the run (vs free-play arena). */
  const runFightRef = useRef(false);
  /** Bench-pool part armed for grid placement (docs/10 M3). */
  const [pendingBench, setPendingBench] = useState<{ index: number; partId: string } | null>(null);
  const [editingSavedMechId, setEditingSavedMechId] = useState<string | null>(null);

  const runActive = run.phase === 'active';
  const salvageOpen = runActive && Boolean(run.data.pendingSalvage);
  const runPrep = run.phase === 'prep';
  const runScrap = runActive ? run.data.scrap : 0;
  const benchUsed = runActive ? run.data.benchPool.length : 0;

  // Memorial (docs/10 M6): a finished run is recorded once.
  const historyPushedRef = useRef(false);
  useEffect(() => {
    if (run.phase === 'over' && !restored && !historyPushedRef.current) {
      historyPushedRef.current = true;
      pushHistory({
        runId: `run-${run.data.seed.toString(16)}`,
        kitName: run.data.kitName, fightsWon: run.data.fightsWon,
        cause: run.cause, victorious: run.victorious, endedAt: new Date().toISOString(),
        finalBuild: build,
        unlockedPartIds: run.data.earnedPartIds,
      });
    }
    if (run.phase !== 'over') historyPushedRef.current = false;
  }, [run, restored, build, pushHistory]);

  /** Custom-frame start (docs/04 §7): bare unlocked chassis, then outfit. */
  const startCustomFrame = useCallback((chassisId: string) => {
    setPendingBench(null);
    setEditingSavedMechId(null);
    setChassis(chassisId); // resets the editor to an empty build
    startCustom(`New ${getChassis(chassisId).name}`);
    setScreen('workspace');
    setWorkspace('workshop');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setChassis, startCustom]);

  /** Load a reusable profile blueprint into prep without starting the run yet. */
  const loadSavedMech = useCallback((savedMech: SavedMech) => {
    setPendingBench(null);
    setEditingSavedMechId(savedMech.id);
    loadBuild(savedMech.build);
    startCustom(savedMech.name);
    setScreen('workspace');
    setWorkspace('workshop');
  }, [loadBuild, startCustom]);

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
    selectPart(b.partId, {
      instanceId: b.id,
      integrity: b.integrity,
      modifiers: b.modifiers,
      variant: b.variant,
    });
  }, [run, selectPart]);

  // Placement with the run economy in the loop (docs/10 M3): a bench part
  // consumes its bench slot; a fresh catalog part is bought at tier ×
  // SCRAP_BUY_MULT (> sell, so the palette can't mint scrap). Free play
  // outside a run is unchanged.
  // docs/14 §6: commits whatever the ghost is currently aimed at. The economy
  // gates are unchanged; only the trigger moved from a cell click to Place.
  const placeWithEconomy = useCallback(() => {
    if (!state.selectedPartId || !state.ghost) return;
    if (checkCandidate(state.ghost.x, state.ghost.y) !== null) return;
    if (pendingBench && pendingBench.partId === state.selectedPartId) {
      takeBench(pendingBench.index);
      setPendingBench(null);
      place();
      selectPart(null); // a bench part is one-of — disarm after placing
      return;
    }
    if (runPrep) {
      // Custom-frame outfitting (docs/04 §7): unlocked parts only, free but
      // capped by the tier budget (wiring is exempt, like the enemy ladder).
      const def = getPart(state.selectedPartId);
      if (!def.isConduit && !def.isHeatPipe && buildTierBudget(build) + def.tier > START_BUDGET) return;
      place();
      return;
    }
    // Once a run launches, the catalog is reference-only. New equipment comes
    // from owned bench salvage or a seeded scrapyard offer.
    if (runActive) return;
    place();
  }, [state.selectedPartId, state.ghost, checkCandidate, pendingBench, takeBench, place, selectPart, runActive, runPrep, build]);

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
      addBench({
        id: p.instanceId,
        partId: p.partId,
        integrity: p.integrity,
        modifiers: p.modifiers,
        variant: p.variant,
        provenance: run.data.partProvenance[p.instanceId],
      });
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

  const autoWireNow = useCallback(() => {
    if (runActive) return;
    const { conduits } = autoWire(chassis, build);
    if (conduits.length === 0) return;
    addParts(conduits);
  }, [chassis, build, addParts, runActive]);

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
  // Only what the 56px bar shows; the sheet computes its own detail.
  const ghostReason = useMemo(() => {
    if (!state.selectedPartId || !state.ghost) return null;
    const err = checkCandidate(state.ghost.x, state.ghost.y);
    return err ? (REJECTION_COPY[err.reason] ?? err.reason) : null;
  }, [state.selectedPartId, state.ghost, checkCandidate]);

  const readoutStats = useMemo(() => {
    const profile = computeSpeedProfile(chassis, build);
    const energy = computeEnergyMargin(chassis, build);
    const heat = computeHeatBalance(chassis, build);
    return {
      massT: profile.massT,
      powerMarginKw: energy.marginKw,
      heatMarginKw: heat.heatInKw <= 0 ? null : heat.marginKw,
    };
  }, [chassis, build]);

  const palettePartIds = useMemo(() => {
    if (run.phase === 'prep') return new Set(profile.unlockedPartIds);
    if (run.phase === 'active') {
      return new Set([
        ...state.parts.map((part) => part.partId),
        ...run.data.benchPool.map((part) => part.partId),
      ]);
    }
    return undefined;
  }, [runPrep, runActive, profile.unlockedPartIds, state.parts, run]);
  const ownedPartCounts = useMemo(() => {
    if (run.phase !== 'active') return undefined;
    const counts = new Map<string, number>();
    for (const part of [...state.parts, ...run.data.benchPool]) {
      counts.set(part.partId, (counts.get(part.partId) ?? 0) + 1);
    }
    return counts;
  }, [runActive, state.parts, run]);

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
      if (screen !== 'workspace' || workspace !== 'workshop') return;
      if (battle || live || salvageOpen) return; // overlays own the keyboard
      if (e.key.toLowerCase() === 'r') rotate();
      // Arrow keys are the keyboard's cell tap and Enter is its Place, so touch,
      // keyboard, and screen reader all drive one placement model (docs/14 §6).
      if (state.selectedPartId) {
        const nudges: Record<string, [number, number]> = {
          ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
        };
        const delta = nudges[e.key];
        if (delta) {
          e.preventDefault();
          nudge(delta[0], delta[1]);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          placeWithEconomy();
          return;
        }
      }
      if (e.key === 'Escape') {
        setPendingBench(null);
        selectPart(null);
        selectInstance(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedInstanceId) {
        // docs/14 §7: remove-in-place does not exist. Delete detaches, and
        // Discard (or Esc) from the armed state is what throws a part away.
        detach(state.selectedInstanceId);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rotate, selectPart, selectInstance, detach, nudge, placeWithEconomy, state.selectedPartId,
      state.selectedInstanceId, battle, live, salvageOpen, screen, workspace]);


  // docs/14 §11: built once, rendered by whichever container is showing -- the
  // docked right rail or the mobile readout sheet. Sharing the nodes is what
  // keeps this one version rather than two.
  const inspectorNode = state.selectedInstanceId ? (
    <div className="section">
      <PartInspector
        parts={state.parts}
        selectedInstanceId={state.selectedInstanceId}
        onDetach={detach}
        onDeselect={() => selectInstance(null)}
        runOps={runOps}
      />
    </div>
  ) : null;

  const runNode = (
    <RunPanel
                  run={run}
                  build={build}
                  onFight={(o, m) => { runFightRef.current = true; fight(o, m); }}
                  onAbandon={() => {
                    if (!window.confirm('Abandon this run? Its mech, bench, and scrap will be lost.')) return;
                    abandon();
                    setEditingSavedMechId(null);
                    setScreen('title');
                  }}
                  onNewRun={() => { abandon(); setEditingSavedMechId(null); setScreen('new-run'); }}
                  onSellBench={(i, v) => { setPendingBench(null); selectPart(null); sellBench(i, v); }}
                  onFitBench={fitBench}
                  fittingBenchIndex={pendingBench?.index ?? null}
                  onBuyOffer={(o) => {
                    if (o.price > runScrap || benchUsed >= BENCH_CAP) return;
                    addScrap(-o.price);
                    addBench({
                      id: `yard-${run.phase === 'active' ? run.data.seed : 0}-${run.phase === 'active' ? run.data.nodeIndex : 0}-${o.partId}-${run.phase === 'active' ? run.data.benchPool.length : 0}`,
                      partId: o.partId,
                      integrity: o.integrity,
                      provenance: {
                        source: 'scrapyard',
                        nodeIndex: run.phase === 'active' ? run.data.nodeIndex : undefined,
                      },
                    });
                  }}
                  onRerollYard={rerollYard}
                  onSkipNode={() => { setPendingBench(null); skipNode(); }}
                  onRepairBench={repairBench}
                  onRepairAll={() => {
                    if (run.phase !== 'active') return;
                    const damagedInstalled = state.parts.filter((part) => part.integrity < 1);
                    const installedCost = damagedInstalled.reduce(
                      (total, part) => total + repairCost(getPart(part.partId).tier, part.integrity, 1),
                      0,
                    );
                    const damagedBench = run.data.benchPool
                      .map((part, index) => ({ part, index }))
                      .filter(({ part }) => part.integrity < 1);
                    const benchCost = damagedBench.reduce(
                      (total, { part }) => total + repairCost(getPart(part.partId).tier, part.integrity, 1),
                      0,
                    );
                    if (installedCost + benchCost > run.data.scrap) return;
                    if (installedCost > 0) addScrap(-installedCost);
                    for (const part of damagedInstalled) setIntegrity(part.instanceId, 1);
                    for (const { index } of damagedBench) repairBench(index, 1);
                  }}
                  modTargets={[
                    ...state.parts.map((part) => ({
                      id: `installed:${part.instanceId}`,
                      partId: part.partId,
                      label: `Installed · ${getPart(part.partId).name}`,
                      modifiers: part.modifiers,
                    })),
                    ...(run.phase === 'active' ? run.data.benchPool.map((part, index) => ({
                      id: `bench:${index}`,
                      partId: part.partId,
                      label: `Bench · ${getPart(part.partId).name} (${Math.round(part.integrity * 100)}%)`,
                      modifiers: part.modifiers,
                    })) : []),
                  ]}
                  onApplyMilestoneMod={(targetId, modId) => {
                    if (runScrap < MACHINIST_MOD_COST) return;
                    addScrap(-MACHINIST_MOD_COST);
                    if (targetId.startsWith('installed:')) {
                      applyModifier(targetId.slice('installed:'.length), modId);
                    } else if (targetId.startsWith('bench:')) {
                      applyBenchModifier(Number(targetId.slice('bench:'.length)), modId);
                    }
                    markMilestoneMod();
                    clearModService();
                  }}
                  onSkipModService={clearModService}
                  onLaunch={launch}
                  editingSavedMechId={editingSavedMechId}
                  onSaveMech={(name) => {
                    const saved = saveMech(name, build, editingSavedMechId ?? undefined);
                    setEditingSavedMechId(saved.id);
                    renamePrep(saved.name);
                  }}
                />
  );

  const arenaNode = run.phase === 'none' ? (
    <div className="section">
      <ArenaPanel build={build} onFight={(o, m) => { runFightRef.current = false; fight(o, m); }} />
    </div>
  ) : null;

  const mobileTabs = [
    ...(inspectorNode ? [{ id: 'inspect', label: 'inspect', node: inspectorNode }] : []),
    { id: 'run', label: 'run', node: <>{runNode}{arenaNode}</> },
  ];

  if (screen === 'title') {
    return (
      <TitleScreen
        run={run}
        profile={profile}
        onContinue={() => { setWorkspace('workshop'); setScreen('workspace'); }}
        onNewRun={() => {
          if ((run.phase === 'active' || run.phase === 'prep')
            && !window.confirm('Abandon the active run and start over?')) return;
          if (run.phase !== 'none') abandon();
          setEditingSavedMechId(null);
          setScreen('new-run');
        }}
        onProfile={() => setScreen('profile')}
        onSandbox={() => { setWorkspace('workshop'); setScreen('workspace'); }}
        onBalance={() => { setWorkspace('balance'); setScreen('workspace'); }}
      />
    );
  }

  if (screen === 'new-run') {
    return (
      <NewRunScreen
        profile={profile}
        onLoadMech={loadSavedMech}
        onCreateMech={startCustomFrame}
        onDeleteMech={(id) => {
          const savedMech = profile.savedMechs.find((candidate) => candidate.id === id);
          if (!savedMech || !window.confirm(`Delete saved mech "${savedMech.name}"?`)) return;
          removeSavedMech(id);
        }}
        onBack={() => setScreen('title')}
      />
    );
  }

  if (screen === 'profile') {
    return <ProfileScreen profile={profile} onBack={() => setScreen('title')} />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          MechBattler <span className="tag">{workspace === 'balance' ? 'Balance Lab' : 'Workshop'}</span>
        </div>
        <nav className="workspace-nav" aria-label="Workspace">
          <button type="button" onClick={() => setScreen('title')}>Title</button>
          <button type="button" className={workspace === 'workshop' ? 'active' : ''} onClick={() => setWorkspace('workshop')}>Workshop</button>
          <button type="button" className={workspace === 'balance' ? 'active' : ''} onClick={() => setWorkspace('balance')}>Balance Lab</button>
        </nav>
        {workspace === 'workshop' && !runActive && !runPrep && <>
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
        </>}
      </header>

      {workspace === 'balance' ? <BalanceLab /> : (
        /* The prototype's shell (docs/prototypes/mobile-builder.html):
           topbar -> plate-area -> readout -> actionbar, with sheets over the top. */
        <div className="app">
          <header className="topbar">
            <button
              className="chassis-btn"
              type="button"
              onClick={() => setChassisOpen(true)}
              aria-label="Change chassis"
            >
              <span className="chassis-id">
                <span className="chassis-name">{chassis.name.split(' ')[0]}</span>
                <span className="chassis-type">{chassis.id} · {chassis.type}</span>
              </span>
              <span className="caret" aria-hidden="true">▾</span>
            </button>
            <div className="ov-toggle" role="group" aria-label="Plate view">
              {PLATE_VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={state.overlay === v.id}
                  onClick={() => setOverlay(v.id)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </header>

          <Plate
            chassis={chassis}
            parts={state.parts}
            overlay={state.overlay}
            selectedInstanceId={state.selectedInstanceId}
            ghostCells={state.ghost && state.selectedPartId ? previewCells(state.ghost.x, state.ghost.y) : []}
            ghostLegal={Boolean(state.ghost) && ghostReason === null}
            thermalSnapshot={benchResult?.cellTempsFinalC ?? predictedTemps}
            onCellActivate={(x, y) => {
              // Armed: a tap aims the ghost. Otherwise it selects what is there.
              if (state.selectedPartId) { aim(x, y); return; }
              const occ = state.parts.find((part) =>
                getOccupiedCells(part, getPart(part.partId)).some((c) => c.x === x && c.y === y));
              selectInstance(occ ? occ.instanceId : null);
            }}
          />

          <Readout
            massT={readoutStats.massT}
            ratedMassT={chassis.ratedMassT}
            powerMarginKw={readoutStats.powerMarginKw}
            heatMarginKw={readoutStats.heatMarginKw}
            faultCount={issues.filter((i) => i.severity === 'error').length}
            preview={null}
            onOpen={() => setReadoutOpen(true)}
          />

          <ActionBar
            armedName={state.selectedPartId ? getPart(state.selectedPartId).name.split(' ')[0] : null}
            moving={state.detached !== null}
            reason={ghostReason}
            onCancel={() => selectPart(null)}
            onRotate={rotate}
            onPlace={placeWithEconomy}
            onOpenParts={() => setPartsOpen(true)}
            idleHint={state.selectedInstanceId ? 'Detach from the readout sheet' : 'Open Parts to arm something'}
            onAutoWire={autoWireNow}
          />
        </div>
      )}

      {chassisOpen && (
        <Sheet open onClose={() => setChassisOpen(false)} label="Chassis">
          <div className="sheet-head"><span className="sheet-title">Chassis</span></div>
          <div className="sheet-body">
            {chassisOptions.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`part-row${state.chassisId === c.id ? ' sel' : ''}`}
                onClick={() => { setChassis(c.id); setChassisOpen(false); }}
              >
                <span className="part-txt">
                  <span className="part-name">{c.name}</span>
                  <span className="part-sub">{c.id} · {c.type} · {c.width}×{c.height}</span>
                </span>
                <span className="part-num">{c.ratedMassT.toFixed(1)} t</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      <PartsSheet
        open={partsOpen}
        onClose={() => setPartsOpen(false)}
        docked={false}
        selectedPartId={state.selectedPartId}
        onSelect={(id) => { selectPalettePart(id); if (id) setPartsOpen(false); }}
        onHover={() => {}}
        visiblePartIds={palettePartIds}
        ownedCounts={ownedPartCounts}
        readOnly={runActive}
        label={runActive ? 'Owned equipment' : runPrep ? 'Available equipment' : 'Sandbox catalog'}
      />

      <ReadoutSheet
        open={readoutOpen}
        onClose={() => setReadoutOpen(false)}
        chassis={chassis}
        build={build}
        parts={state.parts}
        powerPriority={state.powerPriority}
        issues={issues}
        onMovePriority={movePriority}
        onBenchResult={setBenchResult}
        extraTabs={mobileTabs}
      />

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

      {run.phase === 'active' && run.data.pendingSalvage && (
        <WreckScreen
          pending={run.data.pendingSalvage}
          benchUsed={run.data.benchPool.length}
          currentBuild={build}
          currentScrap={run.data.scrap}
          partProvenance={run.data.partProvenance}
          onFinish={(scrapGained, loot) => {
            won(scrapGained, loot);
          }}
          onRecover={(recovery) => {
            setPendingBench(null);
            selectPart(null);
            selectInstance(null);
            loadBuild(recovery.replacementBuild);
            won(recovery.scrapDelta, recovery.stowedParts, recovery.replacementParts);
          }}
        />
      )}

      {battle && !live && !salvageOpen && (
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
              recordBattle();
              const settledBuild = settleBuildDamage(build, battle.report);
              loadBuild(settledBuild);
              const unlocks = recordBattleOutcome(battle.report, battle.opponent.build);
              if (battle.report.winner === 0 && run.phase === 'active') {
                // Salvage settles the node (docs/04 §2) before the ladder
                // advances; beating the mech registers its unlocks (04 §7).
                const purse = Math.round(
                  (PURSE_BASE + PURSE_PER_NODE * run.data.nodeIndex)
                  * (battle.opponent.elite ? ELITE_PURSE_MULT : 1),
                );
                beginSalvage({
                  opponentName: battle.opponent.name,
                  opponentChassisId: battle.opponent.build.chassisId,
                  opponentPowerPriority: [...battle.opponent.build.powerPriority],
                  purse,
                  candidates: createSalvageCandidates({
                    run: { seed: run.data.seed, nodeIndex: run.data.nodeIndex },
                    report: battle.report,
                    enemyBuild: battle.opponent.build,
                    opponentName: battle.opponent.name,
                    purse,
                    guaranteeMod: run.data.fightsWon === 0,
                  }),
                  unlocks: {
                    chassis: unlocks.chassis,
                    parts: unlocks.parts,
                    challenges: unlocks.challenges,
                  },
                  unlockIds: {
                    chassis: unlocks.chassisIds,
                    parts: unlocks.partIds,
                    challenges: unlocks.challengeIds,
                  },
                });
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
