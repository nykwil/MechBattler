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
  fittablePartIds, readOnly, label = 'Salvage bin', category,
}: {
  selectedPartId: string | null;
  onSelect: (id: string | null) => void;
  /** Inventory hover preview (docs/01 §9): browsing is reading trade-offs. */
  onHover: (id: string | null) => void;
  /** During a run, fresh parts cost tier × this scrap (docs/04 §1). */
  priceMult?: number;
  scrap?: number;
  /**
   * Equipment available in this context. Parts outside the set are not shown: the
   * inventory lists what you have, not what exists.
   */
  visiblePartIds?: Set<string>;
  /** Physical owned-copy counts, used during active runs. */
  ownedCounts?: Map<string, number>;
  /**
   * Part ids with a benched spare that can be armed from this list. During an
   * active run, installed-only rows stay locked; salvage/spares stay tappable.
   */
  fittablePartIds?: Set<string>;
  /** Active memorial / empty-bench runs may only inspect owned equipment. */
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
      (part) => part.category === cat
        && GAME_CONTENT.enabledPartIds.includes(part.id)
        && (!visiblePartIds || visiblePartIds.has(part.id)),
    ),
  })).filter(({ parts }) => parts.length > 0);

  const runInventory = ownedCounts !== undefined;

  return (
    <div>
      {!category && <div className="eyebrow" style={{ marginBottom: 10 }}>{label}</div>}
      {byCategory.length === 0 && (
        /* A category can hold nothing you own, and an empty panel reads as a broken
           screen rather than an empty inventory. Say which it is. */
        <p className="part-empty">
          {runInventory
            ? 'Nothing of this kind on the mech or the bench.'
            : 'You have no equipment of this kind yet — wrecks carry more.'}
        </p>
      )}
      {byCategory.map(({ cat, parts }) => (
        <div className="category" key={cat}>
          {!category && <div className="category-label" style={{ color: 'var(--ink-secondary)' }}>
            <span className="swatch" style={{ background: CATEGORY_COLOR[cat] }} />
            {CATEGORY_LABEL[cat]}
          </div>}
          {parts.map((def) => {
            const fittable = Boolean(fittablePartIds?.has(def.id));
            const disabled = readOnly || (runInventory && fittablePartIds !== undefined && !fittable);
            return (
              <button
                key={def.id}
                type="button"
                className={`part-row${selectedPartId === def.id ? ' selected' : ''}${disabled ? ' locked' : ''}`}
                disabled={disabled}
                title={disabled
                  ? (runInventory
                    ? 'Installed on the mech — unplace it, or salvage a spare, to fit another'
                    : undefined)
                  : (fittable ? 'Fit a benched spare onto the mech' : undefined)}
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
                    {fittable && <span className="part-price">bench</span>}
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
        {runInventory
          ? (fittablePartIds && fittablePartIds.size > 0
            ? 'Tap a spare marked bench to fit it. Salvage from wrecks is added here.'
            : 'Your installed equipment is on the mech. Salvage from wrecks will appear here as spares.')
          : <>Select a part, then click the grid to place it.<br />Press <kbd>R</kbd> to rotate before placing.</>}
      </div>
    </div>
  );
}
