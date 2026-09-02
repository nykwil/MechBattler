import { PARTS, type PartCategory, type PartDef, type PlacedPart } from '@mechbattler/sim';
import { GAME_CONTENT } from '@mechbattler/game';
import { CATEGORY_COLOR, CATEGORY_LABEL, CATEGORY_ORDER } from '../lib/partVisuals.js';
import { ChipRow, ShapePreview } from './PartVisual.js';
import { ModChips } from './ModChips.js';
import './PartPalette.css';

/** One owned object, as opposed to one catalog entry. */
export interface PaletteInstance {
  id: string;
  partId: string;
  integrity: number;
  modifiers?: string[];
  variant?: PlacedPart['variant'];
  provenance?: { source: 'starter' | 'salvage' | 'scrapyard' | 'legacy'; nodeIndex?: number; opponentName?: string };
}

function metaLine(def: PartDef): string {
  const bits: string[] = [`${def.massKg}kg`, `${def.hp}hp`];
  if (def.weapon) bits.push(`${def.weapon.damage}dmg/${def.weapon.cycleS}s`);
  if (def.perimeterOnly) bits.push('perimeter only');
  return bits.join(' · ');
}

/** Where an owned part came from, for the row's second line. */
function originLine(instance: PaletteInstance): string {
  const p = instance.provenance;
  if (!p) return '';
  if (p.source === 'salvage') {
    return p.opponentName ? `salvaged from ${p.opponentName}` : 'salvaged from a wreck';
  }
  if (p.source === 'scrapyard') return 'bought at a scrapyard';
  if (p.source === 'starter') return 'starting equipment';
  return '';
}

export function PartPalette({
  selectedPartId, onSelect, onHover, priceMult, scrap, visiblePartIds,
  instances, selectedInstanceId, onSelectInstance,
  readOnly, label = 'Salvage bin', category,
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
  /**
   * The run's part list. Present only mid-run, and it switches this component
   * from *types* to *objects*.
   *
   * Outside a run the list is the garage: unlocked part types with effectively
   * infinite copies, so a row is a catalog entry and a count would be
   * meaningless. Inside a run you own instances — this Judge, at 62%, with
   * cold-bore, off node 2's wreck — and the damage and the mods are the whole
   * reason to look at the list, so a row is one object. Collapsing them by
   * partId, as this used to, showed "Judge ×1 bench" and threw away everything
   * the salvage screen had just shown you.
   *
   * Installed parts are deliberately absent: they are on the mech, which is the
   * plate, and listing them here as untappable grey rows read as broken gear.
   */
  instances?: PaletteInstance[];
  /** The instance currently armed for placement, if any. */
  selectedInstanceId?: string | null;
  onSelectInstance?: (id: string) => void;
  /** A finished run may only be read. */
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
  if (instances) {
    return (
      <PartList
        instances={instances}
        category={category}
        label={label}
        readOnly={readOnly}
        selectedInstanceId={selectedInstanceId ?? null}
        onSelectInstance={onSelectInstance}
      />
    );
  }

  const byCategory = CATEGORY_ORDER.filter((cat) => !category || cat === category).map((cat) => ({
    cat, parts: Object.values(PARTS).filter(
      (part) => part.category === cat
        && GAME_CONTENT.enabledPartIds.includes(part.id)
        && (!visiblePartIds || visiblePartIds.has(part.id)),
    ),
  })).filter(({ parts }) => parts.length > 0);

  return (
    <div>
      {!category && <div className="eyebrow" style={{ marginBottom: 10 }}>{label}</div>}
      {byCategory.length === 0 && (
        /* A category can hold nothing you own, and an empty panel reads as a broken
           screen rather than an empty inventory. Say which it is. */
        <p className="part-empty">You have no equipment of this kind yet — wrecks carry more.</p>
      )}
      {byCategory.map(({ cat, parts }) => (
        <div className="category" key={cat}>
          {!category && <div className="category-label" style={{ color: 'var(--ink-secondary)' }}>
            <span className="swatch" style={{ background: CATEGORY_COLOR[cat] }} />
            {CATEGORY_LABEL[cat]}
          </div>}
          {parts.map((def) => (
            <button
              key={def.id}
              type="button"
              className={`part-row${selectedPartId === def.id ? ' selected' : ''}${readOnly ? ' locked' : ''}`}
              disabled={readOnly}
              onClick={() => onSelect(selectedPartId === def.id ? null : def.id)}
              onMouseEnter={() => onHover(def.id)}
              onMouseLeave={() => onHover(null)}
            >
              <ShapePreview def={def} />
              <div className="part-info">
                <div className="part-name">
                  {def.name}
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

/** The mid-run list: owned objects, one row each. */
function PartList({
  instances, category, label, readOnly, selectedInstanceId, onSelectInstance,
}: {
  instances: PaletteInstance[];
  category?: PartCategory;
  label: string;
  readOnly?: boolean;
  selectedInstanceId: string | null;
  onSelectInstance?: (id: string) => void;
}) {
  const shown = instances.filter((instance) => {
    const def = PARTS[instance.partId];
    return def !== undefined && (!category || def.category === category);
  });

  return (
    <div>
      {!category && <div className="eyebrow" style={{ marginBottom: 10 }}>{label}</div>}
      {shown.length === 0 && (
        <p className="part-empty">Nothing of this kind in your parts.</p>
      )}
      {shown.map((instance) => {
        const def = PARTS[instance.partId]!;
        const origin = originLine(instance);
        return (
          <button
            key={instance.id}
            type="button"
            className={`part-row${selectedInstanceId === instance.id ? ' selected' : ''}${readOnly ? ' locked' : ''}`}
            disabled={readOnly}
            onClick={() => onSelectInstance?.(instance.id)}
          >
            <ShapePreview def={def} />
            <div className="part-info">
              <div className="part-name">
                {def.name}
                <span className={`part-price${instance.integrity < 1 ? ' too-rich' : ''}`}>
                  {Math.round(instance.integrity * 100)}%
                </span>
              </div>
              {/* Not interactive: a button inside a button is invalid HTML and the
                  browser may swallow the click (docs/14 §10, and the salvage row
                  that hit it). The explanations render inline instead. */}
              <ModChips
                partId={instance.partId}
                modifiers={instance.modifiers}
                variant={instance.variant}
                interactive={false}
              />
              <div className="part-meta">{[metaLine(def), origin].filter(Boolean).join(' · ')}</div>
            </div>
          </button>
        );
      })}
      <div className="rotate-hint">
        Salvage from a wreck lands here, and so does anything you detach from the mech.
        Tap one to fit it; press <kbd>R</kbd> to rotate before placing.
      </div>
    </div>
  );
}
