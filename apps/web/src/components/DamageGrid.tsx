import { useMemo, type CSSProperties } from 'react';
import { buildOccupancyMap, getChassis, getPart, type Build, type BattleEvent } from '@mechbattler/sim';

/** Destroyed reads as a hatch as well as a colour — never colour alone (docs/14 §9). */
const GONE: CSSProperties = {
  background: 'var(--signal-red-dim)',
  backgroundImage: 'repeating-linear-gradient(45deg,rgba(0,0,0,.65) 0 2px,transparent 2px 4px)',
};

/**
 * The console's damage widget, ported from the battle prototype's `.dmg`.
 *
 * Your mech as a silhouette, one square per cell, so damage reads as a shape rather
 * than a number: which side is being stripped, and how close the loss is to the
 * core. docs/14 §12 records why that matters — damage strips structure before the
 * core is exposed, so "how much is left" is a pattern, not one figure.
 *
 * Cells fade with wear, as the prototype's do. MechFrame carries no per-part HP and
 * MechReport.partsFinalHp is end-of-battle only, but `shot` events carry the damage
 * dealt to each part along the penetration path — so the remaining fraction at any
 * tick is the part's starting HP less the damage accumulated up to it. Everything
 * comes from the event stream, which is how the rest of the HUD derives per-tick
 * state; no damage rule is restated here.
 *
 * One gap worth knowing: heat and cook-off destroy parts without a `shot` event, so
 * those show as destroyed the moment they go rather than fading first.
 */
export function DamageGrid({
  build, events, tSec, coreFrac, onOpen,
}: {
  build: Build;
  events: BattleEvent[];
  tSec: number;
  /** 0..1 of global chassis integrity, represented by the central body marker. */
  coreFrac: number;
  onOpen?: () => void;
}) {
  const chassis = getChassis(build.chassisId);

  const { destroyed, damageTaken } = useMemo(() => {
    const gone = new Set<string>();
    const taken = new Map<string, number>();
    for (const e of events) {
      if (e.tSec > tSec) break;
      if (e.type === 'part-destroyed' && e.mech === 0) gone.add(e.instanceId);
      // `mech` on a shot is the shooter, so the opponent's shots are our damage.
      if (e.type === 'shot' && e.mech === 1) {
        for (const d of e.damaged ?? []) {
          if (d.instanceId === '__core__' || d.instanceId === '__chassis__') continue;
          taken.set(d.instanceId, (taken.get(d.instanceId) ?? 0) + d.damage);
        }
      }
    }
    return { destroyed: gone, damageTaken: taken };
  }, [events, tSec]);

  /** Remaining HP as a fraction of pristine, starting from salvage integrity. */
  const hpFrac = (instanceId: string, partId: string, integrity: number) => {
    const pristine = getPart(partId).hp;
    if (pristine <= 0) return 0;
    const remaining = pristine * integrity - (damageTaken.get(instanceId) ?? 0);
    return Math.max(0, Math.min(1, remaining / pristine));
  };

  // The sim owns this mapping; see Plate, which had the same copy.
  const occupancy = useMemo(() => buildOccupancyMap(build.parts).byCell, [build.parts]);

  const cells = [];
  for (let y = 0; y < chassis.height; y += 1) {
    for (let x = 0; x < chassis.width; x += 1) {
      const key = `${x},${y}`;
      if (!chassis.mask[y]?.[x]) {
        cells.push(<i key={key} style={{ background: 'transparent' }} />);
        continue;
      }
      if (x === chassis.coreCell.x && y === chassis.coreCell.y) {
        cells.push(
          <i
            key={key}
            style={{
              background: coreFrac <= 0 ? 'var(--signal-red)' : 'var(--signal-blue)',
              opacity: 0.35 + coreFrac * 0.65,
            }}
          />,
        );
        continue;
      }
      const occ = occupancy.get(key);
      if (!occ) {
        cells.push(<i key={key} style={{ background: 'var(--bg-floor)' }} />);
        continue;
      }
      if (destroyed.has(occ.instanceId)) {
        cells.push(<i key={key} style={GONE} />);
        continue;
      }
      const placed = build.parts.find((p) => p.instanceId === occ.instanceId);
      const frac = hpFrac(occ.instanceId, occ.partId, placed?.integrity ?? 1);
      cells.push(
        <i
          key={key}
          style={{
            background: `var(--cat-${getPart(occ.partId).category})`,
            // Fades as the part wears, so a mech visibly comes apart.
            opacity: 0.3 + frac * 0.7,
          }}
        />,
      );
    }
  }

  const lost = destroyed.size;

  return (
    <button
      type="button"
      className="dmg"
      onClick={onOpen}
      aria-label={`Your mech — ${lost} ${lost === 1 ? 'part' : 'parts'} destroyed, chassis at ${Math.round(coreFrac * 100)}%`}
    >
      <span
        className="dmg-grid"
        style={{ gridTemplateColumns: `repeat(${chassis.width}, 8px)` }}
      >
        {cells}
      </span>
    </button>
  );
}
