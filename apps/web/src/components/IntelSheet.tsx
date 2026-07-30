import { getChassis, getPart, type Build } from '@mechbattler/sim';
import { Sheet } from './Sheet.js';
import type { OpponentDef } from '../lib/opponents.js';

/**
 * Next match, ported from the prototype's intel sheet. It exists as its own
 * surface because the loop is *read the opponent, move a radiator, read it again*
 * — the strip in the action bar names who is next, and this is what it opens.
 *
 * The blocker line is the prototype's too: a build with no reactor or no weapon
 * cannot fight, and saying so here is more use than letting the player discover it
 * three seconds into a battle.
 */
export function IntelSheet({
  open, onClose, build, opponents, selectedId, onSelect, onFight,
}: {
  open: boolean;
  onClose: () => void;
  build: Build;
  /**
   * Who you can actually fight next. During a run that is the current ladder
   * node's choices, not the free-play roster — showing the latter named an
   * opponent the run would never present.
   */
  opponents: OpponentDef[];
  selectedId: string | null;
  onSelect: (opponent: OpponentDef) => void;
  onFight: (opponent: OpponentDef) => void;
}) {
  // Derived from the build itself, never from a copied constant.
  const hasReactor = build.parts.some((p) => getPart(p.partId).reactor);
  const hasWeapon = build.parts.some((p) => getPart(p.partId).weapon);
  const blocker = !hasReactor
    ? 'No reactor mounted — nothing on this mech will power up.'
    : !hasWeapon
      ? 'No weapons mounted — you will lose by mission-kill in three seconds.'
      : null;

  return (
    <Sheet open={open} onClose={onClose} label="Next match" initialSnap="full">
      <div className="sheet-head">
        <span className="sheet-title">Next match</span>
        <span className="part-sub">
          {opponents.length} {opponents.length === 1 ? 'opponent' : 'opponents'}
        </span>
      </div>
      <div className="sheet-body">
        {blocker && <p className="fault">{blocker}</p>}

        {opponents.map((o) => {
          const chassis = getChassis(o.build.chassisId);
          return (
            <button
              key={o.id}
              type="button"
              className="foe"
              aria-pressed={o.id === selectedId}
              onClick={() => onSelect(o)}
            >
              <span className="foe-head">
                <span className="foe-name">
                  {o.name}
                  {o.elite && <span className="elite">Elite</span>}
                </span>
                <span className="threat" aria-label={`Threat ${o.threat} of 3`}>
                  <span aria-hidden="true">{'▲'.repeat(o.threat)}</span>
                  <span className="threat-off" aria-hidden="true">{'▲'.repeat(3 - o.threat)}</span>
                </span>
              </span>
              <span className="foe-chassis">
                {o.chassisLabel ?? `${chassis.name} · ${chassis.type}`}
                {o.spawnDistanceM ? ` · engages at ${o.spawnDistanceM} m` : ''}
              </span>
              <span className="foe-blurb">{o.blurb}</span>
              <span className="foe-intel">Confirmed · {o.confirmed.join(' · ')}</span>
              {o.carries && <span className="foe-carries">Carries {o.carries}</span>}
            </button>
          );
        })}

        {selectedId && !blocker && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              const chosen = opponents.find((o) => o.id === selectedId);
              if (chosen) onFight(chosen);
            }}
          >
            Fight
          </button>
        )}
      </div>
    </Sheet>
  );
}
