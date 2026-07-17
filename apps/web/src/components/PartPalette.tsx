import type { ReactNode } from 'react';
import { PARTS, type PartDef } from '@mechbattler/sim';
import { CATEGORY_COLOR, CATEGORY_LABEL, CATEGORY_ORDER } from '../lib/partVisuals.js';
import './PartPalette.css';

function ShapePreview({ def }: { def: PartDef }) {
  const minDx = Math.min(...def.shape.map((c) => c.dx));
  const minDy = Math.min(...def.shape.map((c) => c.dy));
  const maxDx = Math.max(...def.shape.map((c) => c.dx));
  const maxDy = Math.max(...def.shape.map((c) => c.dy));
  const w = maxDx - minDx + 1;
  const h = maxDy - minDy + 1;
  const occupied = new Set(def.shape.map((c) => `${c.dx - minDx},${c.dy - minDy}`));
  const color = CATEGORY_COLOR[def.category];

  const cells: ReactNode[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const on = occupied.has(`${x},${y}`);
      cells.push(
        <div
          key={`${x},${y}`}
          className="part-shape-cell"
          style={{ background: on ? color : 'transparent' }}
        />,
      );
    }
  }
  return (
    <div className="part-shape" style={{ gridTemplateColumns: `repeat(${w}, 1fr)`, gridTemplateRows: `repeat(${h}, 1fr)` }}>
      {cells}
    </div>
  );
}

function summarize(def: PartDef): string {
  const bits: string[] = [`${def.massKg}kg`, `${def.hp}hp`];
  if (def.reactor) bits.push(`${def.reactor.outputKw}kW out`);
  if (def.capacitor) bits.push(`${def.capacitor.storedKj}kJ`);
  if (def.weapon) bits.push(`${def.weapon.damage}dmg/${def.weapon.cycleS}s`);
  if (def.perimeterOnly) bits.push('perimeter only');
  return bits.join(' · ');
}

export function PartPalette({
  selectedPartId, onSelect,
}: {
  selectedPartId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat, parts: Object.values(PARTS).filter((p) => p.category === cat),
  }));

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Salvage bin</div>
      {byCategory.map(({ cat, parts }) => (
        <div className="category" key={cat}>
          <div className="category-label" style={{ color: 'var(--ink-secondary)' }}>
            <span className="swatch" style={{ background: CATEGORY_COLOR[cat] }} />
            {CATEGORY_LABEL[cat]}
          </div>
          {parts.map((def) => (
            <button
              key={def.id}
              type="button"
              className={`part-row${selectedPartId === def.id ? ' selected' : ''}`}
              onClick={() => onSelect(selectedPartId === def.id ? null : def.id)}
            >
              <ShapePreview def={def} />
              <div className="part-info">
                <div className="part-name">{def.name}</div>
                <div className="part-meta">{summarize(def)}</div>
              </div>
            </button>
          ))}
        </div>
      ))}
      <div className="rotate-hint">
        Select a part, then click the grid to place it.<br />
        Press <kbd>R</kbd> to rotate before placing.
      </div>
    </div>
  );
}
