import { useEffect, useMemo, useState } from 'react';
import { buildCapacitorMaxKj, type Battle, type BattleReport } from '@mechbattler/sim';
import type { OpponentDef } from '../lib/opponents.js';
import { fmtTime } from '../lib/battleText.js';
import { useBattle } from '../state/useBattle.js';
import { BattleCaption, BattleScene, BattleTicker, type BattleView } from './BattleHud.js';
import './BattleReportScreen.css';
import './BattlePlayback.css';
import './BattleLiveScreen.css';

/**
 * Command mode, milestone M1 (docs/08): the battle steps live at 20 ticks/s
 * with pause/1×/2×, rendered through the same scene as the replay. No player
 * input yet — the autopilot drives both mechs; this proves the loop. When the
 * battle is decided the finished report opens in the normal report screen.
 */

const LIVE_SPEEDS = [1, 2] as const;
/** Hold the decided battle on screen briefly so the killing blow reads. */
const END_HOLD_S = 1.6;

export function BattleLiveScreen({
  battle, opponent, onFinished, onAbort,
}: {
  battle: Battle;
  opponent: OpponentDef;
  onFinished: (report: BattleReport) => void;
  onAbort: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<(typeof LIVE_SPEEDS)[number]>(1);
  const { tSec, finished } = useBattle(battle, { paused, speed });
  const names: [string, string] = ['YOU', opponent.name.toUpperCase()];

  const view: BattleView = useMemo(() => ({
    frames: battle.frames,
    events: battle.events,
    arena: battle.arena,
    terrain: battle.terrain,
    mechs: [
      { chassisId: battle.combatants[0].build.chassisId, capacitorMaxKj: buildCapacitorMaxKj(battle.combatants[0].build) },
      { chassisId: battle.combatants[1].build.chassisId, capacitorMaxKj: buildCapacitorMaxKj(battle.combatants[1].build) },
    ],
  }), [battle]);

  useEffect(() => {
    if (!finished) return;
    const id = window.setTimeout(() => onFinished(battle.report()), END_HOLD_S * 1000);
    return () => window.clearTimeout(id);
  }, [finished, battle, onFinished]);

  return (
    <div className="report-overlay" role="dialog" aria-modal="true">
      <div className="report-panel">
        <div className="live-topbar">
          <span className="live-dot" />
          <span className="live-title">LIVE · vs {opponent.name} · seed {battle.seed}</span>
          <span className="live-spacer" />
          <button type="button" className="playback-btn" onClick={() => setPaused(!paused)} disabled={finished}>
            {paused ? '▶' : '❚❚'}
          </button>
          <button
            type="button" className="playback-btn"
            onClick={() => setSpeed(LIVE_SPEEDS[(LIVE_SPEEDS.indexOf(speed) + 1) % LIVE_SPEEDS.length]!)}
          >
            {speed}×
          </button>
          <span className="playback-clock">{fmtTime(tSec)}</span>
          <button type="button" className="playback-btn" onClick={onAbort} title="Abandon the battle (no report)">✕</button>
        </div>

        <div className="playback">
          <BattleScene view={view} tSec={tSec} names={names} />
          <BattleTicker view={view} tSec={tSec} names={names} />
          <BattleCaption view={view} />
        </div>

        {finished && <div className="live-endbanner">BATTLE DECIDED — preparing report…</div>}
      </div>
    </div>
  );
}
