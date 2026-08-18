import { useMemo } from 'react';
import {
  connectedInstanceIds,
  getPart,
  requiresPowerConnection,
  resolvePlacementEffects,
  type Build,
  type ChassisSpec,
} from '@mechbattler/sim';
import { CATEGORY_COLOR, CATEGORY_LABEL } from '../lib/partVisuals.js';
import { repairCost, SCRAP_SELL_MULT } from '../state/runState.js';
import { ChipRow, ShapePreview } from './PartVisual.js';
import { ModChips } from './ModChips.js';
import './PartInspector.css';

/** Run-mode economy actions on a placed part (docs/10 M3). */
export interface RunPartOps {
  scrap: number;
  benchFull: boolean;
  onRepair: (instanceId: string, toIntegrity: number, cost: number) => void;
  onSell: (instanceId: string, value: number) => void;
  onUnplace: (instanceId: string) => void;
}

export function PartInspector({
  chassis, build, selectedInstanceId, onDetach, onDeselect, runOps,
}: {
  chassis: ChassisSpec;
  build: Build;
  selectedInstanceId: string;
  onDetach: (instanceId: string) => void;
  onDeselect: () => void;
  runOps?: RunPartOps;
}) {
  const placed = build.parts.find((p) => p.instanceId === selectedInstanceId);
  const connected = useMemo(() => connectedInstanceIds(chassis, build), [chassis, build]);
  const placement = useMemo(
    () => resolvePlacementEffects(chassis, build, selectedInstanceId),
    [chassis, build, selectedInstanceId],
  );
  if (!placed) return null;

  const def = getPart(placed.partId);
  // Was a local copy that read `draw || weapon`, missing the capacitor arm --
  // so a fitted, unwired capacitor showed no power row at all while
  // validation.ts rejected the build for exactly that. Same rule as Plate,
  // autowire and validation now.
  const drawsPower = requiresPowerConnection(def);
  const powered = connected.has(placed.instanceId);
  const stackNames = placement?.cells[0]?.stackInstanceIds.map((instanceId) => {
    const item = build.parts.find((part) => part.instanceId === instanceId);
    return item ? getPart(item.partId).name.split(' (')[0] : instanceId;
  }) ?? [];
  const exposureText = placement
    ? (['front', 'rear', 'left', 'right'] as const).map((direction) => {
      const exposure = placement.exposure[direction];
      const protectedText = exposure.protectedCellCount > 0 ? ` (+${exposure.protectedCellCount} protected)` : '';
      return `${direction[0]!.toUpperCase()}${direction.slice(1)} ${exposure.directCellCount}${protectedText}`;
    }).join(' · ')
    : '';

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Selected part</div>
      <div className="inspector-head">
        <ShapePreview def={def} />
        <div style={{ minWidth: 0 }}>
          <div className="inspector-name">{def.name}</div>
          <div className="inspector-cat" style={{ color: CATEGORY_COLOR[def.category] }}>
            {CATEGORY_LABEL[def.category]} · tier {def.tier}
          </div>
        </div>
      </div>

      <ChipRow def={def} />
      {(placed.modifiers?.length || placed.variant) && (
        <div style={{ marginTop: 6 }}>
          <ModChips modifiers={placed.modifiers} variant={placed.variant} />
        </div>
      )}

      <div className="inspector-rows">
        <div className="inspector-row"><span>Mass</span><span>{def.massKg} kg</span></div>
        <div className="inspector-row">
          <span>Hit points</span>
          <span>{Math.round(def.hp * placed.integrity)} / {def.hp}{placed.integrity < 1 ? ` (${Math.round(placed.integrity * 100)}% integrity)` : ''}</span>
        </div>
        <div className="inspector-row">
          <span>Position</span>
          <span>{placement?.regionNames.join(', ') || 'Body'} · ({placed.origin.x}, {placed.origin.y}) · rot {placed.rotation}°</span>
        </div>
        {drawsPower && (
          <div className="inspector-row">
            <span>Power network</span>
            <span className={powered ? 'ok' : 'bad'}>{powered ? '● connected' : '● unpowered'}</span>
          </div>
        )}
        {placement && placement.exteriorCellCount > 0 && (
          <div className="inspector-row">
            <span>Exterior cooling</span>
            <span className={placement.passiveCoolingCellCount > 0 ? 'ok' : 'bad'}>
              {placement.passiveCoolingCellCount}/{placement.exteriorCellCount} cells active
              {' · '}{placement.passiveCoolingKwPerC.toFixed(2)} kW/°C
            </span>
          </div>
        )}
        {placement && placement.portCellCount > 0 && (
          <div className="inspector-row"><span>Port sockets</span><span>{placement.portCellCount} occupied</span></div>
        )}
        {placement && placement.location.effects.map((effect) => (
          <div className="inspector-row" key={effect.zoneId}>
            <span>{effect.name}</span><span>{effect.description}</span>
          </div>
        ))}
        {placement?.baseWeaponArcDeg !== null && placement?.baseWeaponArcDeg !== undefined && (
          <div className="inspector-row">
            <span>Targeting arc</span>
            <span>
              {placement.baseWeaponArcDeg}°
              {placement.location.weaponArcBonusDeg > 0 ? ` + ${placement.location.weaponArcBonusDeg}° location` : ''}
              {placement.supportArcBonusDeg > 0 ? ` + ${placement.supportArcBonusDeg}° support` : ''}
              {' = '}{placement.effectiveWeaponArcDeg}°
            </span>
          </div>
        )}
        {placement && placement.weaponRangeMultiplier !== 1 && (
          <div className="inspector-row">
            <span>Range from location</span><span>×{placement.weaponRangeMultiplier.toFixed(2)}</span>
          </div>
        )}
        {placement && placement.effectiveHeatMultiplier !== 1 && (
          <div className="inspector-row">
            <span>Generated heat</span><span className="bad">×{placement.effectiveHeatMultiplier.toFixed(2)}</span>
          </div>
        )}
        {stackNames.length > 1 && (
          <div className="inspector-row"><span>Damage stack</span><span>{stackNames.join(' → ')}</span></div>
        )}
        {placement && (
          <div className="inspector-row"><span>Direct exposure</span><span>{exposureText}</span></div>
        )}
      </div>

      {runOps && (() => {
        // Repair pricing (docs/04 §3) comes from the economy dial, not a number
        // written here — it moved to 0.3 in Aug 2026 and this comment said 0.4.
        const partial = Math.min(1, placed.integrity + 0.1);
        const partialCost = repairCost(def.tier, placed.integrity, partial);
        const fullCost = repairCost(def.tier, placed.integrity, 1);
        // Integrity-scaled, like the bench (pristine price is tier × mult).
        const sellValue = Math.max(1, Math.round(def.tier * SCRAP_SELL_MULT * placed.integrity));
        return (
          <div className="inspector-run-ops">
            {placed.integrity < 1 && (
              <div className="inspector-repair-row">
                <span>Repair</span>
                <button
                  type="button"
                  disabled={partialCost > runOps.scrap}
                  onClick={() => runOps.onRepair(placed.instanceId, partial, partialCost)}
                >
                  +10% · −{partialCost}⚙
                </button>
                <button
                  type="button"
                  disabled={fullCost > runOps.scrap}
                  onClick={() => runOps.onRepair(placed.instanceId, 1, fullCost)}
                >
                  full · −{fullCost}⚙
                </button>
              </div>
            )}
            <div className="inspector-repair-row">
              <button
                type="button"
                disabled={runOps.benchFull}
                title={runOps.benchFull ? 'Bench pool is full' : 'Move to the bench pool'}
                onClick={() => runOps.onUnplace(placed.instanceId)}
              >
                To bench{runOps.benchFull ? ' (full)' : ''}
              </button>
              <button type="button" onClick={() => runOps.onSell(placed.instanceId, sellValue)}>
                Sell · +{sellValue}⚙
              </button>
            </div>
          </div>
        );
      })()}

      <div className="inspector-actions">
        {/* docs/14 §7: a selected part offers exactly one placement action.
            Detach lifts it into the placement state holding it -- move, rotate,
            place -- and discarding from there is how a part is thrown away.
            Deselect stays because it acts on the selection, not the part. */}
        <button type="button" className="inspector-detach" onClick={() => onDetach(placed.instanceId)}>
          Detach
        </button>
        <button type="button" className="inspector-close" onClick={onDeselect}>
          Deselect
        </button>
      </div>
      {/* Del detaches either way; Stow / Esc park it on the bench mid-run.
          Discard only when the bench is full (or outside a run). */}
      <div className="inspector-hint">
        <kbd>Del</kbd> {runOps ? (runOps.benchFull ? 'discards — bench full' : 'lifts it off') : 'removes'}
        {' · '}<kbd>Esc</kbd> {runOps ? (runOps.benchFull ? 'discards' : 'stows to inventory') : 'deselects'}
      </div>
    </div>
  );
}
