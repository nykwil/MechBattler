import { useState } from 'react';
import { MODIFIERS, type PlacedPart } from '@mechbattler/sim';
import './ModChips.css';

/**
 * The one-liner surface for salvage randomness (docs/04 §4): modifier chips and
 * green/red variant deltas vs stock. Used everywhere a part appears — bench rows,
 * loot rows, the inspector.
 *
 * docs/14 §10: the explanations were `title=` only, which no touch device can
 * reach. They are tappable disclosures now, and the chip is a real button.
 */
export function ModChips({ modifiers, variant, interactive = true }: {
  modifiers?: string[];
  variant?: PlacedPart['variant'];
  /**
   * False where the chips sit inside a button — a salvage candidate row, say.
   * A button inside a button is invalid HTML and browsers may swallow the click,
   * so there the chips are plain spans and their explanations show inline
   * instead. The information stays reachable without a tap target, which is the
   * point of §10 dropping title= in the first place.
   */
  interactive?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const mods = (modifiers ?? []).map((id) => MODIFIERS[id]).filter((m) => m !== undefined);
  const deltas = Object.entries(variant ?? {}).filter(([, mult]) => mult !== 1);
  if (mods.length === 0 && deltas.length === 0) return null;
  return (
    <span className="mod-chips">
      {mods.map((m) => {
        const detail = [m.blurb, m.tradeoff].filter(Boolean).join(' Cost: ');
        const open = openId === m.id;
        if (!interactive) {
          return (
            <span key={m.id} className="mod-chip-wrap">
              <span className={`mod-chip ${m.kind}`}>{m.name}</span>
              <span className="mod-chip-detail">{detail}</span>
            </span>
          );
        }
        return (
          <span key={m.id} className="mod-chip-wrap">
            <button
              type="button"
              className={`mod-chip ${m.kind}`}
              aria-expanded={open}
              onClick={(e) => { e.stopPropagation(); setOpenId(open ? null : m.id); }}
            >
              {m.name}
            </button>
            {open && <span className="mod-chip-detail">{detail}</span>}
          </span>
        );
      })}
      {deltas.map(([stat, mult]) => {
        // Lower is better for cycle time and dispersion.
        const better = stat === 'cycleS' || stat === 'dispersionMrad' ? mult < 1 : mult > 1;
        const pct = Math.round((mult - 1) * 100);
        const open = openId === stat;
        if (!interactive) {
          return (
            <span key={stat} className="mod-chip-wrap">
              <span className={`variant-delta ${better ? 'good' : 'bad'}`}>
                {stat} {pct > 0 ? '+' : ''}{pct}%
              </span>
            </span>
          );
        }
        return (
          <span key={stat} className="mod-chip-wrap">
            <button
              type="button"
              className={`variant-delta ${better ? 'good' : 'bad'}`}
              aria-expanded={open}
              onClick={(e) => { e.stopPropagation(); setOpenId(open ? null : stat); }}
            >
              {stat} {pct > 0 ? '+' : ''}{pct}%
            </button>
            {open && <span className="mod-chip-detail">{`${stat} ×${mult} vs stock`}</span>}
          </span>
        );
      })}
    </span>
  );
}
