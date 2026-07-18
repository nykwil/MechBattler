import { useMemo, useState } from 'react';
import {
  getChassis, getPart, CELL_SIZE_M, CORE_HP, TICK_S,
  type BattleEvent, type BattleFrame, type MechFrame, type WeaponFrame, type PartDef, type TerrainGrid,
} from '@mechbattler/sim';
import { eventText, fmtTime } from '../lib/battleText.js';
import './BattlePlayback.css';

/**
 * The shared battle scene — enemy strip, arena, cockpit HUD, ticker — rendered
 * from playback frames at a given time. `BattlePlayback` (scrub a finished
 * report) and `BattleLiveScreen` (follow a running battle) are thin shells over
 * this; everything here reads recorded frames only (rule R6), so the two modes
 * cannot drift apart visually.
 */

/** The frame/event data the scene needs; a `BattleReport` satisfies it, and a
 * live view is assembled from a running `Battle`'s public fields. */
export interface BattleView {
  frames: BattleFrame[];
  events: BattleEvent[];
  arena: { lengthM: number; widthM: number };
  terrain: TerrainGrid;
  mechs: readonly [{ chassisId: string; capacitorMaxKj: number }, { chassisId: string; capacitorMaxKj: number }];
}

/** True footprints are ~3 m in a 240 m arena; magnify them to stay readable. */
const MECH_MAG = 5;
const TRACER_LINGER_S = 0.22;
const FLASH_LINGER_S = 0.4;
const MUZZLE_FLASH_S = 0.18;
export const MECH_COLORS = ['var(--signal-blue)', 'var(--signal-red)'] as const;
/** Heat gauge span: ambient to the damage threshold (docs/01 §4 ladder). */
const HEAT_MIN_C = 25;
const HEAT_MAX_C = 150;

export function frameAt(view: BattleView, tSec: number): BattleFrame | undefined {
  const idx = Math.min(view.frames.length - 1, Math.max(0, Math.round(tSec / TICK_S) - 1));
  return view.frames[idx];
}

function shortName(partId: string): string {
  return getPart(partId).name.split(' (')[0]!;
}

function weaponBlurb(def: PartDef): string {
  const w = def.weapon!;
  const speed = w.projectileSpeed === 'hitscan' ? 'hitscan' : `${w.projectileSpeed} m/s`;
  return `${def.name} — ${w.damage}${w.salvoCount ? `×${w.salvoCount}` : ''} dmg every ${w.cycleS}s · ${speed} · band ${w.falloff.rangeStart}–${w.falloff.rangeEnd} m`;
}

function MechGlyph({ frame, chassisId, color }: { frame: MechFrame; chassisId: string; color: string }) {
  const chassis = getChassis(chassisId);
  // Grid "up" is forward, and forward points along +x at facing 0: the
  // footprint's grid-height runs along the facing axis.
  const lenM = chassis.height * CELL_SIZE_M * MECH_MAG;
  const widM = chassis.width * CELL_SIZE_M * MECH_MAG;
  const deg = (frame.facingRad * 180) / Math.PI;
  return (
    <g transform={`translate(${frame.x} ${frame.y}) rotate(${deg})`}>
      <rect
        x={-lenM / 2} y={-widM / 2} width={lenM} height={widM}
        rx={1.5} fill={color} opacity={0.28} stroke={color} strokeWidth={0.8}
      />
      <path d={`M ${lenM / 2 + 3} 0 L ${lenM / 2 - 1} -2.4 L ${lenM / 2 - 1} 2.4 Z`} fill={color} />
    </g>
  );
}

/** Command mode: a player's standing fire-control override on one gun. */
export type WeaponOverride = 'hold' | 'force';

function WeaponSlot({
  wf, fired, compact, onHover, override, onClick,
}: {
  wf: WeaponFrame;
  fired: boolean;
  compact?: boolean;
  onHover?: (partId: string | null) => void;
  override?: WeaponOverride;
  onClick?: () => void;
}) {
  const def = getPart(wf.partId);
  const cls = [
    'hud-slot',
    wf.status,
    !wf.enabled && wf.status === 'ok' ? 'holdfire' : '',
    fired ? 'fired' : '',
    compact ? 'compact' : '',
    override ? `ovr-${override}` : '',
    onClick ? 'clickable' : '',
  ].filter(Boolean).join(' ');
  const ovrText = override === 'hold' ? ' — manual: HOLD FIRE' : override === 'force' ? ' — manual: FORCE FIRE' : '';
  return (
    <div
      className={cls}
      title={weaponBlurb(def) + ovrText + (onClick ? ' · click: auto → hold → force' : '')}
      onClick={onClick}
      onMouseEnter={onHover ? () => onHover(wf.partId) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
    >
      <div className="hud-slot-fill" style={{ height: `${wf.readyFrac * 100}%` }} />
      <span className="hud-slot-label">{shortName(wf.partId)}</span>
      {wf.status === 'destroyed' && <span className="hud-slot-x">✕</span>}
      {wf.status === 'shutdown' && <span className="hud-slot-x">♨</span>}
      {!wf.enabled && wf.status === 'ok' && <span className="hud-slot-hold">HOLD</span>}
      {override && <span className={`hud-slot-ovr ${override}`}>{override === 'hold' ? '◦' : '▲'}</span>}
    </div>
  );
}

function Gauge({
  label, frac, marks, cls, text,
}: {
  label: string;
  frac: number;
  marks?: number[];
  cls: string;
  text: string;
}) {
  return (
    <div className="hud-gauge">
      <span className="hud-gauge-label">{label}</span>
      <span className="hud-gauge-track">
        <span className={`hud-gauge-fill ${cls}`} style={{ width: `${Math.min(100, Math.max(0, frac * 100))}%` }} />
        {marks?.map((m) => <span key={m} className="hud-gauge-mark" style={{ left: `${m * 100}%` }} />)}
      </span>
      <span className="hud-gauge-text">{text}</span>
    </div>
  );
}

export function BattleScene({
  view, tSec, names, onArenaOrder, weaponOverrides, onWeaponClick,
}: {
  view: BattleView;
  tSec: number;
  names: [string, string];
  /** Command mode: left-click = point order at arena coords, right-click = revert to auto. */
  onArenaOrder?: (x: number, y: number, kind: 'move' | 'auto') => void;
  /** Command mode: the player's standing per-gun overrides, shown on the slots. */
  weaponOverrides?: Record<string, WeaponOverride>;
  /** Command mode: click a gun slot to cycle auto → hold-fire → force-fire. */
  onWeaponClick?: (instanceId: string) => void;
}) {
  const [hoveredWeapon, setHoveredWeapon] = useState<string | null>(null);
  const frame = frameAt(view, tSec);

  // Shots fired just before `tSec` become tracers; hits also flash the target.
  const tracers = useMemo(
    () => view.events.filter(
      (e): e is Extract<BattleEvent, { type: 'shot' }> =>
        e.type === 'shot' && e.tSec <= tSec && e.tSec > tSec - TRACER_LINGER_S,
    ),
    [view.events, tSec],
  );
  const flashes = useMemo(
    () => view.events.filter(
      (e) => (e.type === 'part-destroyed' || e.type === 'cookoff') && e.tSec <= tSec && e.tSec > tSec - FLASH_LINGER_S,
    ),
    [view.events, tSec],
  );
  /** Weapon instances that fired within the muzzle-flash window (slot flash). */
  const firedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of view.events) {
      if (e.type === 'shot' && e.tSec <= tSec && e.tSec > tSec - MUZZLE_FLASH_S) ids.add(`${e.mech}:${e.instanceId}`);
    }
    return ids;
  }, [view.events, tSec]);

  const halfL = view.arena.lengthM / 2;
  const halfW = view.arena.widthM / 2;
  const margin = 8;

  if (!frame) return null;
  const you = frame.mechs[0];
  const foe = frame.mechs[1];
  const heatFrac = (m: MechFrame) => (m.hottestCellC - HEAT_MIN_C) / (HEAT_MAX_C - HEAT_MIN_C);

  return (
    <>
      {/* Enemy strip (compact mirror of the cockpit). */}
      <div className="hud-enemy" style={{ borderColor: MECH_COLORS[1] }}>
        <span className="hud-name" style={{ color: MECH_COLORS[1] }}>{names[1]}</span>
        <span className="hud-meter" title="Core HP">
          <span className="hud-meter-fill core" style={{ width: `${(100 * Math.max(0, foe.coreHp)) / CORE_HP}%` }} />
        </span>
        <span className="hud-meter" title="Functional mass">
          <span className="hud-meter-fill mass" style={{ width: `${100 * foe.functionalMassFrac}%` }} />
        </span>
        <span className="hud-meter" title={`Heat: ${foe.hottestCellC.toFixed(0)}°C`}>
          <span className="hud-meter-fill heat" style={{ width: `${Math.min(100, Math.max(0, heatFrac(foe) * 100))}%` }} />
        </span>
        <span className="hud-enemy-slots">
          {foe.weapons.map((wf) => (
            <WeaponSlot key={wf.instanceId} wf={wf} fired={firedIds.has(`1:${wf.instanceId}`)} compact />
          ))}
        </span>
        <span className="hud-chip">{foe.speedSetting}</span>
        <span className="hud-chip">{foe.moveIntent}</span>
        {foe.tile !== 'open' && <span className={`hud-chip tile-${foe.tile}`}>{foe.tile}</span>}
      </div>

      <svg
        className={`playback-arena${onArenaOrder ? ' commandable' : ''}`}
        viewBox={`${-halfL - margin} ${-halfW - margin} ${2 * (halfL + margin)} ${2 * (halfW + margin)}`}
        onPointerDown={onArenaOrder ? (e) => {
          const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(e.currentTarget.getScreenCTM()!.inverse());
          onArenaOrder(pt.x, pt.y, e.button === 2 ? 'auto' : 'move');
        } : undefined}
        onContextMenu={onArenaOrder ? (e) => e.preventDefault() : undefined}
      >
        {/* Terrain tiles (docs/03 §2): forest = cover, hill = range, water = cooling. */}
        {view.terrain.cells.flatMap((row, ry) =>
          row.map((tile, cx) =>
            tile === 'open' ? null : (
              <rect
                key={`t${cx}-${ry}`}
                className={`playback-tile ${tile}`}
                x={-halfL + cx * view.terrain.cellSizeM}
                y={-halfW + ry * view.terrain.cellSizeM}
                width={view.terrain.cellSizeM}
                height={view.terrain.cellSizeM}
              />
            ),
          ),
        )}
        <rect x={-halfL} y={-halfW} width={2 * halfL} height={2 * halfW} className="playback-walls" />
        {Array.from({ length: Math.floor(halfL / 25) * 2 + 1 }, (_, k) => (k - Math.floor(halfL / 25)) * 25).map((x) => (
          <line key={x} x1={x} y1={-halfW} x2={x} y2={halfW} className="playback-gridline" />
        ))}

        {/* Destination markers: the standing move order, drawn like an RTS waypoint. */}
        {([0, 1] as const).map((i) => {
          const m = frame.mechs[i];
          if (!m.dest) return null;
          return (
            <g key={`dest${i}`} className="playback-dest" stroke={MECH_COLORS[i]}>
              <line x1={m.x} y1={m.y} x2={m.dest.x} y2={m.dest.y} />
              <path
                d={`M ${m.dest.x} ${m.dest.y - 2.6} L ${m.dest.x + 2.6} ${m.dest.y} L ${m.dest.x} ${m.dest.y + 2.6} L ${m.dest.x - 2.6} ${m.dest.y} Z`}
                fill="none"
              />
            </g>
          );
        })}

        {tracers.map((e, idx) => {
          const f = frameAt(view, e.tSec);
          if (!f) return null;
          const from = f.mechs[e.mech];
          const to = f.mechs[(1 - e.mech) as 0 | 1];
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const d = Math.hypot(dx, dy) || 1;
          // Misses streak past the target, offset sideways (visual only; the
          // sim resolved the miss statistically).
          const missOff = e.hit ? 0 : ((idx % 2 === 0 ? 1 : -1) * (4 + (idx % 3) * 2));
          const ex = e.hit ? to.x : to.x + (dx / d) * 18 - (dy / d) * missOff;
          const ey = e.hit ? to.y : to.y + (dy / d) * 18 + (dx / d) * missOff;
          const age = (tSec - e.tSec) / TRACER_LINGER_S;
          return (
            <g key={`tr${idx}`} opacity={1 - age * 0.8}>
              <line x1={from.x} y1={from.y} x2={ex} y2={ey} className={`playback-tracer${e.hit ? ' hit' : ''}`} stroke={MECH_COLORS[e.mech]} />
              {e.hit && <circle cx={to.x} cy={to.y} r={1.6 + age * 2.5} className="playback-impact" />}
            </g>
          );
        })}

        {flashes.map((e, idx) => {
          if (e.type !== 'part-destroyed' && e.type !== 'cookoff') return null;
          const f = frameAt(view, e.tSec);
          if (!f) return null;
          const m = f.mechs[e.mech];
          const age = (tSec - e.tSec) / FLASH_LINGER_S;
          return <circle key={`fl${idx}`} cx={m.x} cy={m.y} r={3 + age * 8} className="playback-boom" opacity={1 - age} />;
        })}

        {([0, 1] as const).map((i) => (
          <MechGlyph key={i} frame={frame.mechs[i]} chassisId={view.mechs[i].chassisId} color={MECH_COLORS[i]} />
        ))}
      </svg>

      {/* Your cockpit: portrait | gun bar | gauges + verb chips. */}
      <div className="hud-cockpit" style={{ borderColor: MECH_COLORS[0] }}>
        <div className="hud-portrait">
          <span className="hud-name" style={{ color: MECH_COLORS[0] }}>{names[0]}</span>
          <span className="hud-meter" title="Core HP">
            <span className="hud-meter-fill core" style={{ width: `${(100 * Math.max(0, you.coreHp)) / CORE_HP}%` }} />
          </span>
          <span className="hud-meter" title="Functional mass">
            <span className="hud-meter-fill mass" style={{ width: `${100 * you.functionalMassFrac}%` }} />
          </span>
        </div>

        <div className="hud-guns">
          <div className="hud-gun-row">
            {you.weapons.length === 0 && <span className="hud-empty">no weapons</span>}
            {you.weapons.map((wf) => (
              <WeaponSlot
                key={wf.instanceId} wf={wf}
                fired={firedIds.has(`0:${wf.instanceId}`)}
                onHover={setHoveredWeapon}
                override={weaponOverrides?.[wf.instanceId]}
                onClick={onWeaponClick ? () => onWeaponClick(wf.instanceId) : undefined}
              />
            ))}
          </div>
          <div className="hud-gun-blurb">
            {hoveredWeapon ? weaponBlurb(getPart(hoveredWeapon)) : 'fill = time to next shot · HOLD = fire control withheld'}
          </div>
        </div>

        <div className="hud-gauges">
          <Gauge
            label="HEAT" frac={heatFrac(you)} cls={you.hottestCellC >= 130 ? 'heat-hot' : 'heat'}
            marks={[(100 - HEAT_MIN_C) / (HEAT_MAX_C - HEAT_MIN_C), (130 - HEAT_MIN_C) / (HEAT_MAX_C - HEAT_MIN_C)]}
            text={`${you.hottestCellC.toFixed(0)}°C`}
          />
          {view.mechs[0].capacitorMaxKj > 0 && (
            <Gauge
              label="CAP" frac={you.capacitorKj / view.mechs[0].capacitorMaxKj} cls="cap"
              text={`${you.capacitorKj.toFixed(0)}/${view.mechs[0].capacitorMaxKj} kJ`}
            />
          )}
          <Gauge
            label="PWR" frac={you.supplyKw > 0 ? you.demandKw / you.supplyKw : 0}
            cls={you.demandKw > you.supplyKw ? 'pwr-over' : 'pwr'}
            text={`${you.demandKw.toFixed(0)}/${you.supplyKw.toFixed(0)} kW`}
          />
          <div className="hud-verbs">
            <span className="hud-chip active">{you.speedSetting}</span>
            <span className="hud-chip active">{you.moveIntent}</span>
            <span className={`hud-chip${you.faceMode === 'target' ? ' active' : ''}`} title="Facing order">
              face: {you.faceMode}
            </span>
            {you.tile !== 'open' && (
              <span
                className={`hud-chip tile-${you.tile}`}
                title={you.tile === 'forest' ? 'Forest: cover from incoming fire, slower' : you.tile === 'hill' ? 'Hill: extended weapon range' : 'Water: radiators boosted, much slower'}
              >
                {you.tile}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** Decisions and consequences up to now (routine shots stay out). */
export function BattleTicker({ view, tSec, names }: { view: BattleView; tSec: number; names: [string, string] }) {
  const rows = useMemo(() => {
    const kept = view.events.filter((e) => {
      if (e.tSec > tSec) return false;
      if (e.type === 'shot') return e.hit && e.totalDamageDealt >= 15;
      return true;
    });
    return kept.slice(-6);
  }, [view.events, tSec]);
  return (
    <div className="playback-ticker">
      {rows.map((e, idx) => {
        const { text, cls } = eventText(e, names);
        return (
          <div key={`${e.tSec}-${idx}`} className={`playback-ticker-row ${cls}`}>
            <span className="playback-ticker-time">{fmtTime(e.tSec)}</span>
            <span>{text}</span>
          </div>
        );
      })}
    </div>
  );
}

export function BattleCaption({ view }: { view: BattleView }) {
  return (
    <div className="playback-caption">
      mech footprints magnified {MECH_MAG}× · arena {view.arena.lengthM} × {view.arena.widthM} m ·
      <span className="tile-key forest"> ■</span> forest (cover)
      <span className="tile-key hill"> ■</span> hill (range)
      <span className="tile-key water"> ■</span> water (cooling)
    </div>
  );
}
