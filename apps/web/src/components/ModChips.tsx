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
export function ModChips({ modifiers, variant }: {
  modifiers?: string[];
  variant?: PlacedPart['variant'];
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
