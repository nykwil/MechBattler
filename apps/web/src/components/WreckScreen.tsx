import { useState } from 'react';
import { getChassis, getOccupiedCells, getPart, type Build, type PlacedPart } from '@mechbattler/sim';
import {
  previewWreckRecovery,
  type PartProvenance,
  type PendingSalvage,
  type SalvageCandidate,
} from '@mechbattler/game';
import { BENCH_CAP, type BenchPart } from '../state/runState.js';
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
  pending, benchUsed, currentBuild, currentScrap, partProvenance, onFinish, onRecover,
}: {
  pending: PendingSalvage;
  /** Bench-pool slots already occupied before this salvage. */
  benchUsed: number;
  currentBuild: Build;
  currentScrap: number;
  partProvenance?: Record<string, PartProvenance>;
  onFinish: (scrapGained: number, loot: BenchPart[]) => void;
  onRecover: (recovery: ReturnType<typeof previewWreckRecovery>) => void;
}) {
  const chassis = getChassis(pending.opponentChassisId);
  const wreck = pending.candidates;
  const [taken, setTaken] = useState<Set<string>>(() => new Set());
  const [confirmRecovery, setConfirmRecovery] = useState(false);

  const lootable = wreck.filter((candidate) => !candidate.destroyed);
  const destroyed = wreck.filter((candidate) => candidate.destroyed);
  const benchFree = BENCH_CAP - benchUsed;

  function toggle(candidate: SalvageCandidate) {
    if (candidate.destroyed) return;
    setTaken((prev) => {
      const next = new Set(prev);
      if (next.has(candidate.id)) next.delete(candidate.id);
      else if (next.size < benchFree) next.add(candidate.id);
      return next;
    });
  }

  const destroyedScrap = destroyed.reduce((sum, candidate) => sum + candidate.scrapValue, 0);
  const leftBehindScrap = lootable
    .filter((candidate) => !taken.has(candidate.id))
    .reduce((sum, candidate) => sum + candidate.scrapValue, 0);
  const total = pending.purse + destroyedScrap + leftBehindScrap;
  const recovery = previewWreckRecovery({
    pending,
    currentBuild,
    currentScrap,
    benchUsed,
    partProvenance,
  });

  function finish() {
    const loot: BenchPart[] = lootable
      .filter((candidate) => taken.has(candidate.id))
      .map((candidate) => ({
        id: candidate.id,
        partId: candidate.partId,
        integrity: Math.round(candidate.integrity * 100) / 100,
        modifiers: candidate.modifiers,
        variant: candidate.variant,
        provenance: candidate.provenance,
      }));
    onFinish(total, loot);
  }

  return (
    <div className="wreck-overlay">
      <div className="wreck-panel">
        <div className="wreck-head">
          <span className="wreck-title">SALVAGE — {pending.opponentName.toUpperCase()} WRECK</span>
          <span className="wreck-purse">purse +{pending.purse}</span>
          {pending.unlocks && (pending.unlocks.chassis.length > 0 || pending.unlocks.parts.length > 0 || pending.unlocks.challenges.length > 0) && (
            <span className="wreck-unlocks" title="Available for future runs' starting loadouts">
              ★ UNLOCKED: {[
                ...pending.unlocks.challenges.map((challenge) => `${challenge} complete`),
                ...pending.unlocks.chassis.map((name) => `${name} frame`),
                ...pending.unlocks.parts,
              ].join(' · ')}
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
            {wreck.map((candidate) => {
              const definition = getPart(candidate.partId);
              const placed: PlacedPart = {
                instanceId: candidate.id,
                partId: candidate.partId,
                integrity: candidate.integrity,
                modifiers: candidate.modifiers,
                variant: candidate.variant,
                origin: candidate.origin,
                rotation: candidate.rotation,
              };
              const cells = getOccupiedCells(placed, definition);
              const isTaken = taken.has(candidate.id);
              return (
                <g
                  key={candidate.id}
                  className={`wreck-part${candidate.destroyed ? ' destroyed' : ' lootable'}${isTaken ? ' taken' : ''}`}
                  onClick={() => toggle(candidate)}
                >
                  {cells.map((c) => (
                    <rect
                      key={`${c.x},${c.y}`}
                      x={c.x * CELL + 1} y={c.y * CELL + 1} width={CELL - 2} height={CELL - 2}
                      fill={candidate.destroyed ? 'var(--bg-inset)' : CATEGORY_COLOR[definition.category]}
                    />
                  ))}
                  {candidate.destroyed && (
                    <text x={(cells[0]!.x + 0.5) * CELL} y={(cells[0]!.y + 0.72) * CELL} className="wreck-x">✕</text>
                  )}
                </g>
              );
            })}
          </svg>

          <div className="wreck-list">
            <div className="wreck-list-title">
              Take up to {benchFree} (bench {benchUsed}/{BENCH_CAP}) — intact scrap value scales with tier and integrity
            </div>
            {lootable.map((candidate) => {
              const definition = getPart(candidate.partId);
              const isTaken = taken.has(candidate.id);
              return (
                <button
                  key={candidate.id}
                  type="button"
                  className={`wreck-row${isTaken ? ' taken' : ''}`}
                  onClick={() => toggle(candidate)}
                >
                  <span className="wreck-row-mark">{isTaken ? '▣' : '□'}</span>
                  <span className="wreck-row-name">
                    {definition.name} <ModChips modifiers={candidate.modifiers ?? []} variant={candidate.variant} />
                  </span>
                  <span className="wreck-row-int">{Math.round(candidate.integrity * 100)}%</span>
                  <span className="wreck-row-scrap">{isTaken ? 'take' : `+${candidate.scrapValue}`}</span>
                </button>
              );
            })}
            {destroyed.length > 0 && (
              <div className="wreck-destroyed">
                destroyed in the fight: {destroyed.map((candidate) => getPart(candidate.partId).name.split(' (')[0]).join(', ')} → +{destroyedScrap}
              </div>
            )}
          </div>
        </div>

        <div className="wreck-foot">
          <span className="wreck-total">+{total} scrap · {taken.size} part{taken.size === 1 ? '' : 's'} to bench</span>
          <button type="button" className="fight-btn" onClick={finish}>Strip the wreck</button>
        </div>

        <section className="wreck-recovery">
          <div>
            <span className="wreck-recovery-kicker">RISKY ALTERNATIVE · WHOLE-WRECK RECOVERY</span>
            <strong>Switch to the {chassis.name} frame</strong>
            <p>
              Pay {recovery.cost} scrap and inherit the wreck exactly as it survived:
              {' '}{recovery.replacementBuild.parts.length} installed part{recovery.replacementBuild.parts.length === 1 ? '' : 's'}.
              Your current build is stowed ({recovery.stowedParts.length}) and any bench overflow
              is scrapped ({recovery.scrappedParts.length}).
            </p>
            <small>
              Purse and destroyed debris apply first · wallet after recovery: {recovery.scrapAfter} scrap.
              This is less efficient than improving your existing mech.
            </small>
          </div>
          <button
            type="button"
            className={confirmRecovery ? 'danger-confirm' : ''}
            disabled={recovery.sameChassis || !recovery.affordable}
            title={recovery.sameChassis
              ? 'You already use this chassis'
              : !recovery.affordable ? `Need ${Math.abs(recovery.scrapAfter)} more scrap after settlement` : undefined}
            onClick={() => {
              if (!confirmRecovery) setConfirmRecovery(true);
              else onRecover(recovery);
            }}
          >
            {recovery.sameChassis ? 'Same chassis'
              : !recovery.affordable ? 'Cannot afford recovery'
                : confirmRecovery ? `Confirm switch −${recovery.cost}` : `Recover frame −${recovery.cost}`}
          </button>
        </section>
      </div>
    </div>
  );
}
