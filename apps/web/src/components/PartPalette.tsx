import { PARTS, type PartDef } from '@mechbattler/sim';
import { GAME_CONTENT } from '@mechbattler/game';
import { CATEGORY_COLOR, CATEGORY_LABEL, CATEGORY_ORDER } from '../lib/partVisuals.js';
import { ChipRow, ShapePreview } from './PartVisual.js';
import './PartPalette.css';

function metaLine(def: PartDef): string {
  const bits: string[] = [`${def.massKg}kg`, `${def.hp}hp`];
  if (def.weapon) bits.push(`${def.weapon.damage}dmg/${def.weapon.cycleS}s`);
  if (def.perimeterOnly) bits.push('perimeter only');
  return bits.join(' · ');
}

export function PartPalette({
  selectedPartId, onSelect, onHover, priceMult, scrap, visiblePartIds, ownedCounts,
  readOnly, label = 'Salvage bin',
}: {
  selectedPartId: string | null;
  onSelect: (id: string | null) => void;
  /** Inventory hover preview (docs/01 §9): browsing is reading trade-offs. */
  onHover: (id: string | null) => void;
  /** During a run, fresh parts cost tier × this scrap (docs/04 §1). */
  priceMult?: number;
  scrap?: number;
  /** Limit game-facing inventory to equipment actually available in this context. */
  visiblePartIds?: Set<string>;
  /** Physical owned-copy counts, used during active runs. */
  ownedCounts?: Map<string, number>;
  /** Active runs may only fit owned bench parts; the catalog is reference-only. */
  readOnly?: boolean;
  label?: string;
}) {
  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat, parts: Object.values(PARTS).filter(
      (part) => part.category === cat
        && GAME_CONTENT.enabledPartIds.includes(part.id)
        && (!visiblePartIds || visiblePartIds.has(part.id)),
    ),
  })).filter(({ parts }) => parts.length > 0);

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 10 }}>{label}</div>
      {byCategory.map(({ cat, parts }) => (
        <div className="category" key={cat}>
          <div className="category-label" style={{ color: 'var(--ink-secondary)' }}>
            <span className="swatch" style={{ background: CATEGORY_COLOR[cat] }} />
            {CATEGORY_LABEL[cat]}
          </div>
          {parts.map((def) => {
            const disabled = readOnly;
            return (
              <button
                key={def.id}
                type="button"
                className={`part-row${selectedPartId === def.id ? ' selected' : ''}${disabled ? ' locked' : ''}`}
                disabled={disabled}
                title={readOnly ? 'Installed parts are on the mech; salvaged spares are managed on the run bench' : undefined}
              onClick={() => onSelect(selectedPartId === def.id ? null : def.id)}
              onMouseEnter={() => onHover(def.id)}
              onMouseLeave={() => onHover(null)}
            >
              <ShapePreview def={def} />
              <div className="part-info">
                <div className="part-name">
                  {def.name}
                  {ownedCounts?.has(def.id) && (
                    <span className="part-price">×{ownedCounts.get(def.id)}</span>
                  )}
                  {priceMult !== undefined && (
                    <span className={`part-price${scrap !== undefined && def.tier * priceMult > scrap ? ' too-rich' : ''}`}>
                      −{def.tier * priceMult}⚙
                    </span>
                  )}
                </div>
                <ChipRow def={def} />
                <div className="part-meta">{metaLine(def)}</div>
              </div>
            </button>
            );
          })}
        </div>
      ))}
      <div className="rotate-hint">
        {readOnly ? 'Your installed equipment is on the mech; salvaged spares are on the run bench.'
          : <>Select a part, then click the grid to place it.<br />Press <kbd>R</kbd> to rotate before placing.</>}
      </div>
    </div>
  );
}
