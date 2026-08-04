import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SPATIAL_DEMO_TEMPLATE, applyAutoWire, buildTierBudget, buildOccupancyMap, computeEnergyMargin, computeHeatAdvice, computeHeatBalance, computeSpeedProfile, getChassis, getPart, resolvePlacementEffects, runBattle, runTestBench, validateBuild, type Build, type BattleReport, type TestBenchResult } from '@mechbattler/sim';
import { useBuild, type OverlayMode } from './state/useBuild.js';
import { PartInspector } from './components/PartInspector.js';
import { ArenaPanel } from './components/ArenaPanel.js';
import { RunPanel } from './components/RunPanel.js';
import { WreckScreen } from './components/WreckScreen.js';
import {
  BENCH_CAP, MACHINIST_MOD_COST, PURSE_BASE, START_BUDGET,
  chassisRepairCost, repairCost, useRun,
} from './state/runState.js';
import { useProfile } from './state/profileState.js';
import type { RunPartOps } from './components/PartInspector.js';
const BattleReportScreen = lazy(() => import('./components/BattleReportScreen.js').then((m) => ({ default: m.BattleReportScreen })));
const BattleLiveScreen = lazy(() => import('./components/BattleLiveScreen.js').then((m) => ({ default: m.BattleLiveScreen })));
import { OPPONENTS, type OpponentDef } from './lib/opponents.js';
import { resolveView } from './lib/views.js';
import { settleRunFight } from './lib/settleRunFight.js';
import { placementPermission } from './lib/placementPermission.js';
import type { FightMode } from './components/ArenaPanel.js';
// Lazy: the Balance Lab is a desktop analysis tool with its own worker, and the
// battle screens carry the whole battle stylesheet. Neither is needed to paint the
// front door, which is what a visitor sees first.
const BalanceLab = lazy(() => import('./components/BalanceLab.js').then((m) => ({ default: m.BalanceLab })));
import { ReadoutSheet } from './components/ReadoutSheet.js';
import { Plate } from './components/Plate.js';
import { Readout } from './components/Readout.js';
import { ActionBar } from './components/ActionBar.js';
import { PartsSheet } from './components/PartsSheet.js';
import { IntelSheet } from './components/IntelSheet.js';
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
  'out-of-region': 'Crosses a region seam',
  'incompatible-stack': 'Those parts cannot stack',
  'footprint-mismatch': 'Stack footprints must match',
};

export default function App() {
  // ?view= routing, with the dev-only surfaces dropped outside development.
  const directView = resolveView(
    new URLSearchParams(window.location.search).get('view'),
    import.meta.env.DEV,
  );
  const [screen, setScreen] = useState<'title' | 'new-run' | 'profile' | 'workspace'>(
    directView === 'workshop' || directView === 'balance'
      || directView === 'battle' || directView === 'report'
      || directView === 'salvage' ? 'workspace' : 'title',
  );
  const [workspace, setWorkspace] = useState<'workshop' | 'balance'>(() =>
    directView === 'balance' ? 'balance' : 'workshop',
  );
  const {
    state, chassis, build, chassisOptions,
    setChassis, selectPart, selectInstance, rotate, detach, aim, nudge, place, remove, loadBuild, movePriority, setOverlay, setIntegrity, applyModifier,
    setRouteTool, placeRoute, setChassisIntegrity,
    checkCandidate, previewCells,
  } = useBuild('CH-5');

  const [benchResult, setBenchResult] = useState<TestBenchResult | null>(null);
  const [battle, setBattle] = useState<{ report: BattleReport; opponent: OpponentDef; mode: FightMode } | null>(null);
  const [live, setLive] = useState<{ build: Build; opponent: OpponentDef; seed: number } | null>(null);
  /**
   * Which bottom sheet is up, if any. These were four independent booleans, and
   * nothing stopped two being true at once -- the only thing preventing stacked
   * sheets was that each one's trigger happens to sit under the others. One
   * union makes "at most one sheet" a fact about the state rather than a
   * property of the current layout, so a new trigger cannot reintroduce it.
   */
  const [sheet, setSheet] = useState<'readout' | 'parts' | 'chassis' | 'intel' | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  const [intelPick, setIntelPick] = useState<string | null>(null);
  const [toast, setToast] = useState('');

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
  // Same rule the run domain uses. This arithmetic used to live here, which
  // meant chassis repair existed for a player clicking the button and for
  // nothing else — the headless progression loop could not do it at all.
  const bodyRepairCost = chassisRepairCost(state.chassisIntegrity);

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
    // Arming anything closes the sheet it was armed from, exactly as picking a
    // catalog part closes the parts sheet. The bench lives in the readout sheet,
    // which stayed open over the plate -- so the first tap aimed at the ghost hit
    // the sheet's scrim and merely closed it, costing a tap and looking like the
    // plate had stopped responding.
    setSheet(null);
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
    // The gates live in lib/placementPermission so each can be tested; this applies
    // whichever one fires.
    const permission = placementPermission({
      partId: state.selectedPartId,
      build,
      phase: run.phase,
      pendingBench,
    });
    if (permission.kind === 'deny') return;
    if (permission.kind === 'allow-from-bench') {
      takeBench(permission.benchIndex);
      setPendingBench(null);
    }
    // A detached part keeps its instanceId, so re-placing it is a move. Saying
    // "Placed" after a move reads as having made a second copy — the same wrong
    // impression the lingering ghost gave.
    setToast(state.detached ? 'Moved' : 'Placed');
    place();
    // The prototype's place() ends with `S.armed = null`, for every part and not
    // just one-of bench salvage. Staying armed leaves a live ghost on the plate, so
    // the next tap re-aims another copy instead of selecting the part just placed —
    // which is what made placing read as copying.
    selectPart(null);
  }, [state.selectedPartId, state.ghost, checkCandidate, pendingBench, takeBench, place, selectPart, run.phase, build]);

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
    const wired = applyAutoWire(chassis, build);
    if (wired.result.conduits.length === 0 && wired.result.routes.length === 0) return;
    loadBuild(wired.build);
  }, [chassis, build, loadBuild, runActive]);

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
  // The idle action bar is the intel strip, so it needs whoever is next.
  /**
   * Who the intel strip and sheet are actually about. During a run it is the
   * current ladder node's choices; outside one it is the free-play roster. The
   * strip previously always named OPPONENTS[0], so mid-run it announced a fight
   * the run would never offer.
   */
  const intelOpponents = useMemo((): OpponentDef[] => {
    // Nodes are generated when the run is created, so prep already knows who node
    // one is. Only free play has no ladder to point at.
    if (run.phase === 'none' || run.phase === 'over') return OPPONENTS;
    const node = run.data.generatedNodes.find((n) => n.index === run.data.nodeIndex);
    return node?.kind === 'fight' && node.opponents?.length ? node.opponents : OPPONENTS;
  }, [run]);

  const nextFight = useMemo(() => {
    const chosen = intelOpponents.find((o) => o.id === intelPick) ?? intelOpponents[0];
    return chosen ? { name: chosen.name, threat: chosen.threat } : null;
  }, [intelOpponents, intelPick]);

  // An action keeps its name through the whole flow: Place -> "Placed", and a
  // detached part re-placed -> "Moved". Both are set where the placement happens
  // (placeWithEconomy, the only route in) rather than inferred from the part count,
  // which cannot tell a move from a new fitting -- a detach-then-place dips the
  // count and raises it again, and reported the move as a fresh placement.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 1400);
    return () => clearTimeout(t);
  }, [toast]);

  /** Which part occupies each cell. The sim owns this mapping; do not re-derive it. */
  const cellOwners = useMemo(() => buildOccupancyMap(state.parts).byCell, [state.parts]);

  const ghostReason = useMemo(() => {
    if (!state.selectedPartId || !state.ghost) return null;
    const err = checkCandidate(state.ghost.x, state.ghost.y);
    return err ? (REJECTION_COPY[err.reason] ?? err.reason) : null;
  }, [state.selectedPartId, state.ghost, checkCandidate]);

  const ghostPlacementSummary = useMemo(() => {
    if (!state.selectedPartId || !state.ghost || ghostReason) return null;
    const preview = {
      instanceId: '__placement-preview__',
      partId: state.selectedPartId,
      origin: { ...state.ghost },
      rotation: state.rotation,
      integrity: state.placeExtras.integrity,
      modifiers: state.placeExtras.modifiers,
      variant: state.placeExtras.variant,
    };
    const previewBuild = { ...build, parts: [...state.parts, preview] };
    const effects = resolvePlacementEffects(chassis, previewBuild, preview.instanceId);
    if (!effects) return null;
    const facts = [effects.regionNames.join(', ')];
    if (effects.location.weaponArcBonusDeg > 0) {
      facts.push(`+${effects.location.weaponArcBonusDeg}° location arc`);
    }
    if (effects.supportArcBonusDeg > 0) facts.push(`+${effects.supportArcBonusDeg}° support arc`);
    if (effects.passiveCoolingCellCount > 0) {
      facts.push(`${effects.passiveCoolingCellCount} exterior cooling ${effects.passiveCoolingCellCount === 1 ? 'cell' : 'cells'}`);
    }
    if (effects.effectiveHeatMultiplier > 1) facts.push(`heat ×${effects.effectiveHeatMultiplier.toFixed(2)}`);
    if (effects.portCellCount > 0) facts.push(`${effects.portCellCount} port ${effects.portCellCount === 1 ? 'socket' : 'sockets'}`);
    if (effects.stackAboveInstanceIds.length + effects.stackBelowInstanceIds.length > 0) facts.push('joins stack');
    return facts.filter(Boolean).join(' · ');
  }, [build, chassis, ghostReason, state.ghost, state.parts, state.placeExtras,
      state.rotation, state.selectedPartId]);

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

  // ?view=battle opens a seeded free-play fight, ?view=report resolves one and
  // opens its report. Both match the existing ?view= affordances and exist so the
  // battle interfaces can be screenshotted without clicking through the workshop.
  // The live sim is rAF-driven, so headless virtual time cannot advance it; the
  // report route uses the synchronous watch path instead.
  const autoBattleRef = useRef(false);
  useEffect(() => {
    if (autoBattleRef.current) return;
    const opponent = OPPONENTS[0];
    if (!opponent) return;
    if (directView === 'battle') {
      autoBattleRef.current = true;
      // An armed build, so the console's gun chips actually have guns in them --
      // the default sandbox build is empty and shows none.
      const armed = OPPONENTS[OPPONENTS.length - 1] ?? opponent;
      setLive({ build: armed.build, opponent, seed: 20260730 });
    } else if (directView === 'report') {
      autoBattleRef.current = true;
      const report = runBattle({
        builds: [build, opponent.build], seed: 20260730,
        spawnDistanceM: opponent.spawnDistanceM,
      });
      setBattle({ report, opponent, mode: 'watch' });
    }
  }, [directView, build]);

  // ?view=salvage walks the real run state machine to a won node's salvage screen,
  // which is the only way to reach it: it needs an active run AND a victory. One
  // step per render, because each depends on the previous phase having committed.
  const salvageStepRef = useRef(0);
  useEffect(() => {
    if (directView !== 'salvage') return;
    const strong = OPPONENTS[OPPONENTS.length - 1];
    const weak = OPPONENTS[0];
    if (!strong || !weak) return;

    if (run.phase === 'none' && salvageStepRef.current === 0) {
      salvageStepRef.current = 1;
      loadBuild(strong.build);
      startCustom('Salvage preview');
    } else if (run.phase === 'prep' && salvageStepRef.current === 1) {
      salvageStepRef.current = 2;
      launch();
    } else if (run.phase === 'active' && salvageStepRef.current === 2 && !run.data.pendingSalvage) {
      salvageStepRef.current = 3;
      // A strong build against the weakest opponent, so winner is side 0.
      const report = runBattle({
        builds: [strong.build, weak.build], seed: 20260730,
        spawnDistanceM: weak.spawnDistanceM,
      });
      const purse = PURSE_BASE;
      beginSalvage({
        opponentName: weak.name,
        opponentChassisId: weak.build.chassisId,
        opponentPowerPriority: [...weak.build.powerPriority],
        purse,
        candidates: createSalvageCandidates({
          run: { seed: run.data.seed, nodeIndex: 0 },
          report,
          enemyBuild: weak.build,
          opponentName: weak.name,
          purse,
          guaranteeMod: true,
        }),
      });
    }
  }, [directView, run, loadBuild, startCustom, launch, beginSalvage]);

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
      // Rotate applies to what you are holding; the prototype notes "only in the
      // hand". With nothing armed it changed a value that arming resets, so the
      // key appeared to do nothing.
      if (e.key.toLowerCase() === 'r' && state.selectedPartId) rotate();
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
        chassis={chassis}
        build={build}
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

  // The inspector is its own detail sheet, opened by selection, so it is not also
  // a readout tab.
  // A dot on the run tab when something in there is waiting on a decision.
  // The machinist milestone and a scrapyard's stock are both offers that pass
  // if you walk by them, and both live one tap inside a sheet a player has no
  // reason to open. Players kept reporting features as missing that were simply
  // behind this tab — the salvage screen, where scrap is spent — so the tab now
  // says when it wants attention.
  const runDecisionWaiting = runActive && (
    (Boolean(run.data.pendingModService) && !run.data.pendingModService?.applied)
    || run.data.generatedNodes.find((n) => n.index === run.data.nodeIndex)?.kind === 'scrapyard'
  );
  const mobileTabs = [
    { id: 'run', label: runDecisionWaiting ? 'run ●' : 'run', node: <>{runNode}{arenaNode}</> },
  ];

  if (screen === 'title') {
    return (
      <TitleScreen
        run={run}
        profile={profile}
        onContinue={() => {
          setWorkspace('workshop');
          setScreen('workspace');
          // On a finished run this button reads "View the memorial", and the
          // memorial lives in the readout's run tab. It used to land on the
          // workshop and leave you to find it three taps in.
          if (run.phase === 'over') setSheet('readout');
        }}
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

  // The Balance Lab keeps the old desktop chrome; it is a desktop-only analysis
  // tool. The workshop is the ported prototype shell, and that shell is
  // height:100dvh -- it has to BE the viewport, so nothing may sit above it.
  if (workspace === 'balance') {
    return (
      <div className="app-shell">
        <header className="lab-topbar">
          <div className="brand">MechBattler <span className="tag">Balance Lab</span></div>
          <nav className="workspace-nav" aria-label="Workspace">
            <button type="button" onClick={() => setScreen('title')}>Title</button>
            <button type="button" onClick={() => setWorkspace('workshop')}>Workshop</button>
            <button type="button" className="active">Balance Lab</button>
          </nav>
        </header>
        <Suspense fallback={<p className="lazy-wait">Loading Balance Lab…</p>}>
          <BalanceLab />
        </Suspense>
      </div>
    );
  }

  return (
    <>
      {/* The prototype's shell (docs/prototypes/mobile-builder.html):
          topbar -> plate-area -> readout -> actionbar, with sheets over the top. */}
      <div className="app">
          <header className="topbar">
            <button
              className="chassis-btn"
              type="button"
              onClick={() => setSheet('chassis')}
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

          <div className="route-tools" role="group" aria-label="Routing tool">
            <button
              type="button"
              aria-pressed={state.routeTool === 'wire'}
              onClick={() => setRouteTool('wire')}
            >
              Bus
            </button>
            <button
              type="button"
              aria-pressed={state.routeTool === 'coolant'}
              onClick={() => setRouteTool('coolant')}
            >
              Heat pipe
            </button>
            <button
              type="button"
              disabled={!state.routeTool}
              onClick={() => setRouteTool(null)}
            >
              Done
            </button>
            {!runActive && !runPrep && (
              <button type="button" onClick={() => loadBuild(structuredClone(SPATIAL_DEMO_TEMPLATE.build))}>
                Demo
              </button>
            )}
            {runActive && state.chassisIntegrity < 1 && (
              <button
                type="button"
                disabled={bodyRepairCost > runScrap}
                onClick={() => {
                  if (bodyRepairCost > runScrap) return;
                  addScrap(-bodyRepairCost);
                  setChassisIntegrity(1);
                }}
                aria-label={`Repair chassis for ${bodyRepairCost} scrap`}
              >
                Body {Math.round(state.chassisIntegrity * 100)}%
              </button>
            )}
          </div>

          <Plate
            chassis={chassis}
            parts={state.parts}
            routes={state.routes}
            routeTool={state.routeTool}
            overlay={state.overlay}
            selectedInstanceId={state.selectedInstanceId}
            ghostCells={state.ghost && state.selectedPartId ? previewCells(state.ghost.x, state.ghost.y) : []}
            ghostLegal={Boolean(state.ghost) && ghostReason === null}
            thermalSnapshot={benchResult?.cellTempsFinalC ?? predictedTemps}
            onCellActivate={(x, y) => {
              if (state.routeTool) { placeRoute(x, y); return; }
              // Armed: a tap aims the ghost. Otherwise it selects what is there.
              if (state.selectedPartId) { aim(x, y); return; }
              selectInstance(cellOwners.get(`${x},${y}`)?.instanceId ?? null);
            }}
            onRouteCell={placeRoute}
          />

          <Readout
            massT={readoutStats.massT}
            ratedMassT={chassis.ratedMassT}
            powerMarginKw={readoutStats.powerMarginKw}
            heatMarginKw={readoutStats.heatMarginKw}
            faultCount={issues.filter((i) => i.severity === 'error').length}
            preview={null}
            onOpen={() => setSheet('readout')}
          />

          <p className={`toast${toast ? ' on' : ''}`} role="status" aria-live="polite">{toast}</p>

          <ActionBar
            armedName={state.selectedPartId ? getPart(state.selectedPartId).name.split(' ')[0] : null}
            moving={state.detached !== null}
            stows={runActive && benchUsed < BENCH_CAP}
            reason={ghostReason}
            preview={ghostPlacementSummary}
            onCancel={() => {
              const detached = state.detached;
              const name = state.selectedPartId ? getPart(state.selectedPartId).name.split(' ')[0] : '';
              // Backing out of a *detached* part used to destroy it. Mid-run, a
              // part you pull off the plate is something you own: it goes back to
              // the bench, and only a full bench (or free play, which has no
              // inventory) can still lose it.
              const stowed = detached !== null && runActive && benchUsed < BENCH_CAP
                && state.selectedPartId !== null;
              if (stowed && state.selectedPartId) {
                addBench({
                  id: detached.instanceId,
                  partId: state.selectedPartId,
                  integrity: state.placeExtras.integrity,
                  modifiers: state.placeExtras.modifiers,
                  variant: state.placeExtras.variant,
                  provenance: run.data.partProvenance[detached.instanceId],
                });
              }
              selectPart(null);
              if (stowed) setToast(`${name} to inventory`);
              else if (detached) setToast(`${name} discarded`);
            }}
            onRotate={rotate}
            onPlace={placeWithEconomy}
            onOpenParts={() => setSheet('parts')}
            next={nextFight}
            prep={runPrep}
            prepReady={runPrep
              && buildTierBudget(build) <= START_BUDGET
              && build.parts.some((p) => p.partId.startsWith('W-'))
              && build.parts.some((p) => p.partId.startsWith('R-'))}
            onLaunch={launch}
            onOpenIntel={() => setSheet('intel')}
          />
      </div>

      {/* Selecting a placed part opens its detail, as the prototype does: the one
          action a selected part offers is Detach (docs/14 §7), and it needs a
          surface to live on. */}
      {inspectorNode && (
        <Sheet
          open
          onClose={() => selectInstance(null)}
          label="Part detail"
          initialSnap="half"
        >
          <div className="sheet-head"><span className="sheet-title">Part</span></div>
          <div className="sheet-body">{inspectorNode}</div>
        </Sheet>
      )}

      <IntelSheet
        open={sheet === 'intel'}
        onClose={closeSheet}
        build={build}
        opponents={intelOpponents}
        selectedId={intelPick}
        onSelect={(o) => setIntelPick(o.id)}
        onFight={(o) => {
          setSheet(null);
          // A fight picked from the intel sheet during a live run *is* the run's
          // fight -- the sheet is already listing that ladder node's opponents,
          // not the free-play roster. Hardcoding false meant the mobile interface
          // could not advance the campaign at all: you could win, and get no
          // purse, no salvage, no node, with fightsWon stuck at 0. Outside an
          // active run (sandbox, or a trial fight during prep) it stays free play.
          runFightRef.current = run.phase === 'active';
          fight(o, 'command');
        }}
      />

      {sheet === 'chassis' && (
        <Sheet open onClose={closeSheet} label="Chassis">
          <div className="sheet-head"><span className="sheet-title">Chassis</span></div>
          <div className="sheet-body">
            <button
              type="button"
              className="part-row"
              onClick={() => { closeSheet(); setScreen('title'); }}
            >
              <span className="part-txt">
                <span className="part-name">← Title screen</span>
                <span className="part-sub">Leave the workshop</span>
              </span>
            </button>
            {chassisOptions.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`part-row${state.chassisId === c.id ? ' sel' : ''}`}
                onClick={() => { setChassis(c.id); closeSheet(); }}
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
        open={sheet === 'parts'}
        onClose={closeSheet}
        docked={false}
        selectedPartId={state.selectedPartId}
        onSelect={(id) => { selectPalettePart(id); if (id) closeSheet(); }}
        onHover={() => {}}
        visiblePartIds={palettePartIds}
        ownedCounts={ownedPartCounts}
        readOnly={runActive}
        label={runActive ? 'Owned equipment' : runPrep ? 'Available equipment' : 'Sandbox catalog'}
      />

      <ReadoutSheet
        open={sheet === 'readout'}
        // A finished run has one thing worth reading, and it is the memorial.
        initialTab={run.phase === 'over' ? 'run' : undefined}
        onClose={closeSheet}
        chassis={chassis}
        build={build}
        parts={state.parts}
        powerPriority={state.powerPriority}
        issues={issues}
        onMovePriority={movePriority}
        onBenchResult={setBenchResult}
        onAutoWire={runActive ? undefined : autoWireNow}
        extraTabs={mobileTabs}
      />

      {live && (
        <Suspense fallback={<p className="lazy-wait">Opening battle…</p>}>
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
        </Suspense>
      )}

      {run.phase === 'active' && run.data.pendingSalvage && (
        <WreckScreen
          pending={run.data.pendingSalvage}
          benchUsed={run.data.benchPool.length}
          onFinish={(scrapGained, loot) => {
            won(scrapGained, loot);
          }}
        />
      )}

      {battle && !live && !salvageOpen && (
        <Suspense fallback={<p className="lazy-wait">Opening report…</p>}>
        <BattleReportScreen
          yourBuild={build}
          report={battle.report}
          opponent={battle.opponent}
          onRematch={() => fight(battle.opponent, battle.mode)}
          onRematchSameSeed={() => fight(battle.opponent, battle.mode, battle.report.seed)}
          // The wreck is settled by onClose, so at render time "will there be
          // salvage" is exactly "was this a run fight that we won".
          salvageAwaits={runFightRef.current && battle.report.winner === 0}
          onClose={() => {
            // A closed run-fight report settles the node (docs/10 M1): a win
            // advances the ladder; every defeat ends this roguelike run.
            if (runFightRef.current) {
              runFightRef.current = false;
              recordBattle();
              const settledBuild = settleBuildDamage(build, battle.report);
              loadBuild(settledBuild);
              const unlocks = recordBattleOutcome(battle.report, battle.opponent.build);
              // The decision lives in lib/settleRunFight so its branches can be
              // tested; this applies it.
              const outcome = settleRunFight({
                report: battle.report,
                opponent: battle.opponent,
                run,
                unlocks,
              });
              if (outcome.kind === 'salvage') beginSalvage(outcome.pending);
              else if (outcome.kind === 'lost') {
                lost(outcome.cause);
                // A defeat ends the run. Closing the report used to leave
                // you standing in the workshop with no indication of that at all
                // -- the memorial existed, but nothing led you to it and nothing
                // said the run was over. Show it.
                setSheet('readout');
              }
            }
            setBattle(null);
          }}
        />
        </Suspense>
      )}
    </>
  );
}
