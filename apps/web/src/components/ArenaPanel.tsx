import { useState } from 'react';
import type { Build } from '@mechbattler/sim';
import { OPPONENTS, type OpponentDef } from '../lib/opponents.js';
import { hasReactor, hasWeapon } from '../lib/launchGate.js';
import './ArenaPanel.css';

/** Watch = run headless, open the replay; Command = step the battle live (docs/08). */
export type FightMode = 'watch' | 'command';

export function ArenaPanel({
  build, onFight,
}: {
  build: Build;
  onFight: (opponent: OpponentDef, mode: FightMode) => void;
}) {
  const [opponentId, setOpponentId] = useState(OPPONENTS[0]!.id);
  const opponent = OPPONENTS.find((o) => o.id === opponentId)!;
  const weaponsMounted = hasWeapon(build);
  const reactorMounted = hasReactor(build);

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Arena — pick a fight</div>

      <div className="arena-opponents">
        {OPPONENTS.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`arena-card${o.id === opponentId ? ' active' : ''}`}
            onClick={() => setOpponentId(o.id)}
          >
            <div className="arena-card-head">
              <span className="arena-card-name">{o.name}</span>
              <span className="arena-threat">{'▲'.repeat(o.threat)}</span>
            </div>
            <div className="arena-card-blurb">{o.blurb}</div>
            <div className="arena-card-intel">confirmed: {o.confirmed.join(' · ')}</div>
          </button>
        ))}
      </div>

      {(!weaponsMounted || !reactorMounted) && (
        <div className="arena-warning">
          {!reactorMounted
            ? 'No reactor mounted — nothing on this mech will power up.'
            : 'No weapons mounted — you will surrender by mission-kill in 3 seconds.'}
        </div>
      )}

      <div className="fight-row">
        <button type="button" className="fight-btn" onClick={() => onFight(opponent, 'command')} title="Step the battle live on screen">
          Fight · Live
        </button>
        <button type="button" className="fight-btn watch" onClick={() => onFight(opponent, 'watch')} title="Resolve instantly, then replay">
          Watch
        </button>
      </div>
    </div>
  );
}
