import { useCallback, useMemo, useReducer } from 'react';
import {
  CHASSIS,
  CORE_INSTANCE_ID,
  MODIFIERS,
  checkPlacement,
  getChassis,
  getOccupiedCells,
  getPart,
  type Build,
  type PlacedPart,
  type PlacementError,
  type Rotation,
} from '@mechbattler/sim';

export type OverlayMode = 'parts' | 'power' | 'thermal';

interface EditorState {
  chassisId: string;
  parts: PlacedPart[];
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
  ghost: { x: number; y: number } | null;
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
  nextSeq: number;
}

type Action =
  | { type: 'SET_CHASSIS'; chassisId: string }
  | { type: 'SELECT_PART'; partId: string | null; extras?: Partial<Pick<PlacedPart, 'integrity' | 'modifiers' | 'variant'> & { instanceId: string }> }
  | { type: 'SET_INTEGRITY'; instanceId: string; integrity: number }
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
  | { type: 'SET_OVERLAY'; overlay: OverlayMode };

function drawsFromReactorPriority(partId: string): boolean {
  const def = getPart(partId);
  return Boolean(def.draw?.continuousKw || def.draw?.chargedEnergyPerShotKj);
}

function nextRotation(r: Rotation): Rotation {
  return ((r + 90) % 360) as Rotation;
}

/**
 * Where a freshly armed part's ghost starts (docs/14 §6). Row-major first legal
 * origin, so the ghost lands somewhere it can actually be committed and the
 * Place button is live immediately. Falls back to the chassis origin when the
 * build has no room left — the ghost still shows, and Place stays disabled with
 * the reason, which is the honest state rather than refusing to arm.
 */
function defaultGhost(
  chassisId: string,
  parts: PlacedPart[],
  partId: string,
  rotation: Rotation,
): { x: number; y: number } {
  const chassis = getChassis(chassisId);
  const partDef = getPart(partId);
  for (let y = 0; y < chassis.height; y += 1) {
    for (let x = 0; x < chassis.width; x += 1) {
      const candidate: PlacedPart = {
        instanceId: '__ghost__', partId, origin: { x, y }, rotation, integrity: 1,
      };
      if (checkPlacement(chassis, parts, candidate, partDef) === null) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

function initialState(chassisId: string): EditorState {
  return {
    chassisId, parts: [], powerPriority: [CORE_INSTANCE_ID],
    selectedPartId: null, placeExtras: { integrity: 1 }, selectedInstanceId: null,
    ghost: null, detached: null, rotation: 0, overlay: 'parts', nextSeq: 1,
  };
}

function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'SET_CHASSIS':
      return initialState(action.chassisId);
    case 'SELECT_PART':
      return {
        ...state, selectedPartId: action.partId,
        placeExtras: { integrity: 1, ...action.extras },
        selectedInstanceId: null, rotation: 0,
        // Arming shows a ghost; disarming clears it. docs/14 §6.
        ghost: action.partId ? defaultGhost(state.chassisId, state.parts, action.partId, 0) : null,
        detached: null,
      };
    case 'SET_INTEGRITY':
      return {
        ...state,
        parts: state.parts.map((p) =>
          p.instanceId === action.instanceId ? { ...p, integrity: action.integrity } : p),
      };
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
      };
    case 'ROTATE':
      // The ghost holds its origin through a rotation, so Rotate reads as
      // turning the part in place rather than moving it.
      return { ...state, rotation: nextRotation(state.rotation) };
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
        ghost: { x: placed.origin.x, y: placed.origin.y },
        rotation: placed.rotation,
        detached: {
          instanceId: placed.instanceId,
          priorityIndex: priorityIndex === -1 ? null : priorityIndex,
        },
      };
    }
    case 'AIM':
      if (!state.selectedPartId) return state;
      return { ...state, ghost: { x: action.x, y: action.y } };
    case 'NUDGE': {
      // Arrow keys are the keyboard's equivalent of tapping a cell (docs/14 §6);
      // a keyboard has no cell to tap, which is why no on-screen nudge pad exists.
      if (!state.selectedPartId || !state.ghost) return state;
      const chassis = getChassis(state.chassisId);
      return {
        ...state,
        ghost: {
          x: Math.min(Math.max(state.ghost.x + action.dx, 0), chassis.width - 1),
          y: Math.min(Math.max(state.ghost.y + action.dy, 0), chassis.height - 1),
        },
      };
    }
    case 'SET_OVERLAY':
      return { ...state, overlay: action.overlay };
    case 'PLACE': {
      if (!state.selectedPartId || !state.ghost) return state;
      const chassis = getChassis(state.chassisId);
      const partDef = getPart(state.selectedPartId);
      const instanceId = state.placeExtras.instanceId ?? `${state.selectedPartId}-${state.nextSeq}`;
      const { instanceId: _preservedId, ...partExtras } = state.placeExtras;
      const candidate: PlacedPart = {
        instanceId, partId: state.selectedPartId,
        origin: { x: state.ghost.x, y: state.ghost.y }, rotation: state.rotation, ...partExtras,
      };
      const error = checkPlacement(chassis, state.parts, candidate, partDef);
      if (error) return state;
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
    () => ({ chassisId: state.chassisId, parts: state.parts, powerPriority: state.powerPriority }),
    [state.chassisId, state.parts, state.powerPriority],
  );

  const checkCandidate = useCallback(
    (x: number, y: number): PlacementError | null => {
      if (!state.selectedPartId) return null;
      const partDef = getPart(state.selectedPartId);
      const candidate: PlacedPart = {
        instanceId: '__preview__', partId: state.selectedPartId,
        origin: { x, y }, rotation: state.rotation, integrity: 1,
      };
      return checkPlacement(chassis, state.parts, candidate, partDef);
    },
    [chassis, state.parts, state.selectedPartId, state.rotation],
  );

  const previewCells = useCallback(
    (x: number, y: number): { x: number; y: number }[] => {
      if (!state.selectedPartId) return [];
      const partDef = getPart(state.selectedPartId);
      return getOccupiedCells(
        { instanceId: '__preview__', partId: state.selectedPartId, origin: { x, y }, rotation: state.rotation, integrity: 1 },
        partDef,
      );
    },
    [state.selectedPartId, state.rotation],
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
    checkCandidate,
    previewCells,
  };
}
