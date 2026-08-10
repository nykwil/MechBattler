import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_ARENA_LENGTH_M, DEFAULT_ARENA_WIDTH_M,
  generateTerrain, getChassis, getPart, type Build, type TerrainType,
} from '@mechbattler/sim';
import {
  BENCH_CAP, MACHINIST_MOD_COST, RUN_LENGTH, START_BUDGET, benchSellValue,
  repairCost, type BenchPart, type RunPhase,
} from '../state/runState.js';
import { buildTierBudget } from '@mechbattler/sim';
import { hasReactor, hasWeapon, launchBlockers } from '../lib/launchGate.js';
import { planRepairAll } from '../lib/repairPlan.js';
import type { YardOffer } from '../lib/ladder.js';
import { MODIFIERS } from '@mechbattler/sim';
import { GAME_CONTENT } from '@mechbattler/game';
import { ModChips } from './ModChips.js';
import type { OpponentDef } from '../lib/opponents.js';
import type { FightMode } from './ArenaPanel.js';
import './ArenaPanel.css';
import './RunPanel.css';

const TERRAIN_FILL: Record<TerrainType, string> = {
  open: '#26292d', forest: '#2e4a2e', hill: '#4a4030', water: '#28405a',
};

/**
 * The intel card's arena preview (docs/04 §5): terrain silhouette plus both
 * spawn points, derived from the same battle seed the fight will use.
 */
function ArenaPreview({ battleSeed, spawnDistanceM }: { battleSeed: number; spawnDistanceM: number }) {
  const terrain = useMemo(
    () => generateTerrain(battleSeed, DEFAULT_ARENA_LENGTH_M, DEFAULT_ARENA_WIDTH_M),
    [battleSeed],
  );
  const cell = 3;
  const w = terrain.cols * cell;
  const h = terrain.rows * cell;
  // Spawns sit on the length axis (x), centered: ±spawnDistance/2 from middle.
  const sx = (d: number) => ((d + DEFAULT_ARENA_LENGTH_M / 2) / DEFAULT_ARENA_LENGTH_M) * w;
  const sy = h / 2;
  return (
    <svg className="arena-preview" width={w} height={h} aria-label="arena preview">
      {terrain.cells.map((row, ry) => row.map((t, cx) => (
        <rect key={`${cx},${ry}`} x={cx * cell} y={ry * cell} width={cell} height={cell} fill={TERRAIN_FILL[t]} />
      )))}
      <circle cx={sx(-spawnDistanceM / 2)} cy={sy} r={2.2} fill="var(--signal-green)" />
      <circle cx={sx(spawnDistanceM / 2)} cy={sy} r={2.2} fill="var(--signal-red)" />
    </svg>
  );
}

/**
 * The run shell (docs/10 M1): start-kit picker → node screen with scouted
 * opponent cards → memorial on death or ladder victory. Reuses the arena
 * card styling so intel reads the same everywhere.
 */
export function RunPanel({
  run, build, onFight, onAbandon, onNewRun, onSellBench, onFitBench, fittingBenchIndex,
  onBuyOffer, onRerollYard, onSkipNode, modTargets, onApplyMilestoneMod, onSkipModService,
  onRepairAll, onRepairBench, onLaunch, onSaveMech, editingSavedMechId,
}: {
  run: RunPhase;
  build: Build;
  onFight: (opponent: OpponentDef, mode: FightMode) => void;
  onAbandon: () => void;
  onNewRun: () => void;
  onSellBench: (index: number, value: number) => void;
  /** Arm a bench part for grid placement (docs/10 M3). */
  onFitBench: (index: number) => void;
  /** Bench index currently armed for placement, if any. */
  fittingBenchIndex: number | null;
  // --- Scrapyard nodes (docs/10 M4) ----------------------------------------
  onBuyOffer: (offer: YardOffer) => void;
  onRerollYard: () => void;
  onSkipNode: () => void;
  /** Repair all damaged installed and benched parts to full integrity. */
  onRepairAll: () => void;
  /** Repair one benched part to full integrity. */
  onRepairBench: (index: number) => void;
  // --- Milestone machinist ---------------------------------------------------
  modTargets: Array<{ id: string; partId: string; label: string; modifiers?: string[] }>;
  onApplyMilestoneMod: (targetId: string, modId: string) => void;
  onSkipModService: () => void;
  onLaunch: () => void;
  /** Save the current prep build as a reusable profile blueprint. */
  onSaveMech: (name: string) => void;
  editingSavedMechId: string | null;
}) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [modTargetId, setModTargetId] = useState<string>('');
  const [mechName, setMechName] = useState(run.phase === 'prep' ? run.data.kitName : '');

  useEffect(() => {
    if (run.phase === 'prep') setMechName(run.data.kitName);
  }, [run.phase, run.phase === 'prep' ? run.data.kitName : '']);

  if (run.phase === 'none') {
    return (
      <div>
        <div className="eyebrow" style={{ marginBottom: 10 }}>No active run</div>
        <div className="run-note">
          Sandbox builds stay separate from the campaign. Start a run from your saved-mech garage.
        </div>
        <button type="button" className="fight-btn" style={{ width: '100%', marginTop: 10 }} onClick={onNewRun}>
          Open garage
        </button>
      </div>
    );
  }

  if (run.phase === 'prep') {
    // The budget number is shown as well as gated on, so it is read here too; the
    // gate itself comes from `launchGate` so this and the action bar cannot disagree.
    const used = buildTierBudget(build);
    const blockers = launchBlockers(build);
    const ready = blockers.length === 0;
    return (
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>Outfitting — {run.data.kitName}</div>
        <div className="run-status">
          <span>tier budget</span>
          <span className={`run-scrap${used > START_BUDGET ? ' over' : ''}`}>{used} / {START_BUDGET}</span>
          <button type="button" className="run-abandon" onClick={onAbandon}>abandon</button>
        </div>
        <div className="run-note" style={{ marginBottom: 8 }}>
          The equipment bin contains only starting parts you own. Wiring is free; everything
          else spends the tier budget. Save this blueprint for future runs or launch it now.
        </div>
        <div className="run-save-mech">
          <input
            aria-label="Mech name"
            maxLength={40}
            value={mechName}
            onChange={(event) => setMechName(event.target.value)}
          />
          <button
            type="button"
            disabled={!mechName.trim()}
            onClick={() => onSaveMech(mechName)}
          >
            {editingSavedMechId ? 'Save changes' : 'Save mech'}
          </button>
        </div>
        {!ready && (
          <div className="arena-warning">
            {blockers[0] === 'over-tier-budget' ? `Over budget by ${used - START_BUDGET} tier.`
              : blockers[0] === 'no-reactor' ? 'No reactor mounted.' : 'No weapons mounted.'}
          </div>
        )}
        <button type="button" className="fight-btn" style={{ width: '100%', marginTop: 8 }} disabled={!ready} onClick={onLaunch}>
          Launch the run
        </button>
      </div>
    );
  }

  if (run.phase === 'over') {
    return (
      <div>
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          {run.victorious ? 'Run complete' : 'Run over'}
        </div>
        <div className={`run-memorial${run.victorious ? ' victorious' : ''}`}>
          <div className="run-memorial-title">{run.victorious ? '☼ LADDER CLEARED' : '✕ CORE DESTROYED'}</div>
          <div className="run-memorial-line">{run.data.kitName} · {run.data.fightsWon} fight{run.data.fightsWon === 1 ? '' : 's'} won</div>
          <div className="run-memorial-line">{run.cause}</div>
          {(run.data.earnedPartIds.length > 0
            || run.data.earnedChassisIds.length > 0
            || run.data.earnedChallengeIds.length > 0) && (
            <div className="run-memorial-line">
              Earned: {[
                ...run.data.earnedChallengeIds.map((id) =>
                  GAME_CONTENT.challenges.find((challenge) => challenge.id === id)?.name ?? id),
                ...run.data.earnedChassisIds.map((id) => `${getChassis(id).name} frame`),
                ...run.data.earnedPartIds.map((id) => getPart(id).name),
              ].join(' · ')}
            </div>
          )}
        </div>
        <button type="button" className="fight-btn" style={{ width: '100%' }} onClick={onNewRun}>
          New run
        </button>
      </div>
    );
  }

  const currentNode = run.data.generatedNodes.find((node) => node.index === run.data.nodeIndex);
  if (!currentNode) {
    return <div className="run-note">This save has no generated content for node {run.data.nodeIndex}.</div>;
  }
  const kind = currentNode.kind;
  const playerCells = getChassis(build.chassisId).mask.flat().filter(Boolean).length;
  const weaponsMounted = hasWeapon(build);
  const reactorMounted = hasReactor(build);
  // The same plan the repair-all handler applies, so the quoted price is the
  // charged price by construction rather than by both sides doing the same sum.
  const repairAll = planRepairAll({
    parts: build.parts,
    benchPool: run.data.benchPool,
    scrap: run.data.scrap,
  });
  const damagedCount = repairAll.instanceIds.length + repairAll.benchIndices.length;

  const header = (
    <>
      <div className="eyebrow" style={{ marginBottom: 6 }}>
        Run — node {run.data.nodeIndex} of {RUN_LENGTH}{kind === 'scrapyard' ? ' · scrapyard' : ''}
      </div>
      <div className="run-status">
        <span>{run.data.kitName}</span>
        <span className="run-scrap">{run.data.scrap} scrap</span>
        <span>{run.data.fightsWon}W</span>
        <button type="button" className="run-abandon" onClick={onAbandon} title="End this run (no memorial)">abandon</button>
      </div>
      <div className="run-repair-bay">
        <span>
          Repair bay · {damagedCount > 0
            ? `${damagedCount} damaged part${damagedCount === 1 ? '' : 's'}`
            : 'all equipment field-ready'}
        </span>
        {repairAll.totalCost > 0 && (
          <button
            type="button"
            className="run-bench-sell"
            disabled={!repairAll.affordable}
            title={!repairAll.affordable ? 'Not enough scrap for a full repair' : 'Repair installed and benched parts'}
            onClick={onRepairAll}
          >
            repair all −{repairAll.totalCost}
          </button>
        )}
      </div>
    </>
  );

  if (run.data.pendingModService && !run.data.pendingModService.applied) {
    /*
     * Default to a target at least one of the offers can actually be fitted to.
     * Blindly taking the first installed part meant that when it was a reactor --
     * which it is on the starting blueprint -- every offer on a *reward* screen
     * rendered disabled, and the milestone read as broken rather than as waiting
     * for you to choose a gun from the dropdown.
     */
    const offers = run.data.pendingModService.offerIds;
    const firstUsable = modTargets.find((target) => offers.some((modId) => {
      const mod = MODIFIERS[modId];
      return mod?.appliesTo(getPart(target.partId))
        && !(target.modifiers ?? []).some((id) => MODIFIERS[id]?.kind === 'mod');
    }));
    const chosenTargetId = modTargetId || firstUsable?.id || modTargets[0]?.id || '';
    const chosenTarget = modTargets.find((target) => target.id === chosenTargetId);
    return (
      <div>
        {header}
        <div className="run-memorial victorious">
          <div className="run-memorial-title">◆ MACHINIST MILESTONE</div>
          <div className="run-memorial-line">
            Victory {run.data.pendingModService.afterWin}: choose one permanent modification for equipment you own.
          </div>
        </div>
        <label className="run-bench-title" htmlFor="mod-target">Target equipment</label>
        <select
          id="mod-target"
          className="run-target-select"
          value={chosenTargetId}
          onChange={(event) => setModTargetId(event.target.value)}
        >
          {modTargets.map((target) => (
            <option key={target.id} value={target.id}>{target.label}</option>
          ))}
        </select>
        <div className="run-bench" style={{ marginTop: 10 }}>
          {run.data.pendingModService.offerIds.map((modId) => {
            const mod = MODIFIERS[modId]!;
            const existingMod = chosenTarget?.modifiers?.some((id) => MODIFIERS[id]?.kind === 'mod') ?? false;
            const applicable = Boolean(chosenTarget) && mod.appliesTo(getPart(chosenTarget!.partId)) && !existingMod;
            const copies = modTargets.reduce(
              (count, target) => count + (target.modifiers?.filter((id) => id === modId).length ?? 0),
              0,
            );
            const atLimit = mod.maxCopiesPerBuild !== undefined && copies >= mod.maxCopiesPerBuild;
            const disabled = !applicable || atLimit || run.data.scrap < MACHINIST_MOD_COST;
            return (
              <div key={modId} className="run-bench-row">
                <span className="run-bench-name">
                  <span className="mod-chip mod" style={{ marginRight: 6 }}>{mod.name}</span>
                  {mod.blurb}{mod.tradeoff ? ` Cost: ${mod.tradeoff}` : ''}
                </span>
                <button
                  type="button"
                  className="run-bench-sell"
                  disabled={disabled}
                  onClick={() => chosenTarget && onApplyMilestoneMod(chosenTarget.id, modId)}
                >
                  apply −{MACHINIST_MOD_COST}
                </button>
              </div>
            );
          })}
        </div>
        <button type="button" className="fight-btn watch" style={{ width: '100%', marginTop: 10 }} onClick={onSkipModService}>
          Skip this service
        </button>
      </div>
    );
  }

  if (kind === 'scrapyard') {
    const offers = run.data.yardRerolled
      ? currentNode.scrapyardOffers?.reroll ?? []
      : currentNode.scrapyardOffers?.initial ?? [];
    const benchFull = run.data.benchPool.length >= BENCH_CAP;
    return (
      <div>
        {header}
        <div className="run-note" style={{ marginBottom: 8 }}>
          No fight here — a scrapyard. Used parts at dealer prices, straight to your bench.
        </div>
        {offers.map((o, i) => {
          const def = getPart(o.partId);
          const cantAfford = o.price > run.data.scrap;
          return (
            <div key={`${o.partId}-${i}`} className="run-bench-row">
              <span className="run-bench-name">{def.name}</span>
              <span className="run-bench-int">{Math.round(o.integrity * 100)}%</span>
              <button
                type="button"
                className="run-bench-sell"
                disabled={cantAfford || benchFull}
                title={benchFull ? 'Bench pool is full' : cantAfford ? 'Not enough scrap' : 'Buy to bench'}
                onClick={() => onBuyOffer(o)}
              >
                buy −{o.price}
              </button>
            </div>
          );
        })}
        <div className="fight-row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="fight-btn watch"
            disabled={run.data.yardRerolled}
            onClick={onRerollYard}
            title="One fresh set of offers per yard"
          >
            {run.data.yardRerolled ? 'Rerolled' : 'Reroll stock'}
          </button>
          <button type="button" className="fight-btn" onClick={onSkipNode}>
            Move on
          </button>
        </div>
        {benchSection(
          run.data.benchPool,
          run.data.scrap,
          onRepairBench,
          onSellBench,
          onFitBench,
          fittingBenchIndex,
        )}
      </div>
    );
  }

  const opponents = currentNode.opponents ?? [];
  if (opponents.length === 0) {
    return <div className="run-note">This fight node has no generated opponents.</div>;
  }
  const picked = opponents.find((o) => o.id === pickedId) ?? opponents[0]!;

  return (
    <div>
      {header}

      <div className="arena-opponents">
        {opponents.map((o) => {
          const enemyCells = getChassis(o.build.chassisId).mask.flat().filter(Boolean).length;
          const heavier = enemyCells > playerCells;
          return (
            <button
              key={o.id}
              type="button"
              className={`arena-card${o.id === picked.id ? ' active' : ''}${o.elite ? ' elite' : ''}`}
              onClick={() => setPickedId(o.id)}
            >
              <div className="arena-card-head">
                <span className="arena-card-name">{o.name}</span>
                <span className="arena-threat">{'▲'.repeat(o.threat)}</span>
              </div>
              <div className="arena-card-blurb">{o.blurb}</div>
              <div className="arena-card-intel">{o.chassisLabel} · confirmed: {o.confirmed.join(' · ')}</div>
              {o.battleSeed !== undefined && o.spawnDistanceM !== undefined && (
                <div className="arena-card-arena">
                  <ArenaPreview battleSeed={o.battleSeed} spawnDistanceM={o.spawnDistanceM} />
                  <span>spawn {o.spawnDistanceM} m</span>
                </div>
              )}
              {heavier && o.headline && (
                <div className="arena-card-warning">⚠ heavier frame — headline: {o.headline}</div>
              )}
              {o.carries && (
                <div className="arena-card-carries">◆ carries a {o.carries}</div>
              )}
            </button>
          );
        })}
      </div>

      {(!weaponsMounted || !reactorMounted) && (
        <div className="arena-warning">
          {!reactorMounted
            ? 'No reactor mounted — nothing on this mech will power up.'
            : 'No weapons mounted — you will surrender by mission-kill in 3 seconds.'}
        </div>
      )}

      <div className="fight-row">
        <button type="button" className="fight-btn" onClick={() => onFight(picked, 'command')} title="Step the battle live on screen">
          Fight · Live
        </button>
        <button type="button" className="fight-btn watch" onClick={() => onFight(picked, 'watch')} title="Resolve instantly, then replay">
          Watch
        </button>
      </div>

      {benchSection(
        run.data.benchPool,
        run.data.scrap,
        onRepairBench,
        onSellBench,
        onFitBench,
        fittingBenchIndex,
      )}
    </div>
  );
}

function benchSection(
  benchPool: BenchPart[],
  scrap: number,
  onRepairBench: (index: number) => void,
  onSellBench: (index: number, value: number) => void,
  onFitBench: (index: number) => void,
  fittingBenchIndex: number | null,
) {
  if (benchPool.length === 0) return null;
  return (
    <div className="run-bench">
      <div className="run-bench-title">Bench pool ({benchPool.length}/{BENCH_CAP}) — salvage awaiting a refit or a sale</div>
      {benchPool.map((b, i) => {
        const def = getPart(b.partId);
        const value = benchSellValue(def.tier, b.integrity);
        const fullRepairCost = repairCost(def.tier, b.integrity, 1);
        return (
          <div key={`${b.partId}-${i}`} className="run-bench-row">
            <span className="run-bench-name">
              {def.name} <ModChips modifiers={b.modifiers} variant={b.variant} />
            </span>
            <span className="run-bench-int">{Math.round(b.integrity * 100)}%</span>
            {fullRepairCost > 0 && (
              <button
                type="button"
                className="run-bench-sell"
                disabled={fullRepairCost > scrap}
                onClick={() => onRepairBench(i)}
                title={fullRepairCost > scrap ? 'Not enough scrap' : 'Repair this benched part to full integrity'}
              >
                repair −{fullRepairCost}
              </button>
            )}
            <button
              type="button"
              className={`run-bench-sell${fittingBenchIndex === i ? ' fitting' : ''}`}
              onClick={() => onFitBench(i)}
              title="Place this part on the grid"
            >
              {fittingBenchIndex === i ? 'placing…' : 'fit'}
            </button>
            <button type="button" className="run-bench-sell" onClick={() => onSellBench(i, value)} title="Scrap this part">
              sell +{value}
            </button>
          </div>
        );
      })}
    </div>
  );
}
