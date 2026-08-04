import { useState } from 'react';
import type { BattleEvent, BattleReport } from '@mechbattler/sim';
import type { OpponentDef } from '../lib/opponents.js';
import { eventText, fmtTime, partName, REASON_TEXT } from '../lib/battleText.js';
import { BattlePlayback } from './BattlePlayback.js';
import type { Build } from '@mechbattler/sim';
import './BattleReportScreen.css';

interface DamageRow {
  instanceId: string;
  partId: string;
  damage: number;
  destroyed: boolean;
}

/** Damage taken by each part of `mech`, aggregated from the enemy's hit events. */
function damageTakenByPart(report: BattleReport, mech: 0 | 1): DamageRow[] {
  const byInstance = new Map<string, DamageRow>();
  for (const e of report.events) {
    if (e.type !== 'shot' || e.mech !== 1 - mech || !e.damaged) continue;
    for (const d of e.damaged) {
      const row = byInstance.get(d.instanceId) ?? { instanceId: d.instanceId, partId: d.partId, damage: 0, destroyed: false };
      row.damage += d.damage;
      byInstance.set(d.instanceId, row);
    }
  }
  for (const lost of report.mechs[mech].partsLost) {
    const row = byInstance.get(lost.instanceId) ?? { instanceId: lost.instanceId, partId: lost.partId, damage: 0, destroyed: false };
    row.destroyed = true;
    byInstance.set(lost.instanceId, row);
  }
  return [...byInstance.values()].sort((a, b) => b.damage - a.damage);
}

function timelineRows(report: BattleReport): BattleEvent[] {
  // Orders live in the replay ticker; the post-battle timeline keeps consequences.
  return report.events.filter(
    (e) => e.type !== 'order' && (e.type !== 'shot' || (e.hit && e.totalDamageDealt >= 15)),
  );
}

export function BattleReportScreen({
  report, opponent, onRematch, onRematchSameSeed, onClose, yourBuild, salvageAwaits,
}: {
  report: BattleReport;
  opponent: OpponentDef;
  onRematch: () => void;
  onRematchSameSeed: () => void;
  onClose: () => void;
  /**
   * True when this was a run fight that was won, so a wreck is waiting to be
   * picked over behind this screen. Without it the only way forward read "Back
   * to workshop", which does not sound like collecting a reward — players won a
   * fight, saw Rematch and Back to workshop, and reported having no way to
   * proceed. The salvage was there; nothing said so.
   */
  salvageAwaits?: boolean;
  /** The build that fought, for the console's damage widget. */
  yourBuild?: Build;
}) {
  const names: [string, string] = ['YOU', opponent.name.toUpperCase()];
  const won = report.winner === 0;
  const banner = report.winner === 'draw' ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT';
  const yourDamage = damageTakenByPart(report, 0);
  const theirDamage = damageTakenByPart(report, 1);
  const hasReplay = report.frames.length > 0;
  const [view, setView] = useState<'replay' | 'report'>(hasReplay ? 'replay' : 'report');

  return (
    <div className="battle-app report-overlay" role="dialog" aria-modal="true">
      <div className="report-panel">
        {/* The scrolling half. Keeping the actions outside it means the footer is a
            sibling that reserves its own space, rather than a sticky bar laid over
            whatever content happens to be at the panel's bottom edge -- which put
            it across the playback scrubber. */}
        <div className="report-scroll">
        <div className={`report-banner ${report.winner === 'draw' ? 'draw' : won ? 'won' : 'lost'}`}>
          <div className="report-banner-title">{banner}</div>
          <div className="report-banner-sub">
            {REASON_TEXT[report.reason]} · {fmtTime(report.durationS)} · vs {opponent.name} · seed {report.seed}
          </div>
        </div>

        {hasReplay && (
          <div className="report-tabs">
            {(['replay', 'report'] as const).map((v) => (
              <button
                key={v} type="button"
                className={`report-tab${view === v ? ' active' : ''}`}
                onClick={() => setView(v)}
              >
                {v === 'replay' ? 'Replay' : 'Report'}
              </button>
            ))}
          </div>
        )}

        {view === 'replay' && hasReplay && <BattlePlayback report={report} names={names} yourBuild={yourBuild} />}

        {view === 'report' && (<>
        <div className="report-columns">
          {([0, 1] as const).map((i) => {
            const m = report.mechs[i];
            const hitPct = m.shotsFired > 0 ? Math.round((100 * m.shotsHit) / m.shotsFired) : 0;
            return (
              <div key={i} className="report-mech">
                <div className="report-mech-name">{names[i]}</div>
                <div className="report-stat-row"><span>Shots</span><span>{m.shotsHit}/{m.shotsFired} ({hitPct}%)</span></div>
                <div className="report-stat-row"><span>Damage dealt</span><span>{m.damageDealt.toFixed(0)}</span></div>
                <div className="report-stat-row"><span>Parts lost</span><span>{m.partsLost.length}</span></div>
                <div className="report-stat-row">
                  <span>Chassis</span>
                  <span>{Math.round(m.chassisIntegrityFrac * 100)}%</span>
                </div>
                <div className="report-stat-row"><span>Functional mass</span><span>{Math.round(m.functionalMassFrac * 100)}%</span></div>
              </div>
            );
          })}
        </div>

        <div className="report-columns">
          {([['Damage you took', yourDamage], ['Damage you dealt', theirDamage]] as const).map(([title, rows]) => (
            <div key={title} className="report-damage">
              <div className="eyebrow" style={{ marginBottom: 6 }}>{title}</div>
              {rows.length === 0 && <div className="report-damage-empty">none</div>}
              {rows.map((r) => (
                <div key={r.instanceId} className={`report-damage-row${r.destroyed ? ' destroyed' : ''}`}>
                  <span>{partName(r.partId)}</span>
                  <span>{r.damage.toFixed(0)}{r.destroyed ? ' ✕' : ''}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="eyebrow" style={{ margin: '14px 0 6px' }}>Timeline</div>
        <div className="report-timeline">
          {timelineRows(report).map((e, idx) => {
            const { text, cls } = eventText(e, names);
            return (
              <div key={idx} className={`report-event ${cls}`}>
                <span className="report-event-time">{fmtTime(e.tSec)}</span>
                <span>{text}</span>
              </div>
            );
          })}
        </div>
        </>)}

        </div>

        <div className="report-actions">
          <button type="button" className="report-btn rematch" onClick={onRematch}>Rematch</button>
          <button
            type="button"
            className="report-btn"
            onClick={onRematchSameSeed}
            title="Replay the exact same battlefield and dice against your current build — a controlled experiment after a refit"
          >
            Rematch · same seed
          </button>
          <button
            type="button"
            className={`report-btn${salvageAwaits ? ' btn-primary' : ''}`}
            onClick={onClose}
          >
            {salvageAwaits ? 'Claim salvage ›' : 'Back to workshop'}
          </button>
        </div>
      </div>
    </div>
  );
}
