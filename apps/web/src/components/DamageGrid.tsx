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
 * Partial port, deliberately. The prototype fades each cell by that part's
 * remaining HP fraction. MechFrame carries no per-part HP, and MechReport's
 * partsFinalHp is end-of-battle only, so cells here are alive or destroyed —
 * derived from the event stream up to tSec, the same way the rest of the HUD
 * derives per-tick state. Restoring the gradient needs the sim to expose per-tick
 * part HP; it is not something the UI can infer.
 */
export function DamageGrid({
  build, events, tSec, coreFrac, onOpen,
}: {
  build: Build;
  events: BattleEvent[];
  tSec: number;
  /** 0..1 of core HP, which tints the core cell as the prototype does. */
  coreFrac: number;
  onOpen?: () => void;
}) {
  const chassis = getChassis(build.chassisId);

  const destroyed = useMemo(() => {
    const gone = new Set<string>();
    for (const e of events) {
      if (e.tSec > tSec) break;
      if (e.type === 'part-destroyed' && e.mech === 0) gone.add(e.instanceId);
    }
    return gone;
  }, [events, tSec]);

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
      cells.push(
        <i
          key={key}
          style={destroyed.has(occ.instanceId)
            ? GONE
            : { background: `var(--cat-${getPart(occ.partId).category})` }}
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
      aria-label={`Your mech — ${lost} ${lost === 1 ? 'part' : 'parts'} destroyed, core at ${Math.round(coreFrac * 100)}%`}
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
