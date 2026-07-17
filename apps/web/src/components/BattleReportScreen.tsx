import { getPart, CORE_INSTANCE_ID, type BattleEvent, type BattleReport } from '@mechbattler/sim';
import type { OpponentDef } from '../lib/opponents.js';
import './BattleReportScreen.css';

function partName(partId: string): string {
  if (partId === CORE_INSTANCE_ID) return 'Core';
  return getPart(partId).name;
}

function fmtTime(tSec: number): string {
  const m = Math.floor(tSec / 60);
  const s = tSec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

const REASON_TEXT: Record<BattleReport['reason'], string> = {
  'core-kill': 'core destroyed',
  'mission-kill': 'mission kill — no functional weapons, surrender',
  judges: "judges' decision — most functional mass remaining",
};

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
  return report.events.filter(
    (e) => e.type !== 'shot' || (e.hit && e.totalDamageDealt >= 15),
  );
}

function eventText(e: BattleEvent, names: [string, string]): { text: string; cls: string } {
  switch (e.type) {
    case 'shot':
      return {
        text: `${names[e.mech]} — ${partName(e.partId)} lands a heavy hit (${e.totalDamageDealt.toFixed(0)} dmg)`,
        cls: e.mech === 0 ? 'good' : 'bad',
      };
    case 'part-destroyed':
      return { text: `${names[e.mech]} — ${partName(e.partId)} DESTROYED (${e.cause})`, cls: e.mech === 0 ? 'bad' : 'good' };
    case 'shed':
      return { text: `${names[e.mech]} — power shed: ${e.instanceId === CORE_INSTANCE_ID ? 'locomotion' : e.instanceId}`, cls: 'warn' };
    case 'shutdown':
      return { text: `${names[e.mech]} — thermal shutdown: ${e.instanceId}`, cls: 'warn' };
    case 'cookoff':
      return { text: `${names[e.mech]} — AMMO COOK-OFF`, cls: 'bad' };
    case 'surrender-countdown':
      return { text: `${names[e.mech]} — no functional weapons, surrender countdown`, cls: 'warn' };
    case 'victory':
      return {
        text: e.winner === 'draw' ? `DRAW — ${REASON_TEXT[e.reason]}` : `${names[e.winner]} WINS — ${REASON_TEXT[e.reason]}`,
        cls: 'victory',
      };
  }
}

export function BattleReportScreen({
  report, opponent, onRematch, onClose,
}: {
  report: BattleReport;
  opponent: OpponentDef;
  onRematch: () => void;
  onClose: () => void;
}) {
  const names: [string, string] = ['YOU', opponent.name.toUpperCase()];
  const won = report.winner === 0;
  const banner = report.winner === 'draw' ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT';
  const yourDamage = damageTakenByPart(report, 0);
  const theirDamage = damageTakenByPart(report, 1);

  return (
    <div className="report-overlay" role="dialog" aria-modal="true">
      <div className="report-panel">
        <div className={`report-banner ${report.winner === 'draw' ? 'draw' : won ? 'won' : 'lost'}`}>
          <div className="report-banner-title">{banner}</div>
          <div className="report-banner-sub">
            {REASON_TEXT[report.reason]} · {fmtTime(report.durationS)} · vs {opponent.name} · seed {report.seed}
          </div>
        </div>

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
                <div className="report-stat-row"><span>Core HP</span><span>{Math.max(0, m.coreHpRemaining).toFixed(0)}</span></div>
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

        <div className="report-actions">
          <button type="button" className="report-btn rematch" onClick={onRematch}>Rematch</button>
          <button type="button" className="report-btn" onClick={onClose}>Back to workshop</button>
        </div>
      </div>
    </div>
  );
}
