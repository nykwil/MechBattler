import { useMemo } from 'react';
import { computeConnectivity, getPart, type PlacedPart } from '@mechbattler/sim';
import { CATEGORY_COLOR, CATEGORY_LABEL } from '../lib/partVisuals.js';
import { repairCost, SCRAP_SELL_MULT } from '../state/runState.js';
import { ChipRow, ShapePreview } from './PartVisual.js';
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
  parts, selectedInstanceId, onRemove, onDeselect, runOps,
}: {
  parts: PlacedPart[];
  selectedInstanceId: string;
  onRemove: (instanceId: string) => void;
  onDeselect: () => void;
  runOps?: RunPartOps;
}) {
  const placed = parts.find((p) => p.instanceId === selectedInstanceId);
  const connectivity = useMemo(() => computeConnectivity(parts), [parts]);
  if (!placed) return null;

  const def = getPart(placed.partId);
  const drawsPower = Boolean(def.draw) || def.category === 'weapon';
  const powered = connectivity.connectedInstanceIds.has(placed.instanceId);

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

      <div className="inspector-rows">
        <div className="inspector-row"><span>Mass</span><span>{def.massKg} kg</span></div>
        <div className="inspector-row">
          <span>Hit points</span>
          <span>{Math.round(def.hp * placed.integrity)} / {def.hp}{placed.integrity < 1 ? ` (${Math.round(placed.integrity * 100)}% integrity)` : ''}</span>
        </div>
        <div className="inspector-row"><span>Position</span><span>({placed.origin.x}, {placed.origin.y}) · rot {placed.rotation}°</span></div>
        {drawsPower && (
          <div className="inspector-row">
            <span>Power network</span>
            <span className={powered ? 'ok' : 'bad'}>{powered ? '● connected' : '● unpowered'}</span>
          </div>
        )}
      </div>

      {runOps && (() => {
        // Repair pricing (docs/04 §3): 0.4 scrap × tier per integrity point.
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
        <button type="button" className="inspector-remove" onClick={() => onRemove(placed.instanceId)}>
          {runOps ? 'Discard part' : 'Remove part'}
        </button>
        <button type="button" className="inspector-close" onClick={onDeselect}>
          Deselect
        </button>
      </div>
      <div className="inspector-hint"><kbd>Del</kbd> {runOps ? 'discards' : 'removes'} · <kbd>Esc</kbd> deselects</div>
    </div>
  );
}
