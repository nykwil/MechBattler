import { useMemo } from 'react';
import { computeConnectivity, getPart, type PlacedPart } from '@mechbattler/sim';
import { CATEGORY_COLOR, CATEGORY_LABEL } from '../lib/partVisuals.js';
import { ChipRow, ShapePreview } from './PartVisual.js';
import './PartInspector.css';

export function PartInspector({
  parts, selectedInstanceId, onRemove, onDeselect,
}: {
  parts: PlacedPart[];
  selectedInstanceId: string;
  onRemove: (instanceId: string) => void;
  onDeselect: () => void;
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

      <div className="inspector-actions">
        <button type="button" className="inspector-remove" onClick={() => onRemove(placed.instanceId)}>
          Remove part
        </button>
        <button type="button" className="inspector-close" onClick={onDeselect}>
          Deselect
        </button>
      </div>
      <div className="inspector-hint"><kbd>Del</kbd> removes · <kbd>Esc</kbd> deselects</div>
    </div>
  );
}
