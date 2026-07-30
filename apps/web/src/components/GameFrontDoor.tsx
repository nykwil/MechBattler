import { useState } from 'react';
import { CHASSIS, getChassis, getPart } from '@mechbattler/sim';
import { GAME_CONTENT, type PlayerProfile, type SavedMech } from '@mechbattler/game';
import type { RunPhase } from '../state/runState.js';
import './GameFrontDoor.css';

export function TitleScreen({
  run,
  profile,
  onContinue,
  onNewRun,
  onProfile,
  onSandbox,
  onBalance,
}: {
  run: RunPhase;
  profile: PlayerProfile;
  onContinue: () => void;
  onNewRun: () => void;
  onProfile: () => void;
  onSandbox: () => void;
  onBalance: () => void;
}) {
  const resumable = run.phase !== 'none';
  return (
    <main className="front-door">
      <div className="front-glow" />
      <section className="front-card">
        <div className="front-kicker">SALVAGE · REBUILD · SURVIVE</div>
        <h1>MECH<span>BATTLER</span></h1>
        <p className="front-deck">
          One machine. Twelve nodes. Every victory leaves a wreck—and every wreck asks what
          your mech becomes next.
        </p>
        <div className="front-actions">
          {resumable && (
            <button type="button" className="front-primary" onClick={onContinue}>
              Continue run
              <small>
                {run.phase === 'over' ? 'View the memorial'
                  : `${run.data.kitName} · node ${run.data.nodeIndex} · ${run.data.scrap} scrap`}
              </small>
            </button>
          )}
          <button type="button" className={resumable ? 'front-secondary' : 'front-primary'} onClick={onNewRun}>
            New run
            <small>Load a saved mech or build one</small>
          </button>
          <button type="button" className="front-secondary" onClick={onProfile}>
            Profile & unlocks
            <small>{profile.unlockedPartIds.length}/{GAME_CONTENT.enabledPartIds.length} starting parts</small>
          </button>
        </div>
        <div className="front-modes">
          <button type="button" onClick={onSandbox} disabled={run.phase === 'active' || run.phase === 'prep'}>
            Workshop Sandbox
          </button>
          <button type="button" onClick={onBalance}>Balance Lab</button>
        </div>
        {(run.phase === 'active' || run.phase === 'prep') && (
          <p className="front-footnote">Sandbox is locked while a persistent run build is loaded.</p>
        )}
      </section>
    </main>
  );
}

export function NewRunScreen({
  profile,
  onLoadMech,
  onCreateMech,
  onDeleteMech,
  onBack,
}: {
  profile: PlayerProfile;
  onLoadMech: (savedMech: SavedMech) => void;
  onCreateMech: (chassisId: string) => void;
  onDeleteMech: (id: string) => void;
  onBack: () => void;
}) {
  const ownedChassis = Object.values(CHASSIS).filter(
    (chassis) => profile.unlockedChassisIds.includes(chassis.id),
  );
  const [newChassisId, setNewChassisId] = useState(ownedChassis[0]?.id ?? '');
  return (
    <main className="front-door">
      <section className="front-card wide">
        <button type="button" className="front-back" onClick={onBack}>← Title</button>
        <div className="front-kicker">YOUR GARAGE</div>
        <h2>Load a mech</h2>
        <p className="front-deck compact">
          Saved mechs are reusable starting blueprints. Loading one opens it in the workshop
          before the run, so you can change it or launch as-is.
        </p>
        <div className="garage-grid">
          {profile.savedMechs.map((savedMech) => {
            const partNames = savedMech.build.parts
              .filter((part, index, all) =>
                all.findIndex((candidate) => candidate.partId === part.partId) === index)
              .map((part) => getPart(part.partId).name);
            return (
              <article key={savedMech.id} className="garage-card">
                <span className="starter-status">SAVED MECH</span>
                <strong>{savedMech.name}</strong>
                <span>{getChassis(savedMech.build.chassisId).name}</span>
                <small>{partNames.join(' · ') || 'Empty frame'}</small>
                <div className="garage-actions">
                  <button type="button" className="front-primary" onClick={() => onLoadMech(savedMech)}>
                    Load
                  </button>
                  <button
                    type="button"
                    className="garage-delete"
                    aria-label={`Delete ${savedMech.name}`}
                    onClick={() => onDeleteMech(savedMech.id)}
                  >
                    delete
                  </button>
                </div>
              </article>
            );
          })}
          {profile.savedMechs.length === 0 && (
            <div className="garage-empty">No saved mechs yet. Build your first one below.</div>
          )}
        </div>
        <div className="front-divider"><span>BUILD A NEW MECH</span></div>
        <div className="garage-create">
          <label htmlFor="new-mech-chassis">Owned chassis</label>
          <select
            id="new-mech-chassis"
            value={newChassisId}
            onChange={(event) => setNewChassisId(event.target.value)}
          >
            {ownedChassis.map((chassis) => (
              <option key={chassis.id} value={chassis.id}>{chassis.name} · {chassis.type}</option>
            ))}
          </select>
          <button
            type="button"
            className="front-secondary"
            disabled={!newChassisId}
            onClick={() => onCreateMech(newChassisId)}
          >
            Build new mech
          </button>
        </div>
        <p className="front-footnote">
          This garage shows only chassis and starting equipment you have unlocked. Salvage found
          during a run remains run-only.
        </p>
      </section>
    </main>
  );
}

export function ProfileScreen({
  profile,
  onBack,
}: {
  profile: PlayerProfile;
  onBack: () => void;
}) {
  return (
    <main className="front-door">
      <section className="front-card wide">
        <button type="button" className="front-back" onClick={onBack}>← Title</button>
        <div className="front-kicker">PROFILE & UNLOCKS</div>
        <h2>Combat record</h2>
        <div className="profile-summary">
          <span><strong>{profile.unlockedPartIds.length}</strong> / {GAME_CONTENT.enabledPartIds.length} starting parts</span>
          <span><strong>{profile.unlockedChassisIds.length}</strong> / {Object.keys(CHASSIS).length} chassis</span>
          <span><strong>{profile.history.length}</strong> recorded runs</span>
        </div>
        <div className="challenge-grid">
          {GAME_CONTENT.challenges.map((challenge) => {
            const complete = profile.completedChallengeIds.includes(challenge.id);
            return (
              <article key={challenge.id} className={`challenge-card${complete ? ' complete' : ''}`}>
                <span className="starter-status">{complete ? 'COMPLETE' : 'ACTIVE'}</span>
                <strong>{challenge.name}</strong>
                <p>{challenge.description}</p>
                <small>
                  Unlocks: {challenge.unlockPartIds.map((id) => getPart(id).name).join(' · ')}
                </small>
              </article>
            );
          })}
        </div>
        <div className="front-divider"><span>CHASSIS DISCOVERY</span></div>
        <div className="frame-grid">
          {Object.values(CHASSIS).map((chassis) => (
            <div key={chassis.id} className={profile.unlockedChassisIds.includes(chassis.id) ? '' : 'locked'}>
              <strong>{profile.unlockedChassisIds.includes(chassis.id) ? '✓' : '🔒'} {chassis.name}</strong>
              <span>{chassis.type}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
