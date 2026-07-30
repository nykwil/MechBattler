import { useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  buildOccupancyMap,
  computeConnectivity,
  getPart,
  type ChassisSpec,
  type PartDef,
  type PlacedPart,
} from '@mechbattler/sim';
import type { OverlayMode } from '../state/useBuild.js';
import { thermalColor } from '../lib/thermalColor.js';

/**
 * The plate, ported from the mobile builder prototype
 * (docs/prototypes/mobile-builder.html). A CSS grid of buttons rather than the
 * SVG the app used before, because that is what the prototype is and what
 * docs/14 §5 describes: per-edge box shadows fuse a part's cells into one
 * silhouette while every cell stays its own tap target, focus stop, and
 * accessible name. An SVG overlay path cannot do the last three.
 */

/**
 * Outline only the edges where a cell meets something that is not the same part,
 * so the cells of one part read as a single shape. The prototype's edgeShadow.
 */
function edgeShadow(
  belongs: (dx: number, dy: number) => boolean,
  colour: string,
  px = 1,
): string {
  const s: string[] = [];
  if (!belongs(0, -1)) s.push(`inset 0 ${px}px 0 0 ${colour}`);
  if (!belongs(0, 1)) s.push(`inset 0 ${-px}px 0 0 ${colour}`);
  if (!belongs(-1, 0)) s.push(`inset ${px}px 0 0 0 ${colour}`);
  if (!belongs(1, 0)) s.push(`inset ${-px}px 0 0 0 ${colour}`);
  return s.join(',');
}

const OVERLAY_CAPTION: Record<OverlayMode, string> = {
  parts: 'Colour = category',
  power: 'Green reaches the core · red is stranded · blue is bus',
  thermal: 'Red and amber make heat · blue sheds it',
};

/** True when a part draws or supplies power, so "unpowered" is meaningful for it. */
function needsPower(def: PartDef): boolean {
  return Boolean(def.draw?.continuousKw || def.draw?.chargedEnergyPerShotKj || def.reactor);
}

/**
 * Peak waste heat in kW, or 0. The prototype read a flat `p.wh`; the real catalog
 * splits it between ReactorSpec.wasteHeatKw (a tuple for combustion, which has a
 * low- and high-load figure) and HeatProfile.idleHeatKw.
 */
function wasteHeatKw(def: PartDef): number {
  const reactor = def.reactor?.wasteHeatKw;
  const fromReactor = Array.isArray(reactor) ? Math.max(...reactor) : (reactor ?? 0);
  return Math.max(fromReactor, def.heat?.idleHeatKw ?? 0);
}

export function Plate({
  chassis, parts, overlay, selectedInstanceId, ghostCells, ghostLegal,
  thermalSnapshot, onCellActivate,
}: {
  chassis: ChassisSpec;
  parts: PlacedPart[];
  overlay: OverlayMode;
  selectedInstanceId: string | null;
  /** Cells the armed part would occupy; empty when nothing is armed. */
  ghostCells: { x: number; y: number }[];
  ghostLegal: boolean;
  thermalSnapshot: Record<string, number> | null;
  onCellActivate: (x: number, y: number) => void;
}) {
  // The sim owns this mapping; both this and DamageGrid had a copy of it.
  const occupancy = useMemo(() => buildOccupancyMap(parts).byCell, [parts]);

  const powered = useMemo(
    () => computeConnectivity(parts).connectedInstanceIds,
    [parts],
  );

  const ghost = useMemo(() => {
    const set = new Set<string>();
    for (const c of ghostCells) set.add(`${c.x},${c.y}`);
    return set;
  }, [ghostCells]);

  function fillFor(def: PartDef, live: boolean, x: number, y: number): string {
    if (overlay === 'power') {
      if (def.isConduit) return 'var(--signal-blue)';
      if (!needsPower(def)) return 'var(--line-bright)';
      return live ? 'var(--signal-green)' : 'var(--signal-red)';
    }
    if (overlay === 'thermal') {
      const t = thermalSnapshot?.[`${x},${y}`];
      if (t !== undefined) return thermalColor(t);
      const waste = wasteHeatKw(def);
      if (waste) return waste >= 7 ? 'var(--signal-red)' : 'var(--signal-amber)';
      // Radiators are the app's cooling parts; the catalog marks them perimeterOnly.
      if (def.perimeterOnly) return 'var(--signal-blue)';
      if (def.isHeatPipe) return 'var(--signal-blue-dim)';
      return 'var(--line-bright)';
    }
    return `var(--cat-${def.category})`;
  }

  // Keyboard cursor, ported from the prototype's plate keydown handler. When a
  // part is armed the arrows nudge the ghost (handled globally); when nothing is
  // armed they walk a focus cursor across in-mask cells, skipping the void, and
  // Enter selects whatever is under it. Without this an unarmed keyboard user
  // could only reach cells by tabbing through all of them in document order.
  const plateRef = useRef<HTMLDivElement>(null);
  const firstCell = useMemo(() => {
    for (let y = 0; y < chassis.height; y += 1) {
      for (let x = 0; x < chassis.width; x += 1) if (chassis.mask[y]?.[x]) return { x, y };
    }
    return { x: 0, y: 0 };
  }, [chassis]);
  const [cursor, setCursor] = useState(firstCell);

  const armed = ghostCells.length > 0;

  function onKeyDown(e: React.KeyboardEvent) {
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const delta = deltas[e.key];
    if (delta) {
      // Armed: the global handler nudges the ghost, so leave it alone.
      if (armed) return;
      e.preventDefault();
      const [dx, dy] = delta;
      let { x, y } = cursor;
      // Step until the next in-mask cell, so the void never traps the cursor.
      for (let i = 0; i < Math.max(chassis.width, chassis.height); i += 1) {
        x += dx;
        y += dy;
        if (x < 0 || y < 0 || x >= chassis.width || y >= chassis.height) return;
        if (chassis.mask[y]?.[x]) break;
      }
      setCursor({ x, y });
      plateRef.current
        ?.querySelector<HTMLElement>(`[data-x="${x}"][data-y="${y}"]`)
        ?.focus();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && !armed) {
      e.preventDefault();
      onCellActivate(cursor.x, cursor.y);
    }
  }

  const rows = [];
  for (let y = 0; y < chassis.height; y += 1) {
    const cells = [];
    for (let x = 0; x < chassis.width; x += 1) {
      const key = `${x},${y}`;
      const inMask = Boolean(chassis.mask[y]?.[x]);

      if (!inMask) {
        // Off-mask positions still occupy a grid slot, so they carry role=gridcell
        // -- a row's children must all be gridcells -- but are hidden and
        // untabbable, since there is nothing there to interact with.
        cells.push(
          <span key={key} className="cell void" role="gridcell" aria-hidden="true" />,
        );
        continue;
      }

      const isCore = x === chassis.coreCell.x && y === chassis.coreCell.y;
      const occ = occupancy.get(key);
      const classes = ['cell'];
      const style: CSSProperties = {};
      let label = `column ${x + 1}, row ${y + 1}, `;

      if (isCore) {
        classes.push('core');
        label += 'reactor core';
      } else if (occ) {
        const def = getPart(occ.partId);
        const live = powered.has(occ.instanceId);
        classes.push('filled');
        style.background = fillFor(def, live, x, y);
        // In Parts view the hatch is the only cue for a dead part, so keep it.
        // Power view already says it in position and colour, so drop the noise.
        if (!live && needsPower(def) && overlay !== 'power') classes.push('unpowered');
        const selected = selectedInstanceId === occ.instanceId;
        if (selected) classes.push('sel');
        const same = (dx: number, dy: number) =>
          occupancy.get(`${x + dx},${y + dy}`)?.instanceId === occ.instanceId;
        style.boxShadow = selected
          ? edgeShadow(same, 'var(--signal-amber)', 2)
          : edgeShadow(same, 'rgba(0,0,0,.55)', 1);
        label += def.name + (live || !needsPower(def) ? '' : ', unpowered');
      } else {
        label += 'empty';
      }

      if (ghost.has(key)) {
        classes.push(ghostLegal ? 'ghost-ok' : 'ghost-bad');
        // The ghost is one object too -- outline its silhouette, not each cell.
        const inGhost = (dx: number, dy: number) => ghost.has(`${x + dx},${y + dy}`);
        style.boxShadow = edgeShadow(
          inGhost,
          ghostLegal ? 'var(--signal-green)' : 'var(--signal-red)',
          2,
        );
      }

      cells.push(
        <button
          key={key}
          type="button"
          className={classes.join(' ')}
          role="gridcell"
          data-x={x}
          data-y={y}
          aria-label={label}
          style={style}
          onClick={() => onCellActivate(x, y)}
        />,
      );
    }
    // role="row" is required between grid and gridcell; display:contents keeps
    // the CSS grid flat so the ARIA structure costs nothing visually.
    rows.push(
      <div key={`row-${y}`} role="row" style={{ display: 'contents' }}>{cells}</div>,
    );
  }

  return (
    <div className="plate-area">
      <div
        className="plate"
        role="grid"
        ref={plateRef}
        onKeyDown={onKeyDown}
        aria-label="Chassis layout grid"
        aria-rowcount={chassis.height}
        aria-colcount={chassis.width}
        style={{ gridTemplateColumns: `repeat(${chassis.width}, var(--cell))` }}
      >
        {rows}
      </div>
      {/* Hidden once a ghost is on the plate: mid-placement the instruction is
          already being followed, and it prints over the thing being aimed. */}
      {parts.length === 0 && ghostCells.length === 0 && (
        <p className="empty-hint">
          Empty chassis.<br />Start with a reactor — open Parts.
        </p>
      )}
      <p className="plate-caption">{OVERLAY_CAPTION[overlay]}</p>
    </div>
  );
}
