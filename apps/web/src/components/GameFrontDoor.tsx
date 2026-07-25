import { CHASSIS, TEMPLATES, getChassis, getPart } from '@mechbattler/sim';
import { GAME_CONTENT, type PlayerProfile } from '@mechbattler/game';
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
      <section className="front-card title-card">
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
            <small>Choose a starter or outfit an unlocked frame</small>
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
  onStartKit,
  onStartCustom,
  onBack,
}: {
  profile: PlayerProfile;
  onStartKit: (templateId: string, name: string) => void;
  onStartCustom: (chassisId: string) => void;
  onBack: () => void;
}) {
  return (
    <main className="front-door">
      <section className="front-card wide">
        <button type="button" className="front-back" onClick={onBack}>← Title</button>
        <div className="front-kicker">NEW RUN</div>
        <h2>Choose what survives the first fight</h2>
        <p className="front-deck compact">
          Starting access is permanent progression. Once the run begins, any enemy equipment
          can be salvaged and used—whether its blueprint is unlocked or not.
        </p>
        <div className="starter-grid">
          {GAME_CONTENT.starterKits.map((kit) => {
            const template = TEMPLATES.find((candidate) => candidate.id === kit.templateId);
            const missingParts = template?.build.parts
              .map((part) => part.partId)
              .filter((id, index, all) => all.indexOf(id) === index && !profile.unlockedPartIds.includes(id)) ?? [];
            const chassisId = template?.build.chassisId ?? '';
            const chassisUnlocked = profile.unlockedChassisIds.includes(chassisId);
            const unlocked = Boolean(template) && chassisUnlocked && missingParts.length === 0;
            return (
              <button
                key={kit.templateId}
                type="button"
                className={`starter-card${unlocked ? '' : ' locked'}`}
                disabled={!unlocked}
                onClick={() => onStartKit(kit.templateId, kit.name)}
              >
                <span className="starter-status">{unlocked ? 'READY' : 'LOCKED'}</span>
                <strong>{kit.name}</strong>
                <span>{kit.blurb}</span>
                {!unlocked && (
                  <small>
                    {!chassisUnlocked && chassisId ? `Defeat a ${getChassis(chassisId).name}. ` : ''}
                    {missingParts.length > 0 ? `Needs ${missingParts.map((id) => getPart(id).name).join(', ')}.` : ''}
                  </small>
                )}
              </button>
            );
          })}
        </div>
        <div className="front-divider"><span>OR OUTFIT A FRAME</span></div>
        <div className="frame-grid">
          {Object.values(CHASSIS).map((chassis) => {
            const unlocked = profile.unlockedChassisIds.includes(chassis.id);
            return (
              <button
                key={chassis.id}
                type="button"
                className={unlocked ? '' : 'locked'}
                disabled={!unlocked}
                onClick={() => onStartCustom(chassis.id)}
              >
                <strong>{unlocked ? chassis.name : `🔒 ${chassis.name}`}</strong>
                <span>{chassis.type}</span>
                <small>{unlocked ? 'Build from unlocked starting parts' : 'Defeat this chassis during a run'}</small>
              </button>
            );
          })}
        </div>
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
