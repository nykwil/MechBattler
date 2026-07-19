import { useState } from 'react';
import type { Build } from '@mechbattler/sim';
import { nodeOpponents, RUN_LENGTH, STARTER_KITS, type RunPhase } from '../state/runState.js';
import type { OpponentDef } from '../lib/opponents.js';
import type { FightMode } from './ArenaPanel.js';
import './ArenaPanel.css';
import './RunPanel.css';

/**
 * The run shell (docs/10 M1): start-kit picker → node screen with scouted
 * opponent cards → memorial on death or ladder victory. Reuses the arena
 * card styling so intel reads the same everywhere.
 */
export function RunPanel({
  run, build, onStartKit, onFight, onAbandon, onNewRun,
}: {
  run: RunPhase;
  build: Build;
  onStartKit: (templateId: string, kitName: string) => void;
  onFight: (opponent: OpponentDef, mode: FightMode) => void;
  onAbandon: () => void;
  onNewRun: () => void;
}) {
  const [pickedId, setPickedId] = useState<string | null>(null);

  if (run.phase === 'none') {
    return (
      <div>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Start a run — pick your starter kit</div>
        <div className="arena-opponents">
          {STARTER_KITS.map((k) => (
            <button key={k.templateId} type="button" className="arena-card" onClick={() => onStartKit(k.templateId, k.name)}>
              <div className="arena-card-head">
                <span className="arena-card-name">{k.name}</span>
              </div>
              <div className="arena-card-blurb">{k.blurb}</div>
            </button>
          ))}
        </div>
        <div className="run-note">
          One mech, {RUN_LENGTH} fights, permadeath on a core kill. The kit is a starting
          point — everything on it can be rebuilt.
        </div>
      </div>
    );
  }

  if (run.phase === 'over') {
    return (
      <div>
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          {run.victorious ? 'Run complete' : 'Run over'}
        </div>
        <div className={`run-memorial${run.victorious ? ' victorious' : ''}`}>
          <div className="run-memorial-title">{run.victorious ? '☼ LADDER CLEARED' : '✕ CORE DESTROYED'}</div>
          <div className="run-memorial-line">{run.data.kitName} · {run.data.fightsWon} fight{run.data.fightsWon === 1 ? '' : 's'} won</div>
          <div className="run-memorial-line">{run.cause}</div>
        </div>
        <button type="button" className="fight-btn" style={{ width: '100%' }} onClick={onNewRun}>
          New run
        </button>
      </div>
    );
  }

  const opponents = nodeOpponents(run.data.seed, run.data.nodeIndex);
  const picked = opponents.find((o) => o.id === pickedId) ?? opponents[0]!;
  const hasWeapons = build.parts.some((p) => p.partId.startsWith('W-'));
  const hasReactor = build.parts.some((p) => p.partId.startsWith('R-'));

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 6 }}>Run — node {run.data.nodeIndex} of {RUN_LENGTH}</div>
      <div className="run-status">
        <span>{run.data.kitName}</span>
        <span className="run-scrap">{run.data.scrap} scrap</span>
        <span>{run.data.fightsWon}W</span>
        <button type="button" className="run-abandon" onClick={onAbandon} title="End this run (no memorial)">abandon</button>
      </div>

      <div className="arena-opponents">
        {opponents.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`arena-card${o.id === picked.id ? ' active' : ''}`}
            onClick={() => setPickedId(o.id)}
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

      {(!hasWeapons || !hasReactor) && (
        <div className="arena-warning">
          {!hasReactor
            ? 'No reactor mounted — nothing on this mech will power up.'
            : 'No weapons mounted — you will surrender by mission-kill in 3 seconds.'}
        </div>
      )}

      <div className="fight-row">
        <button type="button" className="fight-btn" onClick={() => onFight(picked, 'command')} title="Step the battle live on screen">
          Fight · Live
        </button>
        <button type="button" className="fight-btn watch" onClick={() => onFight(picked, 'watch')} title="Resolve instantly, then replay">
          Watch
        </button>
      </div>
    </div>
  );
}
