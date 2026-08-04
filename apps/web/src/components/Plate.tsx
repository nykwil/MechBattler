import { useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  buildOccupancyMap,
  buildSpatialOccupancy,
  connectedInstanceIds,
  getPart,
  isExteriorCell,
  isPortCell,
  regionIdAt,
  resolveSpatialPower,
  resolveThermalPaths,
  spatialCellKey,
  type ChassisSpec,
  type PartDef,
  type PlacedPart,
  type RouteCell,
  type RouteKind,
} from '@mechbattler/sim';
import type { OverlayMode } from '../state/useBuild.js';
import { thermalColor } from '../lib/thermalColor.js';
import { resolveWorkshopLayout } from '../lib/workshopLayout.js';

type RouteDirection = 'up' | 'right' | 'down' | 'left';
const ROUTE_NEIGHBORS: Array<{
  direction: RouteDirection;
  dx: number;
  dy: number;
}> = [
  { direction: 'up', dx: 0, dy: -1 },
  { direction: 'right', dx: 1, dy: 0 },
  { direction: 'down', dx: 0, dy: 1 },
  { direction: 'left', dx: -1, dy: 0 },
];

function RoutePath({
  kind,
  directions,
  energized = true,
}: {
  kind: RouteKind;
  directions: Set<RouteDirection>;
  energized?: boolean;
}) {
  return (
    <span className={`route-path ${kind === 'wire'
      ? `bus ${energized ? 'energized' : 'stranded'}`
      : `heat-pipe ${energized ? 'linked' : 'isolated'}`}`} aria-hidden="true">
      {[...directions].map((direction) => (
        <span key={direction} className={`route-arm route-${direction}`} />
      ))}
      <span className="route-node" />
    </span>
  );
}

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
  chassis, parts, routes = [], routeTool = null, overlay, selectedInstanceId, ghostCells, ghostLegal,
  thermalSnapshot, onCellActivate, onRouteCell = () => {},
}: {
  chassis: ChassisSpec;
  parts: PlacedPart[];
  routes?: RouteCell[];
  routeTool?: RouteKind | null;
  overlay: OverlayMode;
  selectedInstanceId: string | null;
  /** Cells the armed part would occupy; empty when nothing is armed. */
  ghostCells: { x: number; y: number }[];
  ghostLegal: boolean;
  thermalSnapshot: Record<string, number> | null;
  onCellActivate: (x: number, y: number) => void;
  onRouteCell?: (x: number, y: number) => void;
}) {
  // The sim owns this mapping; both this and DamageGrid had a copy of it.
  const occupancy = useMemo(() => buildOccupancyMap(parts).byCell, [parts]);
  const spatial = useMemo(
    () => buildSpatialOccupancy(chassis, { parts, routes }),
    [chassis, parts, routes],
  );
  const workshopLayout = useMemo(() => resolveWorkshopLayout(chassis), [chassis]);

  const spatialPower = useMemo(
    () => resolveSpatialPower(chassis, { chassisId: chassis.id, parts, routes, powerPriority: [] }),
    [chassis, parts, routes],
  );
  const powered = useMemo(
    () => connectedInstanceIds(chassis, { chassisId: chassis.id, parts, routes, powerPriority: [] }),
    [chassis, parts, routes],
  );
  const thermalPaths = useMemo(
    () => resolveThermalPaths(chassis, { parts, routes }),
    [chassis, parts, routes],
  );

  const coreRegionId = chassis.coreCell.regionId
    ?? regionIdAt(chassis, chassis.coreCell.x, chassis.coreCell.y)
    ?? 'body';

  function portEndpointAccepts(kind: RouteKind, ref: Parameters<typeof spatialCellKey>[1]): boolean {
    const key = spatialCellKey(chassis, ref);
    if (spatial.routesByCell.get(key)?.has(kind)) return true;
    const stack = spatial.stacksByCell.get(key) ?? [];
    // Any equipment fitted over an electrical port can consume from that
    // socket. Thermal ports still require explicitly heat-transfer equipment.
    if (kind === 'wire') return stack.length > 0;
    return stack.some((entry) => {
      const def = getPart(entry.partId);
      return Boolean(def.spatial?.transfersHeat || def.isHeatPipe);
    });
  }

  function routeDirections(kind: RouteKind, regionId: string, x: number, y: number): Set<RouteDirection> {
    const directions = new Set<RouteDirection>();
    for (const neighbor of ROUTE_NEIGHBORS) {
      const neighborRef = { regionId, x: x + neighbor.dx, y: y + neighbor.dy };
      const neighborKey = spatialCellKey(chassis, neighborRef);
      const connectsToRoute = spatial.routesByCell.get(neighborKey)?.has(kind);
      const connectsToEquipment = (spatial.stacksByCell.get(neighborKey)?.length ?? 0) > 0;
      const connectsToCore = neighborRef.regionId === coreRegionId
        && neighborRef.x === chassis.coreCell.x && neighborRef.y === chassis.coreCell.y;
      if (connectsToRoute || connectsToEquipment || connectsToCore) {
        directions.add(neighbor.direction);
      }
    }

    const currentKey = spatialCellKey(chassis, { regionId, x, y });
    for (const port of chassis.ports ?? []) {
      const aKey = spatialCellKey(chassis, port.a);
      const bKey = spatialCellKey(chassis, port.b);
      const other = currentKey === aKey ? port.b : currentKey === bKey ? port.a : null;
      if (!other || !portEndpointAccepts(kind, other)) continue;
      const hereLayout = workshopLayout.cells.get(`${x},${y}`);
      const otherLayout = workshopLayout.cells.get(`${other.x},${other.y}`);
      if (!hereLayout || !otherLayout) continue;
      const dx = (otherLayout.column + otherLayout.offsetX) - (hereLayout.column + hereLayout.offsetX);
      const dy = (otherLayout.row + otherLayout.offsetY) - (hereLayout.row + hereLayout.offsetY);
      if (Math.abs(dx) > Math.abs(dy)) directions.add(dx > 0 ? 'right' : 'left');
      else directions.add(dy > 0 ? 'down' : 'up');
    }
    return directions;
  }

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
  const routePointerHandled = useRef(false);
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
      const layoutCell = workshopLayout.cells.get(key);

      if (!inMask || !layoutCell) {
        // Off-mask positions still occupy a grid slot, so they carry role=gridcell
        // -- a row's children must all be gridcells -- but are hidden and
        // untabbable, since there is nothing there to interact with.
        cells.push(
          <span
            key={key}
            className="cell void"
            role="gridcell"
            aria-hidden="true"
            style={{ display: 'none' }}
          />,
        );
        continue;
      }

      const isCore = x === chassis.coreCell.x && y === chassis.coreCell.y;
      const stack = spatial.stacksByProjectedCell.get(key) ?? [];
      const occ = stack[stack.length - 1] ?? occupancy.get(key);
      const classes = ['cell'];
      const style: CSSProperties = {
        gridColumn: layoutCell.column,
        gridRow: layoutCell.row,
        ...(layoutCell.offsetX || layoutCell.offsetY
          ? { transform: `translate(${layoutCell.offsetX * 100}%, ${layoutCell.offsetY * 100}%)` }
          : {}),
      };
      let label = `column ${x + 1}, row ${y + 1}, `;
      const regionId = regionIdAt(chassis, x, y);
      const cellRef = { regionId: regionId ?? undefined, x, y };
      const routeKinds = regionId
        ? spatial.routesByCell.get(spatialCellKey(chassis, cellRef))
        : undefined;
      if (regionId && chassis.regions) {
        classes.push('regional');
        label += `${chassis.regions.find((region) => region.id === regionId)?.name ?? regionId}, `;
      }
      const exterior = isExteriorCell(chassis, cellRef);
      if (exterior) {
        classes.push('exterior');
        label += 'exterior cooling, ';
      }
      const locationEffects = (chassis.locationZones ?? [])
        .filter((zone) => zone.cells.some((cell) =>
          spatialCellKey(chassis, cell) === spatialCellKey(chassis, cellRef)))
        .map((zone) => zone.effect);
      if (locationEffects.length > 0) {
        classes.push('location-effect');
        label += `${locationEffects.map((effect) => effect.name).join(', ')}, `;
      }
      if (isPortCell(chassis, cellRef)) {
        classes.push('port');
        const cellSpatialKey = spatialCellKey(chassis, cellRef);
        const electricalPort = (chassis.ports ?? []).find((port) =>
          spatialCellKey(chassis, port.a) === cellSpatialKey
          || spatialCellKey(chassis, port.b) === cellSpatialKey);
        const endpointEnergized = (endpoint: Parameters<typeof spatialCellKey>[1]) => {
          const endpointKey = spatialCellKey(chassis, endpoint);
          if (spatialPower?.energizedWireCells.has(endpointKey)) return true;
          return (spatial.stacksByCell.get(endpointKey) ?? [])
            .some((entry) => powered.has(entry.instanceId));
        };
        const live = electricalPort
          ? endpointEnergized(electricalPort.a) && endpointEnergized(electricalPort.b)
          : false;
        classes.push(live ? 'port-live' : 'port-idle');
        label += `port, electrical link ${live ? 'energized' : 'idle'}, `;
      }

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
        if (spatialPower?.bottleneckInstanceIds.includes(occ.instanceId)) {
          classes.push('bottleneck');
          label += 'electrical bottleneck, ';
        }
        if (overlay === 'thermal' && thermalPaths.radiatorLinkedInstanceIds.has(occ.instanceId)) {
          classes.push('radiator-linked');
          label += 'thermal path reaches a radiator, ';
        }
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
      if (routeKinds?.has('wire') && routeKinds.has('coolant')) {
        classes.push('route-both');
        label += `, ${spatialPower?.energizedWireCells.has(spatialCellKey(chassis, cellRef)) ? 'energized' : 'stranded'} bus and ${thermalPaths.radiatorLinkedCoolantCells.has(spatialCellKey(chassis, cellRef)) ? 'radiator-linked' : 'isolated'} heat-pipe routes`;
      } else if (routeKinds?.has('wire')) {
        classes.push('route-wire');
        label += `, ${spatialPower?.energizedWireCells.has(spatialCellKey(chassis, cellRef)) ? 'energized' : 'stranded'} bus route`;
      } else if (routeKinds?.has('coolant')) {
        classes.push('route-coolant');
        label += `, ${thermalPaths.radiatorLinkedCoolantCells.has(spatialCellKey(chassis, cellRef)) ? 'radiator-linked' : 'isolated'} heat-pipe route`;
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
          data-region={regionId ?? undefined}
          aria-label={label}
          style={style}
          // Route painting starts on pointer-down so dragging can continue through
          // neighbouring cells. Click remains a keyboard/touch fallback, but is
          // consumed after a handled pointer-down so release cannot toggle twice.
          onClick={() => {
            if (!routeTool) {
              onCellActivate(x, y);
            } else if (routePointerHandled.current) {
              routePointerHandled.current = false;
            } else {
              onRouteCell(x, y);
            }
          }}
          onPointerDown={(event) => {
            if (!routeTool || event.button !== 0) return;
            event.preventDefault();
            routePointerHandled.current = true;
            onRouteCell(x, y);
          }}
          onPointerCancel={() => { routePointerHandled.current = false; }}
          onPointerEnter={(event) => {
            // A browser may emit pointer-enter while moving the pointer into the
            // pressed cell, before pointer-down reaches React. Only extend a drag
            // after this plate has handled its starting press.
            if (routeTool && routePointerHandled.current && event.buttons === 1) {
              onRouteCell(x, y);
            }
          }}
        >
          {exterior && <span className="cell-trait exterior-trait" aria-hidden="true" />}
          {locationEffects.length > 0 && <span className="cell-trait location-trait" aria-hidden="true">⌒</span>}
          {regionId && routeKinds?.has('wire') && (
            <RoutePath
              kind="wire"
              directions={routeDirections('wire', regionId, x, y)}
              energized={spatialPower?.energizedWireCells.has(spatialCellKey(chassis, { regionId, x, y })) ?? false}
            />
          )}
          {regionId && routeKinds?.has('coolant') && (
            <RoutePath
              kind="coolant"
              directions={routeDirections('coolant', regionId, x, y)}
              energized={thermalPaths.radiatorLinkedCoolantCells.has(spatialCellKey(chassis, { regionId, x, y }))}
            />
          )}
        </button>,
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
        style={{
          gridTemplateColumns: `repeat(${workshopLayout.width}, var(--cell))`,
          gridTemplateRows: `repeat(${workshopLayout.height}, var(--cell))`,
          // --plate-cols feeds the responsive --cell in App.css (docs/14 §5).
          '--plate-cols': workshopLayout.width,
        } as CSSProperties}
      >
        {(chassis.ports?.length ?? 0) > 0 && (
          <svg
            className="port-links"
            aria-hidden="true"
            viewBox={`0 0 ${workshopLayout.width * 100} ${workshopLayout.height * 100}`}
            preserveAspectRatio="none"
          >
            {chassis.ports?.map((port) => {
              const a = workshopLayout.cells.get(`${port.a.x},${port.a.y}`);
              const b = workshopLayout.cells.get(`${port.b.x},${port.b.y}`);
              if (!a || !b) return null;
              return (
                <line
                  key={port.id}
                  className="port-link"
                  x1={(a.column - 0.5 + a.offsetX) * 100}
                  y1={(a.row - 0.5 + a.offsetY) * 100}
                  x2={(b.column - 0.5 + b.offsetX) * 100}
                  y2={(b.row - 0.5 + b.offsetY) * 100}
                />
              );
            })}
          </svg>
        )}
        {rows}
        {workshopLayout.regions.length > 0 && parts.length === 0 && ghostCells.length === 0 && (
          <div
            className="region-labels"
            aria-hidden="true"
            style={{
              gridTemplateColumns: `repeat(${workshopLayout.width}, var(--cell))`,
              gridTemplateRows: `repeat(${workshopLayout.height}, var(--cell))`,
            }}
          >
            {workshopLayout.regions.map((region) => (
              <span
                className="region-label"
                key={region.id}
                style={{
                  gridColumn: `${region.columnStart} / ${region.columnEnd}`,
                  gridRow: `${region.rowStart} / ${region.rowEnd}`,
                  ...(region.offsetPercentX || region.offsetPercentY
                    ? { transform: `translate(${region.offsetPercentX}%, ${region.offsetPercentY}%)` }
                    : {}),
                }}
              >
                <span>{region.name}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      {/* Hidden once a ghost is on the plate: mid-placement the instruction is
          already being followed, and it prints over the thing being aimed. */}
      {parts.length === 0 && ghostCells.length === 0 && (
        <p className="empty-hint">
          Empty chassis.<br />Start with a reactor — open Parts.
        </p>
      )}
      <p className="plate-caption">
        {OVERLAY_CAPTION[overlay]} · cyan corner = exterior · ⌒ = location bonus
      </p>
    </div>
  );
}
