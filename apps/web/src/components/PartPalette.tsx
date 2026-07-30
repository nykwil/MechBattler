import { PARTS, type PartCategory, type PartDef } from '@mechbattler/sim';
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
  readOnly, label = 'Salvage bin', category, lockedReason = 'Not unlocked yet',
}: {
  selectedPartId: string | null;
  onSelect: (id: string | null) => void;
  /** Inventory hover preview (docs/01 §9): browsing is reading trade-offs. */
  onHover: (id: string | null) => void;
  /** During a run, fresh parts cost tier × this scrap (docs/04 §1). */
  priceMult?: number;
  scrap?: number;
  /**
   * Equipment that can actually be fitted here. Parts outside the set are shown
   * anyway, disabled and marked locked, rather than removed.
   *
   * They used to be filtered out. With 7 of 22 parts unlocked that left the REACTOR
   * tab holding a single row and the others near-empty, so the builder read as
   * broken rather than as gated — the prototype's catalogue was always complete.
   * Showing the locked rows keeps the unlock economy and restores the shape of the
   * catalogue, and doubles as the list of what there is to win.
   */
  visiblePartIds?: Set<string>;
  /** Why the parts outside `visiblePartIds` cannot be fitted. */
  lockedReason?: string;
  /** Physical owned-copy counts, used during active runs. */
  ownedCounts?: Map<string, number>;
  /** Active runs may only fit owned bench parts; the catalog is reference-only. */
  readOnly?: boolean;
  label?: string;
  /**
   * Show one category only. The prototype's parts sheet is tabbed by category
   * (docs/prototypes/mobile-builder.html), and it matters on a phone: the full
   * catalogue is 22 rows, which put the radiators about 1900px down a scrolling
   * sheet. Undefined shows everything, which is what the desktop rail wants.
   */
  category?: PartCategory;
}) {
  const byCategory = CATEGORY_ORDER.filter((cat) => !category || cat === category).map((cat) => ({
    cat, parts: Object.values(PARTS).filter(
      (part) => part.category === cat && GAME_CONTENT.enabledPartIds.includes(part.id),
    ),
  })).filter(({ parts }) => parts.length > 0);

  return (
    <div>
      {!category && <div className="eyebrow" style={{ marginBottom: 10 }}>{label}</div>}
      {byCategory.map(({ cat, parts }) => (
        <div className="category" key={cat}>
          {!category && <div className="category-label" style={{ color: 'var(--ink-secondary)' }}>
            <span className="swatch" style={{ background: CATEGORY_COLOR[cat] }} />
            {CATEGORY_LABEL[cat]}
          </div>}
          {parts.map((def) => {
            const locked = visiblePartIds !== undefined && !visiblePartIds.has(def.id);
            const disabled = readOnly || locked;
            return (
              <button
                key={def.id}
                type="button"
                className={`part-row${selectedPartId === def.id ? ' selected' : ''}${disabled ? ' locked' : ''}`}
                disabled={disabled}
                title={locked ? lockedReason
                  : readOnly ? 'Installed parts are on the mech; salvaged spares are managed on the run bench' : undefined}
              onClick={() => onSelect(selectedPartId === def.id ? null : def.id)}
              onMouseEnter={() => onHover(def.id)}
              onMouseLeave={() => onHover(null)}
            >
              <ShapePreview def={def} />
              <div className="part-info">
                <div className="part-name">
                  {def.name}
                  {locked && <span className="part-locked">{lockedReason}</span>}
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
