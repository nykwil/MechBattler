import { useMemo, useState } from 'react';
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

export function GridEditor({
  chassis, parts, overlay, selectedPartId, selectedInstanceId, previewCells, checkCandidate,
  onPlace, onSelectInstance, thermalSnapshot,
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
}) {
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

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

  const selectedCells = useMemo(() => {
    const placed = parts.find((p) => p.instanceId === selectedInstanceId);
    return placed ? getOccupiedCells(placed, getPart(placed.partId)) : [];
  }, [parts, selectedInstanceId]);

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
                x={x * CELL + 1} y={y * CELL + 1} width={CELL - 2} height={CELL - 2}
                fill={fill}
                opacity={overlay === 'thermal' ? 1 : 0.85}
              />
            );
          })}

          {selectedCells.map(({ x, y }) => (
            <rect
              key={`sel-${x},${y}`}
              className="cell-selected"
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
                if (selectedPartId) onPlace(x, y);
                else onSelectInstance(occ ? occ.instanceId : null);
              }}
            />
          ))}
        </svg>
      </div>
      <div className="grid-caption">
        <span>{chassis.name} · {chassis.type}</span>
        <span>{cells.length} cells</span>
        <span>{parts.length} parts placed</span>
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
