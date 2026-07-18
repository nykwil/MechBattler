import { useEffect, useMemo, useState } from 'react';
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

const REJECTION_TEXT: Record<string, string> = {
  'out-of-mask': 'off the chassis — parts never hang off the mask',
  overlap: 'cell already occupied',
  'perimeter-required': 'radiators need perimeter cells (exposure)',
  'core-occupied': 'the core cell is reserved',
};

export function GridEditor({
  chassis, parts, overlay, selectedPartId, selectedInstanceId, previewCells, checkCandidate,
  onPlace, onSelectInstance, thermalSnapshot, faultInstanceIds, flashInstanceIds, onAutoWire,
}: {
  chassis: ChassisSpec;
  parts: PlacedPart[];
  overlay: OverlayMode;
  selectedPartId: string | null;
  selectedInstanceId: string | null;
  previewCells: (x: number, y: number) => { x: number; y: number }[];
  checkCandidate: (x: number, y: number) => { reason: string } | null;
  onPlace: (x: number, y: number) => void;
  onSelectInstance: (instanceId: string | null) => void;
  thermalSnapshot: Record<string, number> | null;
  faultInstanceIds: Set<string>;
  /** Freshly auto-wired conduits, highlighted briefly so the pass is visible. */
  flashInstanceIds: Set<string>;
  onAutoWire: () => void;
}) {
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  // Illegal-placement feedback (docs/07 gap #1): a rejected click flashes the
  // attempted cells red and names the reason, instead of failing silently.
  const [rejection, setRejection] = useState<{ cells: { x: number; y: number }[]; reason: string; at: number } | null>(null);

  useEffect(() => {
    if (!rejection) return;
    const t = setTimeout(() => setRejection(null), 900);
    return () => clearTimeout(t);
  }, [rejection]);

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

  const hoverPreview = hover && selectedPartId ? previewCells(hover.x, hover.y) : [];
  const hoverLegal = hover && selectedPartId ? checkCandidate(hover.x, hover.y) === null : false;

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

  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < chassis.height; y++) {
    for (let x = 0; x < chassis.width; x++) {
      if (chassis.mask[y]?.[x]) cells.push({ x, y });
    }
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
      <div className="grid-frame">
        <svg
          className="grid-svg"
          width={chassis.width * CELL}
          height={chassis.height * CELL}
          onMouseLeave={() => setHover(null)}
        >
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

          {partOutlines.map(({ instanceId, d }) => (
            <path key={`outline-${instanceId}`} className="part-outline" d={d} />
          ))}

          {overlay === 'parts' && weaponArcs.map(({ instanceId, d }) => (
            <path key={`arc-${instanceId}`} className="weapon-arc" d={d} />
          ))}

          {faultOutlines.map((d, i) => (
            <path key={`fault-${i}`} className="cell-fault" d={d} />
          ))}

          {flashOutlines.map((d, i) => (
            <path key={`flash-${i}`} className="cell-flash" d={d} />
          ))}

          {selectedOutline && <path className="cell-selected" d={selectedOutline} />}

          {rejection && rejection.cells.map(({ x, y }) => (
            <rect
              key={`rej-${rejection.at}-${x},${y}`}
              className="cell-rejected"
              x={x * CELL + 1} y={y * CELL + 1} width={CELL - 2} height={CELL - 2}
            />
          ))}

          {hoverPreview.map(({ x, y }) => (
            <rect
              key={`preview-${x},${y}`}
              className={hoverLegal ? 'cell-preview-ok' : 'cell-preview-bad'}
              x={x * CELL + 1} y={y * CELL + 1} width={CELL - 2} height={CELL - 2}
            />
          ))}

          {cells.map(({ x, y }) => (
            <rect
              key={`hit-${x},${y}`}
              className="cell-hit"
              x={x * CELL} y={y * CELL} width={CELL} height={CELL}
              onMouseEnter={() => setHover({ x, y })}
              onClick={() => {
                const occ = occupancy.get(`${x},${y}`);
                if (selectedPartId) {
                  const error = checkCandidate(x, y);
                  if (error) {
                    setRejection({ cells: previewCells(x, y), reason: REJECTION_TEXT[error.reason] ?? error.reason, at: Date.now() });
                  } else {
                    onPlace(x, y);
                  }
                } else {
                  onSelectInstance(occ ? occ.instanceId : null);
                }
              }}
            />
          ))}
        </svg>
      </div>
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
      {rejection && <div className="grid-rejection">✕ {rejection.reason}</div>}
      <Legend overlay={overlay} />
    </div>
  );
}

function Legend({ overlay }: { overlay: OverlayMode }) {
  if (overlay === 'power') {
    return (
      <div className="legend">
        <LegendItem color="var(--signal-green)" label="Connected" />
        <LegendItem color="var(--signal-red)" label="Unpowered" />
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
