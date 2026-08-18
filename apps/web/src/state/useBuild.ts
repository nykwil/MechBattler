import { useCallback, useMemo, useReducer } from 'react';
import {
  CHASSIS,
  CORE_INSTANCE_ID,
  MODIFIERS,
  checkPlacement,
  checkRoutePlacement,
  checkSpatialPartPlacement,
  getChassis,
  getOccupiedCells,
  competesForPowerBudget,
  getPart,
  regionIdAt,
  spatialCellKey,
  type CellRef,
  type Build,
  type PlacedPart,
  type PlacementError,
  type Rotation,
  type RouteCell,
  type RouteKind,
} from '@mechbattler/sim';

export type OverlayMode = 'parts' | 'power' | 'thermal';

interface EditorState {
  chassisId: string;
  parts: PlacedPart[];
  routes: RouteCell[];
  chassisIntegrity: number;
  powerPriority: string[];
  /** Palette part armed for placement. Mutually exclusive with selectedInstanceId. */
  selectedPartId: string | null;
  /** What the next placement lands with (pristine from the palette; the bench pool passes salvage state). */
  placeExtras: Pick<PlacedPart, 'integrity' | 'modifiers' | 'variant'> & { instanceId?: string };
  /** Placed part selected for inspection/removal. */
  selectedInstanceId: string | null;
  /**
   * Where the armed part's ghost currently sits (docs/14 §6). Arming a part
   * does not place it: the ghost is aimed by tapping a cell or nudging with the
   * arrow keys, and only an explicit commit writes it into `parts`. Null exactly
   * when nothing is armed.
   */
  ghost: CellRef | null;
  /**
   * Set while the armed part came off the plate via detach (docs/14 §7). The
   * part keeps its identity across the round trip, so re-placing is a move
   * rather than a copy, and backing out has nothing to return to -- which is why
   * the armed bar reads Discard instead of Cancel. `priorityIndex` remembers
   * where it sat in the brownout order so a move does not silently demote it.
   */
  detached: { instanceId: string; priorityIndex: number | null } | null;
  rotation: Rotation;
  overlay: OverlayMode;
  routeTool: RouteKind | null;
  nextSeq: number;
}

type Action =
  | { type: 'SET_CHASSIS'; chassisId: string }
  | { type: 'SELECT_PART'; partId: string | null; extras?: Partial<Pick<PlacedPart, 'integrity' | 'modifiers' | 'variant'> & { instanceId: string }> }
  | { type: 'SET_INTEGRITY'; instanceId: string; integrity: number }
  | { type: 'SET_CHASSIS_INTEGRITY'; integrity: number }
  | { type: 'APPLY_MODIFIER'; instanceId: string; modifierId: string }
  | { type: 'SELECT_INSTANCE'; instanceId: string | null }
  | { type: 'ROTATE' }
  | { type: 'DETACH'; instanceId: string }
  | { type: 'AIM'; x: number; y: number }
  | { type: 'NUDGE'; dx: number; dy: number }
  | { type: 'PLACE' }
  | { type: 'REMOVE'; instanceId: string }
  | { type: 'ADD_PARTS'; parts: PlacedPart[] }
  | { type: 'LOAD_BUILD'; build: Build }
  | { type: 'MOVE_PRIORITY'; instanceId: string; direction: -1 | 1 }
  | { type: 'SET_OVERLAY'; overlay: OverlayMode }
  | { type: 'SET_ROUTE_TOOL'; kind: RouteKind | null }
  | { type: 'PLACE_ROUTE'; x: number; y: number };

/** The sim's rule for what can be shed, so the list holds no inert entries. */
const drawsFromReactorPriority = (partId: string) => competesForPowerBudget(getPart(partId));

function nextRotation(r: Rotation): Rotation {
  return ((r + 90) % 360) as Rotation;
}

/** Footprint of a part at a rotation, in cells. */
function dims(partId: string, rotation: Rotation): { w: number; h: number } {
  const cells = getOccupiedCells(
    { instanceId: '__dims__', partId, origin: { x: 0, y: 0 }, rotation, integrity: 1 },
    getPart(partId),
  );
  return {
    w: Math.max(...cells.map((c) => c.x)) + 1,
    h: Math.max(...cells.map((c) => c.y)) + 1,
  };
}

function placementErrorAt(
  chassisId: string,
  parts: PlacedPart[],
  routes: RouteCell[],
  partId: string,
  rotation: Rotation,
  origin: CellRef,
): PlacementError | null {
  const chassis = getChassis(chassisId);
  const partDef = getPart(partId);
  const candidate: PlacedPart = {
    instanceId: '__preview__', partId, origin, rotation, integrity: 1,
  };
  const base = checkPlacement(chassis, parts, candidate, partDef);
  if (base && base.reason !== 'overlap') return base;
  return checkSpatialPartPlacement(chassis, { parts, routes }, candidate, partDef);
}

/**
 * Finds the legal origin nearest a centred tap. Prefer the region actually
 * tapped, so aiming at a shoulder cannot silently throw the part into the body.
 */
function nearestLegalGhost(
  chassisId: string,
  partId: string,
  rotation: Rotation,
  targetX: number,
  targetY: number,
): CellRef | null {
  const chassis = getChassis(chassisId);
  const { w, h } = dims(partId, rotation);
  const desiredX = Math.max(0, Math.min(chassis.width - w, targetX - (w >> 1)));
  const desiredY = Math.max(0, Math.min(chassis.height - h, targetY - (h >> 1)));
  const preferredRegion = regionIdAt(chassis, targetX, targetY);
  const legal: Array<CellRef & { distance: number; preferred: boolean }> = [];

  for (let y = 0; y <= chassis.height - h; y += 1) {
    for (let x = 0; x <= chassis.width - w; x += 1) {
      const regionId = regionIdAt(chassis, x, y);
      if (!regionId) continue;
      const origin = { regionId, x, y };
      // Snap only around fixed chassis geometry. Existing equipment and routes
      // must not make a tap teleport to some unrelated free cell: landing on an
      // occupied cell should still show the useful overlap/stacking reason.
      if (placementErrorAt(chassisId, [], [], partId, rotation, origin)) continue;
      legal.push({
        ...origin,
        distance: Math.abs(x - desiredX) + Math.abs(y - desiredY),
        preferred: regionId === preferredRegion,
      });
    }
  }

  legal.sort((a, b) => Number(b.preferred) - Number(a.preferred)
    || a.distance - b.distance || a.y - b.y || a.x - b.x);
  const best = legal[0];
  return best ? { regionId: best.regionId, x: best.x, y: best.y } : null;
}

/**
 * Where a freshly armed part's ghost starts (docs/14 §6). Row-major first legal
 * origin, so the ghost lands somewhere it can actually be committed and the
 * Place button is live immediately. Falls back to the chassis origin when the
 * build has no room left — the ghost still shows, and Place stays disabled with
 * the reason, which is the honest state rather than refusing to arm.
 */
function firstLegalGhost(
  chassisId: string,
  parts: PlacedPart[],
  routes: RouteCell[],
  partId: string,
  rotation: Rotation,
): CellRef | null {
  const chassis = getChassis(chassisId);
  for (let y = 0; y < chassis.height; y += 1) {
    for (let x = 0; x < chassis.width; x += 1) {
      const origin = { regionId: regionIdAt(chassis, x, y) ?? undefined, x, y };
      if (!placementErrorAt(chassisId, parts, routes, partId, rotation, origin)) {
        return origin;
      }
    }
  }
  return null;
}

function defaultPlacement(
  chassisId: string,
  parts: PlacedPart[],
  routes: RouteCell[],
  partId: string,
): { ghost: CellRef; rotation: Rotation } {
  const chassis = getChassis(chassisId);
  // Keep the authored orientation when possible. If it cannot fit anywhere,
  // rotate automatically rather than arming an illegal seam-crossing ghost.
  for (const rotation of [0, 90, 180, 270] as Rotation[]) {
    const ghost = firstLegalGhost(chassisId, parts, routes, partId, rotation);
    if (ghost) return { ghost, rotation };
  }
  // No legal origin: still show the ghost so Place can explain itself (docs/14
  // §6). It must land on a masked cell -- {0,0} is off-mask on most chassis, and
  // the plate only renders ghost cells that exist, so the ghost would vanish and
  // the player would arm a part and see nothing.
  for (let y = 0; y < chassis.height; y += 1) {
    for (let x = 0; x < chassis.width; x += 1) {
      if (chassis.mask[y]?.[x]) {
        return {
          ghost: { regionId: regionIdAt(chassis, x, y) ?? undefined, x, y },
          rotation: 0,
        };
      }
    }
  }
  return { ghost: { x: 0, y: 0 }, rotation: 0 };
}

function initialState(chassisId: string): EditorState {
  return {
    chassisId, parts: [], routes: [], chassisIntegrity: 1, powerPriority: [CORE_INSTANCE_ID],
    selectedPartId: null, placeExtras: { integrity: 1 }, selectedInstanceId: null,
    ghost: null, detached: null, rotation: 0, overlay: 'parts', routeTool: null, nextSeq: 1,
  };
}

function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'SET_CHASSIS':
      return initialState(action.chassisId);
    case 'SELECT_PART':
      const placement = action.partId
        ? defaultPlacement(state.chassisId, state.parts, state.routes, action.partId)
        : null;
      return {
        ...state, selectedPartId: action.partId,
        placeExtras: { integrity: 1, ...action.extras },
        selectedInstanceId: null, rotation: placement?.rotation ?? 0,
        // Arming shows a ghost; disarming clears it. docs/14 §6.
        ghost: placement?.ghost ?? null,
        detached: null,
        routeTool: null,
      };
    case 'SET_INTEGRITY':
      return {
        ...state,
        parts: state.parts.map((p) =>
          p.instanceId === action.instanceId ? { ...p, integrity: action.integrity } : p),
      };
    case 'SET_CHASSIS_INTEGRITY':
      return { ...state, chassisIntegrity: Math.max(0, Math.min(1, action.integrity)) };
    case 'APPLY_MODIFIER':
      // Machinist (docs/04 §4b): one mod per part, permanent.
      const incoming = MODIFIERS[action.modifierId];
      if (!incoming) return state;
      const buildCopies = state.parts.reduce(
        (count, p) => count + (p.modifiers?.filter((id) => id === action.modifierId).length ?? 0), 0,
      );
      return {
        ...state,
        parts: state.parts.map((p) =>
          p.instanceId === action.instanceId &&
            !p.modifiers?.includes(action.modifierId) &&
            !(incoming.kind === 'mod' && p.modifiers?.some((id) => MODIFIERS[id]?.kind === 'mod')) &&
            (incoming.maxCopiesPerBuild === undefined || buildCopies < incoming.maxCopiesPerBuild)
            ? { ...p, modifiers: [...(p.modifiers ?? []), action.modifierId] }
            : p),
      };
    case 'SELECT_INSTANCE':
      return {
        ...state,
        selectedInstanceId: state.selectedInstanceId === action.instanceId ? null : action.instanceId,
        selectedPartId: null,
        ghost: null,
        detached: null,
        routeTool: null,
      };
    case 'ROTATE': {
      // The ghost holds its origin through a rotation, so Rotate reads as
      // turning the part in place rather than moving it -- but the footprint
      // swaps axes, so re-clamp or a part near an edge rotates off the chassis.
      const rotation = nextRotation(state.rotation);
      if (!state.selectedPartId || !state.ghost) return { ...state, rotation };
      const chassis = getChassis(state.chassisId);
      const { w, h } = dims(state.selectedPartId, rotation);
      return {
        ...state,
        rotation,
        ghost: {
          ...(() => {
            const x = Math.max(0, Math.min(chassis.width - w, state.ghost.x));
            const y = Math.max(0, Math.min(chassis.height - h, state.ghost.y));
            return { regionId: regionIdAt(chassis, x, y) ?? undefined, x, y };
          })(),
        },
      };
    }
    case 'DETACH': {
      // Off the plate and into the placement state holding it: move, rotate,
      // place. Rotate-in-place and remove-in-place do not exist, because
      // detach-then-rotate and detach-then-discard already do both jobs in a
      // state that has to exist anyway (docs/14 §7).
      const placed = state.parts.find((p) => p.instanceId === action.instanceId);
      if (!placed) return state;
      const priorityIndex = state.powerPriority.indexOf(action.instanceId);
      return {
        ...state,
        parts: state.parts.filter((p) => p.instanceId !== action.instanceId),
        powerPriority: state.powerPriority.filter((id) => id !== action.instanceId),
        selectedPartId: placed.partId,
        // Integrity, modifiers, and variant ride along, and the preserved
        // instanceId is what makes re-placing consume no new instance.
        placeExtras: {
          instanceId: placed.instanceId,
          integrity: placed.integrity,
          modifiers: placed.modifiers,
          variant: placed.variant,
        },
        selectedInstanceId: null,
        ghost: { ...placed.origin },
        rotation: placed.rotation,
        detached: {
          instanceId: placed.instanceId,
          priorityIndex: priorityIndex === -1 ? null : priorityIndex,
        },
      };
    }
    case 'AIM': {
      // Centre the ghost on the tapped cell where possible, clamped to the
      // chassis -- the prototype's behaviour, and the point of it is touch: your
      // fingertip covers the target, so a part larger than one cell must appear
      // under the finger rather than offset down and right by its own size.
      if (!state.selectedPartId) return state;
      const chassis = getChassis(state.chassisId);
      const { w, h } = dims(state.selectedPartId, state.rotation);
      const legal = nearestLegalGhost(
        state.chassisId,
        state.selectedPartId,
        state.rotation,
        action.x,
        action.y,
      );
      if (legal) return { ...state, ghost: legal };
      const x = Math.max(0, Math.min(chassis.width - w, action.x - (w >> 1)));
      const y = Math.max(0, Math.min(chassis.height - h, action.y - (h >> 1)));
      return {
        ...state,
        ghost: {
          regionId: regionIdAt(chassis, x, y) ?? undefined,
          x,
          y,
        },
      };
    }
    case 'NUDGE': {
      // Arrow keys are the keyboard's equivalent of tapping a cell (docs/14 §6);
      // a keyboard has no cell to tap, which is why no on-screen nudge pad exists.
      if (!state.selectedPartId || !state.ghost) return state;
      const chassis = getChassis(state.chassisId);
      // Clamp the whole footprint, not the origin: width - 1 would let a 2x2 part
      // be walked until its far column hung off the chassis.
      const { w, h } = dims(state.selectedPartId, state.rotation);
      return {
        ...state,
        ghost: {
          ...(() => {
            const x = Math.min(Math.max(state.ghost.x + action.dx, 0), chassis.width - w);
            const y = Math.min(Math.max(state.ghost.y + action.dy, 0), chassis.height - h);
            return { regionId: regionIdAt(chassis, x, y) ?? undefined, x, y };
          })(),
        },
      };
    }
    case 'SET_OVERLAY':
      return { ...state, overlay: action.overlay };
    case 'SET_ROUTE_TOOL':
      return {
        ...state,
        routeTool: action.kind,
        selectedPartId: null,
        selectedInstanceId: null,
        ghost: null,
        detached: null,
      };
    case 'PLACE_ROUTE': {
      if (!state.routeTool) return state;
      const chassis = getChassis(state.chassisId);
      const route: RouteCell = {
        kind: state.routeTool,
        regionId: regionIdAt(chassis, action.x, action.y) ?? undefined,
        x: action.x,
        y: action.y,
      };
      const routeKey = spatialCellKey(chassis, route);
      const existing = state.routes.find((candidate) =>
        candidate.kind === route.kind && spatialCellKey(chassis, candidate) === routeKey);
      if (existing) {
        return {
          ...state,
          routes: state.routes.filter((candidate) => candidate !== existing),
        };
      }
      if (checkRoutePlacement(chassis, { parts: state.parts, routes: state.routes }, route)) return state;
      return { ...state, routes: [...state.routes, route] };
    }
    case 'PLACE': {
      if (!state.selectedPartId || !state.ghost) return state;
      const chassis = getChassis(state.chassisId);
      const partDef = getPart(state.selectedPartId);
      const instanceId = state.placeExtras.instanceId ?? `${state.selectedPartId}-${state.nextSeq}`;
      const { instanceId: _preservedId, ...partExtras } = state.placeExtras;
      const candidate: PlacedPart = {
        instanceId, partId: state.selectedPartId,
        origin: { ...state.ghost }, rotation: state.rotation, ...partExtras,
      };
      const baseError = checkPlacement(chassis, state.parts, candidate, partDef);
      const spatialError = checkSpatialPartPlacement(
        chassis,
        { parts: state.parts, routes: state.routes },
        candidate,
        partDef,
      );
      if ((baseError && baseError.reason !== 'overlap') || spatialError) return state;
      const stampedCells = new Set(
        getOccupiedCells(candidate, partDef).map((cell) => spatialCellKey(chassis, cell)),
      );
      let powerPriority = state.powerPriority;
      if (drawsFromReactorPriority(state.selectedPartId)) {
        const restoreAt = state.detached?.priorityIndex;
        if (restoreAt !== null && restoreAt !== undefined) {
          // A detach-and-replace is a move, so the part returns to its old rank
          // rather than being demoted to the bottom of the brownout order.
          powerPriority = [
            ...state.powerPriority.slice(0, restoreAt),
            instanceId,
            ...state.powerPriority.slice(restoreAt),
          ];
        } else {
          powerPriority = [...state.powerPriority, instanceId];
        }
      }
      return {
        ...state,
        parts: [...state.parts, candidate],
        routes: state.routes.filter((route) => !stampedCells.has(spatialCellKey(chassis, route))),
        powerPriority,
        detached: null,
        nextSeq: state.placeExtras.instanceId ? state.nextSeq : state.nextSeq + 1,
      };
    }
    case 'ADD_PARTS': {
      // Sim-generated placements (auto-wire): already legal, appended as-is.
      // Conduits draw nothing, so the power priority list is untouched.
      // Idempotent by instanceId: a double-clicked auto-wire dispatches the
      // same conduits twice from a stale closure — the rerun must be a no-op.
      const existing = new Set(state.parts.map((p) => p.instanceId));
      const fresh = action.parts.filter((p) => !existing.has(p.instanceId));
      return fresh.length > 0 ? { ...state, parts: [...state.parts, ...fresh] } : state;
    }
    case 'LOAD_BUILD': {
      // Run flow (docs/10 M1): replace the whole editor state with a build
      // (starter kit or a restored run). nextSeq must clear every numeric
      // `-N` suffix already in the build — a restored run carries editor-
      // generated ids like 'W-MG-9', and reusing a seq would duplicate one.
      const maxSeq = action.build.parts.reduce((max, p) => {
        const m = /-(\d+)$/.exec(p.instanceId);
        return m ? Math.max(max, Number(m[1])) : max;
      }, 0);
      return {
        ...initialState(action.build.chassisId),
        parts: [...action.build.parts],
        routes: [...(action.build.routes ?? [])],
        chassisIntegrity: action.build.chassisIntegrity ?? 1,
        powerPriority: [...action.build.powerPriority],
        nextSeq: Math.max(maxSeq, action.build.parts.length) + 1,
      };
    }
    case 'REMOVE':
      return {
        ...state,
        parts: state.parts.filter((p) => p.instanceId !== action.instanceId),
        powerPriority: state.powerPriority.filter((id) => id !== action.instanceId),
        selectedInstanceId: state.selectedInstanceId === action.instanceId ? null : state.selectedInstanceId,
      };
    case 'MOVE_PRIORITY': {
      const idx = state.powerPriority.indexOf(action.instanceId);
      const target = idx + action.direction;
      if (idx < 0 || target < 0 || target >= state.powerPriority.length) return state;
      const next = [...state.powerPriority];
      [next[idx], next[target]] = [next[target]!, next[idx]!];
      return { ...state, powerPriority: next };
    }
    default:
      return state;
  }
}

export function useBuild(defaultChassisId: string) {
  const [state, dispatch] = useReducer(reducer, defaultChassisId, initialState);

  const chassis = useMemo(() => getChassis(state.chassisId), [state.chassisId]);
  const build: Build = useMemo(
    () => ({
      chassisId: state.chassisId,
      parts: state.parts,
      routes: state.routes,
      chassisIntegrity: state.chassisIntegrity,
      powerPriority: state.powerPriority,
    }),
    [state.chassisId, state.parts, state.routes, state.chassisIntegrity, state.powerPriority],
  );

  const checkCandidate = useCallback(
    (x: number, y: number): PlacementError | null => {
      if (!state.selectedPartId) return null;
      return placementErrorAt(
        chassis.id,
        state.parts,
        state.routes,
        state.selectedPartId,
        state.rotation,
        { regionId: regionIdAt(chassis, x, y) ?? undefined, x, y },
      );
    },
    [chassis, state.parts, state.routes, state.selectedPartId, state.rotation],
  );

  const previewCells = useCallback(
    (x: number, y: number): { x: number; y: number }[] => {
      if (!state.selectedPartId) return [];
      const partDef = getPart(state.selectedPartId);
      return getOccupiedCells(
        {
          instanceId: '__preview__',
          partId: state.selectedPartId,
          origin: { regionId: regionIdAt(chassis, x, y) ?? undefined, x, y },
          rotation: state.rotation,
          integrity: 1,
        },
        partDef,
      );
    },
    [chassis, state.selectedPartId, state.rotation],
  );

  return {
    state, chassis, build,
    chassisOptions: Object.values(CHASSIS),
    setChassis: (id: string) => dispatch({ type: 'SET_CHASSIS', chassisId: id }),
    selectPart: (
      id: string | null,
      extras?: Partial<Pick<PlacedPart, 'integrity' | 'modifiers' | 'variant'> & { instanceId: string }>,
    ) =>
      dispatch({ type: 'SELECT_PART', partId: id, extras }),
    setIntegrity: (instanceId: string, integrity: number) => dispatch({ type: 'SET_INTEGRITY', instanceId, integrity }),
    setChassisIntegrity: (integrity: number) => dispatch({ type: 'SET_CHASSIS_INTEGRITY', integrity }),
    applyModifier: (instanceId: string, modifierId: string) => dispatch({ type: 'APPLY_MODIFIER', instanceId, modifierId }),
    selectInstance: (id: string | null) => dispatch({ type: 'SELECT_INSTANCE', instanceId: id }),
    rotate: () => dispatch({ type: 'ROTATE' }),
    detach: (instanceId: string) => dispatch({ type: 'DETACH', instanceId }),
    aim: (x: number, y: number) => dispatch({ type: 'AIM', x, y }),
    nudge: (dx: number, dy: number) => dispatch({ type: 'NUDGE', dx, dy }),
    place: () => dispatch({ type: 'PLACE' }),
    remove: (instanceId: string) => dispatch({ type: 'REMOVE', instanceId }),
    addParts: (parts: PlacedPart[]) => dispatch({ type: 'ADD_PARTS', parts }),
    loadBuild: (b: Build) => dispatch({ type: 'LOAD_BUILD', build: b }),
    movePriority: (instanceId: string, direction: -1 | 1) => dispatch({ type: 'MOVE_PRIORITY', instanceId, direction }),
    setOverlay: (overlay: OverlayMode) => dispatch({ type: 'SET_OVERLAY', overlay }),
    setRouteTool: (kind: RouteKind | null) => dispatch({ type: 'SET_ROUTE_TOOL', kind }),
    placeRoute: (x: number, y: number) => dispatch({ type: 'PLACE_ROUTE', x, y }),
    checkCandidate,
    previewCells,
  };
}
