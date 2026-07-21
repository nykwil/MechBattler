import { MODIFIERS, type PlacedPart } from '@mechbattler/sim';
import './ModChips.css';

/**
 * The one-liner surface for salvage randomness (docs/04 §4): modifier chips
 * (hover = the blurb) and green/red variant deltas vs stock. Used everywhere
 * a part appears — bench rows, loot rows, the inspector.
 */
export function ModChips({ modifiers, variant }: {
  modifiers?: string[];
  variant?: PlacedPart['variant'];
}) {
  const mods = (modifiers ?? []).map((id) => MODIFIERS[id]).filter((m) => m !== undefined);
  const deltas = Object.entries(variant ?? {}).filter(([, mult]) => mult !== 1);
  if (mods.length === 0 && deltas.length === 0) return null;
  return (
    <span className="mod-chips">
      {mods.map((m) => (
        <span key={m.id} className={`mod-chip ${m.kind}`} title={[m.blurb, m.tradeoff].filter(Boolean).join(' Cost: ')}>
          {m.name}
        </span>
      ))}
      {deltas.map(([stat, mult]) => {
        // Lower is better for cycle time and dispersion.
        const better = stat === 'cycleS' || stat === 'dispersionMrad' ? mult < 1 : mult > 1;
        const pct = Math.round((mult - 1) * 100);
        return (
          <span key={stat} className={`variant-delta ${better ? 'good' : 'bad'}`} title={`${stat} ×${mult} vs stock`}>
            {stat} {pct > 0 ? '+' : ''}{pct}%
          </span>
        );
      })}
    </span>
  );
}
