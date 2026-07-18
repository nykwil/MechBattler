import { getPart, CORE_INSTANCE_ID, type BattleEvent, type BattleReport, type MechOrder } from '@mechbattler/sim';

export function partName(partId: string): string {
  if (partId === CORE_INSTANCE_ID) return 'Core';
  return getPart(partId).name;
}

export function fmtTime(tSec: number): string {
  const m = Math.floor(tSec / 60);
  const s = tSec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export const REASON_TEXT: Record<BattleReport['reason'], string> = {
  'core-kill': 'core destroyed',
  'mission-kill': 'mission kill — no functional weapons, surrender',
  judges: "judges' decision — most functional mass remaining",
};

function orderText(order: MechOrder): string {
  switch (order.verb) {
    case 'weapons': {
      const n = Object.values(order.enabled).filter(Boolean).length;
      return n === 0 ? 'HOLD FIRE' : `WEAPONS FREE (${n})`;
    }
    case 'move':
      return order.intent === 'direct' ? 'MOVE: TO WAYPOINT' : `MOVE: ${order.intent.toUpperCase()}`;
    case 'throttle':
      return `THROTTLE: ${order.setting.toUpperCase()}`;
    case 'face':
      return order.mode === 'target' ? 'FACE: TRACK TARGET' : 'FACE: HOLD BEARING';
  }
}

export function eventText(e: BattleEvent, names: [string, string]): { text: string; cls: string } {
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
    case 'order':
      return { text: `${names[e.mech]} — ${orderText(e.order)}`, cls: 'order' };
    case 'victory':
      return {
        text: e.winner === 'draw' ? `DRAW — ${REASON_TEXT[e.reason]}` : `${names[e.winner]} WINS — ${REASON_TEXT[e.reason]}`,
        cls: 'victory',
      };
  }
}
