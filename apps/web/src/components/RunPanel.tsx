import { useMemo, useState } from 'react';
import {
  DEFAULT_ARENA_LENGTH_M, DEFAULT_ARENA_WIDTH_M,
  generateTerrain, getChassis, getPart, type Build, type TerrainType,
} from '@mechbattler/sim';
import { BENCH_CAP, MACHINIST_MOD_COST, RUN_LENGTH, SCRAP_SELL_MULT, STARTER_KITS, type BenchPart, type RunPhase } from '../state/runState.js';
import { ladderOpponents, machinistOffers, nodeKind, scrapyardOffers, type YardOffer } from '../lib/ladder.js';
import { MODIFIERS, type PlacedPart } from '@mechbattler/sim';
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
  run, build, onStartKit, onFight, onAbandon, onNewRun, onSellBench, onFitBench, fittingBenchIndex,
  onBuyOffer, onRerollYard, onSkipNode, selectedPart, onApplyMod,
}: {
  run: RunPhase;
  build: Build;
  onStartKit: (templateId: string, kitName: string) => void;
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
  // --- Machinist (docs/04 §4b) ----------------------------------------------
  /** The part currently selected in the editor, if any. */
  selectedPart: PlacedPart | null;
  onApplyMod: (instanceId: string, modId: string) => void;
}) {
  const [pickedId, setPickedId] = useState<string | null>(null);

  if (run.phase === 'none') {
    return (
      <div>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Start a run — pick your starter kit</div>
        <div className="arena-opponents">
          {STARTER_KITS.map((k) => (
            <button key={k.templateId} type="button" className="arena-card" onClick={() => onStartKit(k.templateId, k.name)}>
              <div className="arena-card-head">
                <span className="arena-card-name">{k.name}</span>
              </div>
              <div className="arena-card-blurb">{k.blurb}</div>
            </button>
          ))}
        </div>
        <div className="run-note">
          One mech, {RUN_LENGTH} fights, permadeath on a core kill. The kit is a starting
          point — everything on it can be rebuilt.
        </div>
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
        </div>
        <button type="button" className="fight-btn" style={{ width: '100%' }} onClick={onNewRun}>
          New run
        </button>
      </div>
    );
  }

  const kind = nodeKind(run.data.seed, run.data.nodeIndex);
  const playerCells = getChassis(build.chassisId).mask.flat().filter(Boolean).length;
  const hasWeapons = build.parts.some((p) => p.partId.startsWith('W-'));
  const hasReactor = build.parts.some((p) => p.partId.startsWith('R-'));

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
    </>
  );

  if (kind === 'scrapyard') {
    const offers = scrapyardOffers(run.data.seed, run.data.nodeIndex, run.data.yardRerolled ?? false);
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
        <div className="run-bench" style={{ marginTop: 10 }}>
          <div className="run-bench-title">
            The machinist — one mod, applied to a part you own ({MACHINIST_MOD_COST}⚙, once per yard)
          </div>
          {machinistOffers(run.data.seed, run.data.nodeIndex).map((modId) => {
            const mod = MODIFIERS[modId]!;
            const applicable = selectedPart !== null
              && mod.appliesTo(getPart(selectedPart.partId))
              && !selectedPart.modifiers?.includes(modId);
            const cantAffordMod = run.data.scrap < MACHINIST_MOD_COST;
            return (
              <div key={modId} className="run-bench-row">
                <span className="run-bench-name" title={mod.blurb}>
                  <span className="mod-chip mod" style={{ marginRight: 6 }}>{mod.name}</span>
                  {mod.blurb}
                </span>
                <button
                  type="button"
                  className="run-bench-sell"
                  disabled={run.data.yardModApplied || !applicable || cantAffordMod}
                  title={run.data.yardModApplied ? 'Already applied this yard'
                    : selectedPart === null ? 'Select a placed part in the grid first'
                    : !applicable ? 'Not applicable to the selected part'
                    : cantAffordMod ? 'Not enough scrap' : `Apply to ${getPart(selectedPart.partId).name}`}
                  onClick={() => selectedPart && onApplyMod(selectedPart.instanceId, modId)}
                >
                  {run.data.yardModApplied ? 'spent' : `apply −${MACHINIST_MOD_COST}`}
                </button>
              </div>
            );
          })}
        </div>

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
        {benchSection(run.data.benchPool, onSellBench, onFitBench, fittingBenchIndex)}
      </div>
    );
  }

  const opponents = ladderOpponents(run.data.seed, run.data.nodeIndex);
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

      {(!hasWeapons || !hasReactor) && (
        <div className="arena-warning">
          {!hasReactor
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

      {benchSection(run.data.benchPool, onSellBench, onFitBench, fittingBenchIndex)}
    </div>
  );
}

function benchSection(
  benchPool: BenchPart[],
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
        // Sell value scales with integrity (docs/04 §1's tier×8 is the
        // pristine price) — otherwise buying junk and selling it mints scrap.
        const value = Math.max(1, Math.round(def.tier * SCRAP_SELL_MULT * b.integrity));
        return (
          <div key={`${b.partId}-${i}`} className="run-bench-row">
            <span className="run-bench-name">
              {def.name} <ModChips modifiers={b.modifiers} variant={b.variant} />
            </span>
            <span className="run-bench-int">{Math.round(b.integrity * 100)}%</span>
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
