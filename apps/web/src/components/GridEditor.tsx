import { useMemo, type CSSProperties } from 'react';
import {
  computeConnectivity,
  getOccupiedCells,
  getPart,
  type ChassisSpec,
  type PlacedPart,
} from '@mechbattler/sim';
import type { OverlayMode } from '../state/useBuild.js';
import { CATEGORY_COLOR } from '../lib/partVisuals.js';
import { thermalColor } from '../lib/thermalColor.js';
import './GridEditor.css';

const CELL = 30;

/**
 * SVG path tracing the outer boundary of a set of cells: every cell edge
 * whose neighbor is not in the set. Cells of one part render as a single
 * silhouette instead of disconnected tiles.
 */
function outlinePath(cells: { x: number; y: number }[]): string {
  const inSet = new Set(cells.map((c) => `${c.x},${c.y}`));
  const segments: string[] = [];
  for (const { x, y } of cells) {
    const px = x * CELL;
    const py = y * CELL;
    if (!inSet.has(`${x},${y - 1}`)) segments.push(`M${px},${py}h${CELL}`);
    if (!inSet.has(`${x},${y + 1}`)) segments.push(`M${px},${py + CELL}h${CELL}`);
    if (!inSet.has(`${x - 1},${y}`)) segments.push(`M${px},${py}v${CELL}`);
    if (!inSet.has(`${x + 1},${y}`)) segments.push(`M${px + CELL},${py}v${CELL}`);
  }
  return segments.join('');
}

const PLATE_VIEWS: { id: OverlayMode; label: string }[] = [
  { id: 'parts', label: 'Parts' },
  { id: 'power', label: 'Power' },
  { id: 'thermal', label: 'Heat' },
];

const PLATE_CAPTION: Record<OverlayMode, string> = {
  parts: 'Colour is the part category.',
  power: 'Green reaches the core · red and hatched is stranded · blue is the bus.',
  thermal: 'Colour is cell temperature, coolest to hottest.',
};

const REJECTION_TEXT: Record<string, string> = {
  'out-of-mask': 'off the chassis — parts never hang off the mask',
  overlap: 'cell already occupied',
  'perimeter-required': 'radiators need perimeter cells (exposure)',
  'core-occupied': 'the core cell is reserved',
};

export function GridEditor({
  chassis, parts, overlay, selectedPartId, selectedInstanceId, previewCells, checkCandidate,
  ghost, detached, onAim, onCommit, onCancel, onRotate, onSetOverlay,
  onSelectInstance, thermalSnapshot, faultInstanceIds, flashInstanceIds, onAutoWire,
}: {
  chassis: ChassisSpec;
  parts: PlacedPart[];
  overlay: OverlayMode;
  selectedPartId: string | null;
  selectedInstanceId: string | null;
  previewCells: (x: number, y: number) => { x: number; y: number }[];
  checkCandidate: (x: number, y: number) => { reason: string } | null;
  /** Where the armed part's ghost sits; null when nothing is armed (docs/14 §6). */
  ghost: { x: number; y: number } | null;
  /** True while the armed part came off the plate (docs/14 §7). */
  detached: boolean;
  onAim: (x: number, y: number) => void;
  onCommit: () => void;
  onCancel: () => void;
  onRotate: () => void;
  onSetOverlay: (overlay: OverlayMode) => void;
  onSelectInstance: (instanceId: string | null) => void;
  thermalSnapshot: Record<string, number> | null;
  faultInstanceIds: Set<string>;
  /** Freshly auto-wired conduits, highlighted briefly so the pass is visible. */
  flashInstanceIds: Set<string>;
  onAutoWire: () => void;
}) {

  const occupancy = useMemo(() => {
    const map = new Map<string, { instanceId: string; partId: string }>();
    for (const p of parts) {
      for (const c of getOccupiedCells(p, getPart(p.partId))) {
        map.set(`${c.x},${c.y}`, { instanceId: p.instanceId, partId: p.partId });
      }
    }
    return map;
  }, [parts]);

  const connectivity = useMemo(() => computeConnectivity(parts), [parts]);

  // The ghost is the preview (docs/14 §6). A second pointer-following preview
  // would put two candidate shapes on the plate at once.
  const ghostPreview = ghost && selectedPartId ? previewCells(ghost.x, ghost.y) : [];
  const ghostError = ghost && selectedPartId ? checkCandidate(ghost.x, ghost.y) : null;
  const ghostLegal = Boolean(ghost && selectedPartId) && ghostError === null;

  const selectedOutline = useMemo(() => {
    const placed = parts.find((p) => p.instanceId === selectedInstanceId);
    return placed ? outlinePath(getOccupiedCells(placed, getPart(placed.partId))) : '';
  }, [parts, selectedInstanceId]);

  const faultOutlines = useMemo(() => parts
    .filter((p) => faultInstanceIds.has(p.instanceId))
    .map((p) => outlinePath(getOccupiedCells(p, getPart(p.partId)))), [parts, faultInstanceIds]);

  const flashOutlines = useMemo(() => parts
    .filter((p) => flashInstanceIds.has(p.instanceId))
    .map((p) => outlinePath(getOccupiedCells(p, getPart(p.partId)))), [parts, flashInstanceIds]);

  /** One boundary path per placed part, so multi-cell parts read as one piece. */
  const partOutlines = useMemo(() => parts.map((p) => ({
    instanceId: p.instanceId,
    d: outlinePath(getOccupiedCells(p, getPart(p.partId))),
  })), [parts]);

  // Firing-direction wedges: grid up is chassis forward (docs/01 §1), and mount
  // arcs are centered on forward regardless of placement — so every weapon gets
  // an up-pointing wedge spanning its real mountArcDeg at the part's centroid.
  const weaponArcs = useMemo(() => parts.flatMap((p) => {
    const def = getPart(p.partId);
    if (!def.weapon) return [];
    const occ = getOccupiedCells(p, def);
    const cx = (occ.reduce((s, c) => s + c.x, 0) / occ.length + 0.5) * CELL;
    const cy = (occ.reduce((s, c) => s + c.y, 0) / occ.length + 0.5) * CELL;
    const half = (def.weapon.mountArcDeg / 2) * (Math.PI / 180);
    const r = CELL * 0.75;
    const x0 = cx + r * Math.sin(-half);
    const y0 = cy - r * Math.cos(-half);
    const x1 = cx + r * Math.sin(half);
    const y1 = cy - r * Math.cos(half);
    return [{
      instanceId: p.instanceId,
      d: `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${half > Math.PI / 2 ? 1 : 0} 1 ${x1},${y1} Z`,
    }];
  }), [parts]);

  // Salvage integrity badges (docs/10 M3): a sub-100% part wears its number
  // on the grid — half-broken salvage must read at a glance (R4).
  const integrityBadges = useMemo(() => parts.flatMap((p) => {
    if (p.integrity >= 1) return [];
    const occ = getOccupiedCells(p, getPart(p.partId));
    return [{
      instanceId: p.instanceId,
      x: (occ.reduce((s, c) => s + c.x, 0) / occ.length + 0.5) * CELL,
      y: (occ.reduce((s, c) => s + c.y, 0) / occ.length + 0.5) * CELL,
      pct: Math.round(p.integrity * 100),
    }];
  }), [parts]);

  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < chassis.height; y++) {
    for (let x = 0; x < chassis.width; x++) {
      if (chassis.mask[y]?.[x]) cells.push({ x, y });
    }
  }

  function isUnpowered(x: number, y: number): boolean {
    const occ = occupancy.get(`${x},${y}`);
    if (!occ || overlay !== 'power') return false;
    return !connectivity.connectedInstanceIds.has(occ.instanceId);
  }

  function cellFill(x: number, y: number): string | null {
    const occ = occupancy.get(`${x},${y}`);
    if (!occ) return null;
    if (overlay === 'power') {
      const connected = connectivity.connectedInstanceIds.has(occ.instanceId);
      return connected ? 'var(--signal-green)' : 'var(--signal-red)';
    }
    if (overlay === 'thermal') {
      const t = thermalSnapshot?.[`${x},${y}`];
      return t === undefined ? 'var(--bg-panel-raised)' : thermalColor(t);
    }
    return CATEGORY_COLOR[getPart(occ.partId).category];
  }

  return (
    <div className="grid-wrap">
      {/* Plate views (docs/14 §8): the three overlays the app already had, given
          a permanent home. aria-pressed carries the state -- the old .chip.active
          encoded it in colour alone. */}
      <div className="plate-views" role="group" aria-label="Plate view">
        {PLATE_VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`plate-view${overlay === v.id ? ' active' : ''}`}
            aria-pressed={overlay === v.id}
            onClick={() => onSetOverlay(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* --cols/--rows drive the cell size in CSS (docs/14 §5). CELL stays the
          SVG coordinate unit so the boundary-path maths is unaffected; the
          viewBox scales those units to whatever width the cell size resolves
          to, which keeps sizing declarative and free of layout measurement. */}
      <div
        className="grid-frame"
        style={{ '--cols': chassis.width, '--rows': chassis.height } as CSSProperties}
      >
        <svg
          className="grid-svg"
          viewBox={`0 0 ${chassis.width * CELL} ${chassis.height * CELL}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* docs/14 §9: colour is never the only channel. Unpowered parts are
              hatched as well as red, so the power overlay survives any form of
              colour blindness and any bad screen. */}
          <defs>
            <pattern id="hatch-unpowered" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--bg-inset)" strokeWidth="2.5" />
            </pattern>
          </defs>
          {cells.map(({ x, y }) => {
            const isCore = x === chassis.coreCell.x && y === chassis.coreCell.y;
            return (
              <rect
                key={`bg-${x},${y}`}
                className={isCore ? 'cell-core' : 'cell-bg'}
                x={x * CELL} y={y * CELL} width={CELL} height={CELL}
              />
            );
          })}

          {cells.map(({ x, y }) => {
            const fill = cellFill(x, y);
            if (!fill) return null;
            return (
              <rect
                key={`part-${x},${y}`}
                className="cell-part"
                x={x * CELL} y={y * CELL} width={CELL} height={CELL}
                fill={fill}
                opacity={overlay === 'thermal' ? 1 : 0.85}
              />
            );
          })}

          {cells.filter(({ x, y }) => isUnpowered(x, y)).map(({ x, y }) => (
            <rect
              key={`hatch-${x},${y}`}
              className="cell-unpowered-hatch"
              x={x * CELL} y={y * CELL} width={CELL} height={CELL}
              fill="url(#hatch-unpowered)"
            />
          ))}

          {partOutlines.map(({ instanceId, d }) => (
            <path key={`outline-${instanceId}`} className="part-outline" d={d} />
          ))}

          {overlay === 'parts' && weaponArcs.map(({ instanceId, d }) => (
            <path key={`arc-${instanceId}`} className="weapon-arc" d={d} />
          ))}

          {overlay === 'parts' && integrityBadges.map((b) => (
            <text key={`int-${b.instanceId}`} className="integrity-badge" x={b.x} y={b.y}>
              {b.pct}%
            </text>
          ))}

          {faultOutlines.map((d, i) => (
            <path key={`fault-${i}`} className="cell-fault" d={d} />
          ))}

          {flashOutlines.map((d, i) => (
            <path key={`flash-${i}`} className="cell-flash" d={d} />
          ))}

          {selectedOutline && <path className="cell-selected" d={selectedOutline} />}


          {ghostPreview.map(({ x, y }) => (
            <rect
              key={`preview-${x},${y}`}
              className={ghostLegal ? 'cell-preview-ok' : 'cell-preview-bad'}
              x={x * CELL + 1} y={y * CELL + 1} width={CELL - 2} height={CELL - 2}
            />
          ))}

          {cells.map(({ x, y }) => (
            <rect
              key={`hit-${x},${y}`}
              className="cell-hit"
              x={x * CELL} y={y * CELL} width={CELL} height={CELL}
              onClick={() => {
                // Armed: a tap moves the ghost. Committing is a separate,
                // explicit act, so a fingertip covering the target cannot
                // place a part by accident (docs/14 §6).
                if (selectedPartId) {
                  onAim(x, y);
                  return;
                }
                const occ = occupancy.get(`${x},${y}`);
                onSelectInstance(occ ? occ.instanceId : null);
              }}
            />
          ))}
        </svg>
      </div>

      {/* Armed controls are exactly three: Cancel · Rotate · Place (docs/14 §6).
          No nudge pad — tapping a cell already positions the ghost, so arrows
          would be a second control doing one job, and fitting them broke
          --tap-min in the very component that documents it. Arrow *keys* still
          nudge, because a keyboard has no cell to tap. */}
      {selectedPartId && ghost && (
        <div className="plate-armed">
          {/* A disabled control must never be a mystery: the reason sits
              directly above Place, not in a toast that has already gone. */}
          {ghostError && (
            <p className="plate-armed-reason" role="status">
              {REJECTION_TEXT[ghostError.reason] ?? ghostError.reason}
            </p>
          )}
          <div className="plate-armed-actions">
            {/* A detached part is already off the plate, so backing out has
                nothing to return it to -- the control is Discard, and it takes
                the danger style to say so (docs/14 §7). */}
            <button
              type="button"
              className={detached ? 'plate-btn plate-btn-danger' : 'plate-btn'}
              onClick={onCancel}
            >
              {detached ? 'Discard' : 'Cancel'}
            </button>
            <button type="button" className="plate-btn" onClick={onRotate}>Rotate</button>
            <button
              type="button"
              className="plate-btn plate-btn-primary"
              onClick={onCommit}
              disabled={!ghostLegal}
            >
              Place
            </button>
          </div>
        </div>
      )}

      {/* A legend you must remember is a legend that failed: the caption states
          what the current colours mean, right under the plate (docs/14 §8). */}
      <p className="plate-caption">{PLATE_CAPTION[overlay]}</p>

      <div className="grid-caption">
        <span>{chassis.name} · {chassis.type}</span>
        <span>{cells.length} cells</span>
        <span>{parts.length} parts placed</span>
        <button
          type="button"
          className="autowire-btn"
          onClick={onAutoWire}
          title="Lay a functional (not optimal) conduit graph to every unpowered part and the core — you can still reroute by hand"
        >
          ⚡ Auto-wire
        </button>
      </div>
      <Legend overlay={overlay} />
    </div>
  );
}

function Legend({ overlay }: { overlay: OverlayMode }) {
  if (overlay === 'power') {
    return (
      <div className="legend">
        <LegendItem color="var(--signal-green)" label="Connected" />
        <LegendItem color="var(--signal-red)" label="Unpowered (hatched)" />
        <LegendItem color="var(--bg-panel-raised)" label="Core (reserved)" />
      </div>
    );
  }
  if (overlay === 'thermal') {
    return (
      <div className="legend">
        <LegendItem color="rgb(42,58,74)" label="Ambient ~25C" />
        <LegendItem color="rgb(90,169,199)" label="Warm" />
        <LegendItem color="rgb(232,162,61)" label="~100C warning" />
        <LegendItem color="rgb(214,69,69)" label="130C shutdown" />
      </div>
    );
  }
  return (
    <div className="legend">
      <LegendItem color={CATEGORY_COLOR.reactor} label="Reactor" />
      <LegendItem color={CATEGORY_COLOR.capacitor} label="Capacitor" />
      <LegendItem color={CATEGORY_COLOR.weapon} label="Weapon" />
      <LegendItem color={CATEGORY_COLOR.utility} label="Utility" />
      <LegendItem color={CATEGORY_COLOR.structural} label="Structural" />
      <LegendItem color="rgba(255,255,255,0.65)" label="Fire arc (↑ = forward)" />
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="legend-item">
      <span className="legend-swatch" style={{ background: color }} />
      {label}
    </span>
  );
}
