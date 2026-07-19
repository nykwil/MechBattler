import { useCallback, useMemo, useReducer } from 'react';
import {
  CHASSIS,
  CORE_INSTANCE_ID,
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
  placeExtras: Pick<PlacedPart, 'integrity' | 'modifiers' | 'variant'>;
  /** Placed part selected for inspection/removal. */
  selectedInstanceId: string | null;
  rotation: Rotation;
  overlay: OverlayMode;
  nextSeq: number;
}

type Action =
  | { type: 'SET_CHASSIS'; chassisId: string }
  | { type: 'SELECT_PART'; partId: string | null; extras?: Partial<Pick<PlacedPart, 'integrity' | 'modifiers' | 'variant'>> }
  | { type: 'SET_INTEGRITY'; instanceId: string; integrity: number }
  | { type: 'APPLY_MODIFIER'; instanceId: string; modifierId: string }
  | { type: 'SELECT_INSTANCE'; instanceId: string | null }
  | { type: 'ROTATE' }
  | { type: 'PLACE'; x: number; y: number }
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

function initialState(chassisId: string): EditorState {
  return {
    chassisId, parts: [], powerPriority: [CORE_INSTANCE_ID],
    selectedPartId: null, placeExtras: { integrity: 1 }, selectedInstanceId: null, rotation: 0, overlay: 'parts', nextSeq: 1,
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
      };
    case 'SET_INTEGRITY':
      return {
        ...state,
        parts: state.parts.map((p) =>
          p.instanceId === action.instanceId ? { ...p, integrity: action.integrity } : p),
      };
    case 'APPLY_MODIFIER':
      // Machinist (docs/04 §4b): one mod per part, permanent.
      return {
        ...state,
        parts: state.parts.map((p) =>
          p.instanceId === action.instanceId && !p.modifiers?.includes(action.modifierId)
            ? { ...p, modifiers: [...(p.modifiers ?? []), action.modifierId] }
            : p),
      };
    case 'SELECT_INSTANCE':
      return {
        ...state,
        selectedInstanceId: state.selectedInstanceId === action.instanceId ? null : action.instanceId,
        selectedPartId: null,
      };
    case 'ROTATE':
      return { ...state, rotation: nextRotation(state.rotation) };
    case 'SET_OVERLAY':
      return { ...state, overlay: action.overlay };
    case 'PLACE': {
      if (!state.selectedPartId) return state;
      const chassis = getChassis(state.chassisId);
      const partDef = getPart(state.selectedPartId);
      const instanceId = `${state.selectedPartId}-${state.nextSeq}`;
      const candidate: PlacedPart = {
        instanceId, partId: state.selectedPartId,
        origin: { x: action.x, y: action.y }, rotation: state.rotation, ...state.placeExtras,
      };
      const error = checkPlacement(chassis, state.parts, candidate, partDef);
      if (error) return state;
      const powerPriority = drawsFromReactorPriority(state.selectedPartId)
        ? [...state.powerPriority, instanceId]
        : state.powerPriority;
      return { ...state, parts: [...state.parts, candidate], powerPriority, nextSeq: state.nextSeq + 1 };
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
    selectPart: (id: string | null, extras?: Partial<Pick<PlacedPart, 'integrity' | 'modifiers' | 'variant'>>) =>
      dispatch({ type: 'SELECT_PART', partId: id, extras }),
    setIntegrity: (instanceId: string, integrity: number) => dispatch({ type: 'SET_INTEGRITY', instanceId, integrity }),
    applyModifier: (instanceId: string, modifierId: string) => dispatch({ type: 'APPLY_MODIFIER', instanceId, modifierId }),
    selectInstance: (id: string | null) => dispatch({ type: 'SELECT_INSTANCE', instanceId: id }),
    rotate: () => dispatch({ type: 'ROTATE' }),
    place: (x: number, y: number) => dispatch({ type: 'PLACE', x, y }),
    remove: (instanceId: string) => dispatch({ type: 'REMOVE', instanceId }),
    addParts: (parts: PlacedPart[]) => dispatch({ type: 'ADD_PARTS', parts }),
    loadBuild: (b: Build) => dispatch({ type: 'LOAD_BUILD', build: b }),
    movePriority: (instanceId: string, direction: -1 | 1) => dispatch({ type: 'MOVE_PRIORITY', instanceId, direction }),
    setOverlay: (overlay: OverlayMode) => dispatch({ type: 'SET_OVERLAY', overlay }),
    checkCandidate,
    previewCells,
  };
}
