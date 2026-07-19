import { useMemo, useState } from 'react';
import { getChassis, getOccupiedCells, type BattleReport, type Build } from '@mechbattler/sim';
import { buildWreck, type WreckPart } from '../lib/wreck.js';
import { BENCH_CAP, SCRAP_WRECK_MULT, type BenchPart } from '../state/runState.js';
import { CATEGORY_COLOR } from '../lib/partVisuals.js';
import { ModChips } from './ModChips.js';
import './WreckScreen.css';

const CELL = 22;

/**
 * The salvage screen (docs/04 §2): the wreck as its actual chassis grid.
 * Take what you want (bench cap permitting) — everything left behind, and
 * everything destroyed, converts to scrap on the spot.
 */
export function WreckScreen({
  report, enemyBuild, opponentName, purse, benchUsed, guaranteeMod, unlocks, onFinish,
}: {
  report: BattleReport;
  enemyBuild: Build;
  opponentName: string;
  purse: number;
  /** Bench-pool slots already occupied before this salvage. */
  benchUsed: number;
  /** First wreck of the run: one lootable part carries a mod (docs/04 §4b). */
  guaranteeMod?: boolean;
  /** Names newly unlocked for future starts by beating this mech (docs/04 §7). */
  unlocks?: { chassis: string[]; parts: string[] };
  onFinish: (scrapGained: number, loot: BenchPart[]) => void;
}) {
  const chassis = getChassis(enemyBuild.chassisId);
  const wreck = useMemo(
    () => buildWreck(report, enemyBuild, { guaranteeMod }),
    [report, enemyBuild, guaranteeMod],
  );
  const [taken, setTaken] = useState<Set<string>>(() => new Set());

  const lootable = wreck.filter((w) => !w.destroyed);
  const destroyed = wreck.filter((w) => w.destroyed);
  const benchFree = BENCH_CAP - benchUsed;

  function toggle(w: WreckPart) {
    if (w.destroyed) return;
    setTaken((prev) => {
      const next = new Set(prev);
      if (next.has(w.placed.instanceId)) next.delete(w.placed.instanceId);
      else if (next.size < benchFree) next.add(w.placed.instanceId);
      return next;
    });
  }

  const destroyedScrap = destroyed.reduce((s, w) => s + w.scrapValue, 0);
  const leftBehindScrap = lootable.filter((w) => !taken.has(w.placed.instanceId)).reduce((s, w) => s + w.scrapValue, 0);
  const total = purse + destroyedScrap + leftBehindScrap;

  function finish() {
    const loot: BenchPart[] = lootable
      .filter((w) => taken.has(w.placed.instanceId))
      .map((w) => ({
        partId: w.placed.partId,
        integrity: Math.round(w.lootIntegrity! * 100) / 100,
        modifiers: w.modifiers.length > 0 ? w.modifiers : undefined,
        variant: w.variant,
      }));
    onFinish(total, loot);
  }

  return (
    <div className="wreck-overlay">
      <div className="wreck-panel">
        <div className="wreck-head">
          <span className="wreck-title">SALVAGE — {opponentName.toUpperCase()} WRECK</span>
          <span className="wreck-purse">purse +{purse}</span>
          {unlocks && (unlocks.chassis.length > 0 || unlocks.parts.length > 0) && (
            <span className="wreck-unlocks" title="Available for future runs' starting loadouts">
              ★ UNLOCKED: {[...unlocks.chassis.map((c) => `${c} frame`), ...unlocks.parts].join(' · ')}
            </span>
          )}
        </div>

        <div className="wreck-body">
          <svg width={chassis.width * CELL} height={chassis.height * CELL} className="wreck-grid">
            {Array.from({ length: chassis.height }, (_, y) =>
              Array.from({ length: chassis.width }, (_, x) =>
                chassis.mask[y]?.[x] ? (
                  <rect key={`${x},${y}`} className="wreck-cell" x={x * CELL} y={y * CELL} width={CELL} height={CELL} />
                ) : null,
              ),
            )}
            {wreck.map((w) => {
              const cells = getOccupiedCells(w.placed, w.def);
              const isTaken = taken.has(w.placed.instanceId);
              return (
                <g
                  key={w.placed.instanceId}
                  className={`wreck-part${w.destroyed ? ' destroyed' : ' lootable'}${isTaken ? ' taken' : ''}`}
                  onClick={() => toggle(w)}
                >
                  {cells.map((c) => (
                    <rect
                      key={`${c.x},${c.y}`}
                      x={c.x * CELL + 1} y={c.y * CELL + 1} width={CELL - 2} height={CELL - 2}
                      fill={w.destroyed ? 'var(--bg-inset)' : CATEGORY_COLOR[w.def.category]}
                    />
                  ))}
                  {w.destroyed && (
                    <text x={(cells[0]!.x + 0.5) * CELL} y={(cells[0]!.y + 0.72) * CELL} className="wreck-x">✕</text>
                  )}
                </g>
              );
            })}
          </svg>

          <div className="wreck-list">
            <div className="wreck-list-title">
              Take up to {benchFree} (bench {benchUsed}/{BENCH_CAP}) — the rest scraps at tier×{SCRAP_WRECK_MULT}
            </div>
            {lootable.map((w) => {
              const isTaken = taken.has(w.placed.instanceId);
              return (
                <button
                  key={w.placed.instanceId}
                  type="button"
                  className={`wreck-row${isTaken ? ' taken' : ''}`}
                  onClick={() => toggle(w)}
                >
                  <span className="wreck-row-mark">{isTaken ? '▣' : '□'}</span>
                  <span className="wreck-row-name">
                    {w.def.name} <ModChips modifiers={w.modifiers} variant={w.variant} />
                  </span>
                  <span className="wreck-row-int">{Math.round(w.lootIntegrity! * 100)}%</span>
                  <span className="wreck-row-scrap">{isTaken ? 'take' : `+${w.scrapValue}`}</span>
                </button>
              );
            })}
            {destroyed.length > 0 && (
              <div className="wreck-destroyed">
                destroyed in the fight: {destroyed.map((w) => w.def.name.split(' (')[0]).join(', ')} → +{destroyedScrap}
              </div>
            )}
          </div>
        </div>

        <div className="wreck-foot">
          <span className="wreck-total">+{total} scrap · {taken.size} part{taken.size === 1 ? '' : 's'} to bench</span>
          <button type="button" className="fight-btn" onClick={finish}>Strip the wreck</button>
        </div>
      </div>
    </div>
  );
}
