# Component Height Implementation Plan

**Shipped 25 Aug 2026**, merged as `502cb0f`. All nine tasks landed, plus a
fix wave closing the final review's findings. Kept for the record; the rule
it describes lives in `packages/sim/src/spatial.ts` and the design rationale
in `2026-08-24-component-height-design.md` beside this file.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give parts a height and cells a ceiling, so a gun's lane in front of it can only hold flat equipment, a riser buys you a second gun in that lane, and a chassis can have a low-roofed bay.

**Architecture:** Two authored numbers on `PartSpatialSpec` (`height`, `clearsForward`) and one authored list on `ChassisSpec` (`clearanceZones`). All arithmetic lives in `packages/sim/src/spatial.ts` next to the stack model it reads; enforcement is one block inside the existing `checkSpatialPartPlacement`, which the workshop ghost and whole-build validation already call. `combat.ts` is not touched: a mech that could not be built with a blocked gun never has one.

**Tech Stack:** TypeScript, npm workspaces, vitest. Sim is `packages/sim`, web is `apps/web`.

**Spec:** `docs/superpowers/specs/2026-08-24-component-height-design.md`

## Global Constraints

- **Never copy sim constants into UI code** (CLAUDE.md). Heights and clearances are read from `getPart(...)`/`getChassis(...)`, never typed into a component.
- Forward is `-y`. Lanes are columns of constant `x`. This matches `exposedEquipmentTickets` (`spatial.ts:260`) and is not re-derived.
- Blocking never crosses a region seam: same `regionId` **and** same `x`.
- `apps/web/src/styles/shell.css` and `battle.css` are the prototypes' own stylesheets, kept verbatim. Do not reformat or sweep them if a change lands nearby.
- Balance harnesses are report-only and never gate this work.
- Stock content (`templates.ts`, ladder builds, starter blueprint) is re-authorable. Re-lay it rather than weakening a rule to preserve it.
- Run sim tests with `npm run sim:test`, web tests with `npm run web:test`.
- Commit after every task.

---

### Task 1: The two part fields, and the authored values

Adds data only. No rule reads it yet, so nothing can break.

**Files:**
- Modify: `packages/sim/src/types.ts` (`PartSpatialSpec`, ~line 37)
- Modify: `packages/sim/src/catalog.ts` (weapon and utility entries)
- Modify: `packages/sim/src/spatial.ts` (accessors)
- Test: `packages/sim/test/spatial.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `partHeight(def: PartDef): number` and `forwardClearance(def: PartDef): number | undefined`, both exported from `spatial.ts`.

- [ ] **Step 1: Write the failing test**

Append to `packages/sim/test/spatial.test.ts`:

```ts
import { forwardClearance, partHeight } from '../src/spatial.js';
import { getPart } from '../src/catalog.js';

describe('component height (docs/superpowers/specs/2026-08-24-component-height-design.md)', () => {
  it('defaults an unauthored part to one level and no imposed clearance', () => {
    expect(partHeight(getPart('U-AMMO'))).toBe(1);
    expect(forwardClearance(getPart('U-AMMO'))).toBeUndefined();
  });

  it('stands the big guns three levels tall, clearing one level ahead', () => {
    for (const id of ['W-AC', 'W-RG', 'W-BR', 'W-LAS', 'W-RKT', 'W-ION']) {
      expect(partHeight(getPart(id)), id).toBe(3);
      expect(forwardClearance(getPart(id)), id).toBe(1);
    }
  });

  it('sits the small guns low, and lets nothing at all stand in front of them', () => {
    for (const id of ['W-MG', 'W-CB', 'W-SC']) {
      expect(partHeight(getPart(id)), id).toBe(1);
      expect(forwardClearance(getPart(id)), id).toBe(0);
    }
  });

  it('gives reactors and capacitors two levels, and armour none at all', () => {
    expect(partHeight(getPart('R-C40'))).toBe(2);
    expect(partHeight(getPart('P-CAP'))).toBe(2);
    expect(partHeight(getPart('U-ARM'))).toBe(0);
    expect(partHeight(getPart('U-SHELL'))).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run sim:test -- spatial`
Expected: FAIL — `partHeight` is not exported.

- [ ] **Step 3: Add the fields**

In `packages/sim/src/types.ts`, inside `PartSpatialSpec`, after `stacksOn`:

```ts
  /**
   * Levels this part occupies above the floor of its cell. A weapon's cells are
   * its mounting point, not its barrel, so height is what decides whether the
   * thing in front of it is in the way. See the height design spec.
   */
  height?: number;
  /**
   * The ceiling this part imposes on every cell ahead of it in its own lane,
   * measured from its own base. Authored per weapon rather than derived from
   * height: a low turret wants a clear lane, a hull-down mortar blocks nothing.
   */
  clearsForward?: number;
```

- [ ] **Step 4: Add the accessors**

In `packages/sim/src/spatial.ts`, below `equipmentLayer`:

```ts
/** Levels a part occupies. Unauthored parts are one level. */
export function partHeight(def: PartDef): number {
  return def.spatial?.height ?? 1;
}

/** The ceiling this part imposes forward, or undefined if it imposes none. */
export function forwardClearance(def: PartDef): number | undefined {
  return def.spatial?.clearsForward;
}
```

- [ ] **Step 5: Author the catalog**

In `packages/sim/src/catalog.ts`, add or extend the `spatial` block on each part.

Big guns — `W-AC`, `W-RG`, `W-BR`, `W-LAS`, `W-RKT`, `W-ION`:

```ts
    spatial: { layer: 'payload', height: 3, clearsForward: 1 },
```

Small guns — `W-MG`, `W-CB`, `W-SC` (note `W-MG` already has a `spatial` block with `stacksOn`; extend it, do not replace it):

```ts
    spatial: { layer: 'payload', stacksOn: ['support'], height: 1, clearsForward: 0 },
```

Reactors `R-C40`, `R-C90`, `R-E25`, `R-E60` and capacitors `P-CAP`, `P-CAP2` — add `height: 2` to the existing `spatial` block, creating one if absent.

`U-ARM` and `U-SHELL` — add `height: 0` to the existing `spatial` block. Armour is a skin: it does not raise a silhouette that physically did not change, and giving it a level would make plating a gun illegal wherever the gun already reaches the ceiling.

Everything else is left alone and defaults to 1.

- [ ] **Step 6: Run the test**

Run: `npm run sim:test -- spatial`
Expected: PASS.

- [ ] **Step 7: Run the whole sim suite**

Run: `npm run sim:test`
Expected: PASS. Nothing reads the new fields yet, so a failure here means a catalog entry was mangled, not a rule fired.

- [ ] **Step 8: Commit**

```bash
git add packages/sim/src/types.ts packages/sim/src/catalog.ts packages/sim/src/spatial.ts packages/sim/test/spatial.test.ts
git commit -m "Give every part a height, and every gun the clearance it demands ahead"
```

---

### Task 2: The ceiling arithmetic

Pure functions, tested directly. Still not wired into placement, so still nothing can break.

**Files:**
- Modify: `packages/sim/src/spatial.ts`
- Test: `packages/sim/test/spatial.test.ts`

**Interfaces:**
- Consumes: `partHeight`, `forwardClearance` (Task 1); `buildSpatialOccupancy`, `spatialCellKey`, `resolveCellRef`, `LAYER_ORDER`, `equipmentLayer` (existing).
- Produces:
  - `stackBase(chassis: ChassisSpec, occupancy: SpatialOccupancy, cell: Required<CellRef>, def: PartDef, excludeInstanceId?: string): number`
  - `occupantTop(chassis: ChassisSpec, occupancy: SpatialOccupancy, cell: Required<CellRef>, instanceId: string): number`
  - `cellCeiling(chassis: ChassisSpec, occupancy: SpatialOccupancy, cell: Required<CellRef>, excludeInstanceId?: string): number`

- [ ] **Step 1: Write the failing test**

Append to `packages/sim/test/spatial.test.ts`:

```ts
import { buildSpatialOccupancy, cellCeiling, occupantTop, stackBase } from '../src/spatial.js';
import { getChassis } from '../src/chassis.js';
import type { PlacedPart } from '../src/types.js';

describe('cell ceilings', () => {
  const chassis = getChassis('CH-5'); // Mule, 6x6, body mask rows 2-5
  const cell = (x: number, y: number) => ({ regionId: 'body', x, y });
  const occ = (parts: PlacedPart[]) => buildSpatialOccupancy(chassis, { parts, routes: [] });

  const gun: PlacedPart = {
    instanceId: 'gun', partId: 'W-AC', origin: cell(1, 3), rotation: 0, integrity: 1,
  };

  it('is unbounded where nothing imposes one', () => {
    expect(cellCeiling(chassis, occ([]), cell(1, 2))).toBe(Infinity);
  });

  it('is lowered to a gun clearance in the gun own lane, ahead of it only', () => {
    // W-AC is rect(2,3) at body (1,3): it fills x 1-2, y 3-5.
    const o = occ([gun]);
    expect(cellCeiling(chassis, o, cell(1, 2))).toBe(1);
    expect(cellCeiling(chassis, o, cell(2, 2))).toBe(1);
    // Not in its lanes:
    expect(cellCeiling(chassis, o, cell(3, 2))).toBe(Infinity);
  });

  it('never lets a gun block itself', () => {
    // Excluding the gun is what makes its own front cells placeable.
    const o = occ([gun]);
    expect(cellCeiling(chassis, o, cell(1, 3), 'gun')).toBe(Infinity);
    expect(cellCeiling(chassis, o, cell(1, 4), 'gun')).toBe(Infinity);
  });

  it('does not cross a region seam', () => {
    const o = occ([gun]);
    expect(cellCeiling(chassis, o, { regionId: 'left-shoulder', x: 1, y: 1 })).toBe(Infinity);
  });

  it('reads a stack base from what is already underneath', () => {
    const sink: PlacedPart = {
      instanceId: 'sink', partId: 'U-HS', origin: cell(1, 2), rotation: 0, integrity: 1,
    };
    const o = occ([sink]);
    expect(occupantTop(chassis, o, cell(1, 2), 'sink')).toBe(1);
    expect(stackBase(chassis, o, cell(1, 2), getPart('U-ARM'))).toBe(1);
    expect(stackBase(chassis, o, cell(1, 2), getPart('U-ARM'), 'sink')).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run sim:test -- spatial`
Expected: FAIL — `cellCeiling` is not exported.

- [ ] **Step 3: Implement**

In `packages/sim/src/spatial.ts`, below the accessors from Task 1:

```ts
/**
 * Levels already used beneath a part about to occupy this cell. Occupants at or
 * below the candidate's layer are underneath it: `stacksByCell` is sorted by
 * layer and stable within a layer, so a riser landing on a riser correctly reads
 * a base of one.
 */
export function stackBase(
  chassis: ChassisSpec,
  occupancy: SpatialOccupancy,
  cell: Required<CellRef>,
  def: PartDef,
  excludeInstanceId?: string,
): number {
  const stack = occupancy.stacksByCell.get(spatialCellKey(chassis, cell)) ?? [];
  const order = LAYER_ORDER[equipmentLayer(def)];
  return stack
    .filter((entry) => entry.instanceId !== excludeInstanceId && LAYER_ORDER[entry.layer] <= order)
    .reduce((sum, entry) => sum + partHeight(getPart(entry.partId)), 0);
}

/** The level the top of an already-placed occupant reaches in this cell. */
export function occupantTop(
  chassis: ChassisSpec,
  occupancy: SpatialOccupancy,
  cell: Required<CellRef>,
  instanceId: string,
): number {
  const stack = occupancy.stacksByCell.get(spatialCellKey(chassis, cell)) ?? [];
  const index = stack.findIndex((entry) => entry.instanceId === instanceId);
  if (index < 0) return 0;
  return stack
    .slice(0, index + 1)
    .reduce((sum, entry) => sum + partHeight(getPart(entry.partId)), 0);
}

/**
 * The highest a part may reach in this cell. Weapons behind it in the same lane
 * lower it, because their barrels are in the way; an authored clearance zone
 * lowers it because the bay has a roof.
 *
 * `excludeInstanceId` is what stops a multi-cell gun from blocking itself: a
 * 2x3 gun occupies three cells in its own lane, and without the exclusion its
 * rear cells would impose a ceiling of 1 on its front cells.
 */
export function cellCeiling(
  chassis: ChassisSpec,
  occupancy: SpatialOccupancy,
  cell: Required<CellRef>,
  excludeInstanceId?: string,
): number {
  let ceiling = clearanceZoneHeight(chassis, cell);
  for (let y = cell.y + 1; y < chassis.height; y++) {
    const behind = { regionId: cell.regionId, x: cell.x, y };
    const stack = occupancy.stacksByCell.get(spatialCellKey(chassis, behind)) ?? [];
    for (const entry of stack) {
      if (entry.instanceId === excludeInstanceId) continue;
      const clears = forwardClearance(getPart(entry.partId));
      if (clears === undefined) continue;
      const base = occupantTop(chassis, occupancy, behind, entry.instanceId)
        - partHeight(getPart(entry.partId));
      ceiling = Math.min(ceiling, base + clears);
    }
  }
  return ceiling;
}
```

`clearanceZoneHeight` does not exist yet. For this task, add the stub that Task 4 fills in:

```ts
/** Authored chassis roofs. Filled in by the clearance-zone task. */
function clearanceZoneHeight(_chassis: ChassisSpec, _cell: Required<CellRef>): number {
  return Infinity;
}
```

- [ ] **Step 4: Run the test**

Run: `npm run sim:test -- spatial`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/spatial.ts packages/sim/test/spatial.test.ts
git commit -m "Work out how high a part may stand in a cell, and who lowered the roof"
```

---

### Task 3: Enforce it at placement

**Files:**
- Modify: `packages/sim/src/spatial.ts` (`SpatialPlacementReason`, `checkSpatialPartPlacement` ~line 120-180)
- Modify: `apps/web/src/App.tsx:47-56` (`REJECTION_COPY`)
- Test: `packages/sim/test/spatial.test.ts`

**Interfaces:**
- Consumes: `stackBase`, `occupantTop`, `cellCeiling` (Task 2).
- Produces: two new members of `SpatialPlacementReason` — `'ceiling-exceeded'` and `'blocks-firing-lane'`.

- [ ] **Step 1: Write the failing test**

Append to `packages/sim/test/spatial.test.ts`. The Bastion is the chassis with
room to test this: its `hull` region is columns 2-5 by rows 0-8, so two `rect(2,3)`
guns fit in one lane with space between them. (The Mule's body is only four rows
deep, which is not enough to put anything in front of a three-row gun.)

```ts
import { checkSpatialPartPlacement } from '../src/spatial.js';

describe('placement under a ceiling', () => {
  const chassis = getChassis('CH-9'); // Bastion: hull is x 2-5, y 0-8, core at (2,4)
  const at = (instanceId: string, partId: string, x: number, y: number): PlacedPart =>
    ({ instanceId, partId, origin: { regionId: 'hull', x, y }, rotation: 0, integrity: 1 });
  const check = (parts: PlacedPart[], candidate: PlacedPart) =>
    checkSpatialPartPlacement(chassis, { parts, routes: [] }, candidate);

  // W-AC is rect(2,3): at (4,5) it fills x 4-5, y 5-7, and clears 1 level ahead.
  const gun = at('gun', 'W-AC', 4, 5);

  it('accepts a flat part in front of a gun', () => {
    // U-AMMO is line(2): one level tall, so it fits under a ceiling of 1.
    expect(check([gun], at('ammo', 'U-AMMO', 4, 3))).toBeNull();
  });

  it('refuses a two-level reactor in front of a gun', () => {
    // R-E25 is rect(2,2) and two levels tall.
    expect(check([gun], at('reactor', 'R-E25', 4, 2))?.reason).toBe('ceiling-exceeded');
  });

  it('refuses the gun when the reactor got there first', () => {
    expect(check([at('reactor', 'R-E25', 4, 2)], gun)?.reason).toBe('blocks-firing-lane');
  });

  it('leaves a gun placeable on an empty chassis, so it never blocks itself', () => {
    // The gun occupies three cells in its own lane. Without excluding itself,
    // its rear cells impose a ceiling of 1 on its front cells and no gun is
    // ever placeable anywhere.
    expect(check([], gun)).toBeNull();
  });

  it('ignores a tall part behind the gun', () => {
    const forward = at('gun', 'W-AC', 4, 4); // fills y 4-6
    expect(check([forward], at('reactor', 'R-E25', 4, 7))).toBeNull();
  });

  it('lets a small gun clear nothing at all in its lane', () => {
    // W-MG is one level tall and clears 0: even a heat sink is in the way.
    const mg = at('mg', 'W-MG', 4, 5);
    expect(check([mg], at('sink', 'U-HS', 4, 3))?.reason).toBe('ceiling-exceeded');
    expect(check([at('sink', 'U-HS', 4, 3)], mg)?.reason).toBe('blocks-firing-lane');
  });

  it('lets armour cover a part that is already at the ceiling', () => {
    // U-SHELL is line(2), armour layer, height 0: it skins the ammo bin without
    // raising it, so the bin stays legal under the gun's ceiling of 1.
    const ammo = at('ammo', 'U-AMMO', 4, 3);
    expect(check([gun, ammo], at('shell', 'U-SHELL', 4, 3))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run sim:test -- spatial`
Expected: FAIL — the reactor placement returns `null` instead of `'ceiling-exceeded'`.

- [ ] **Step 3: Extend the reason union**

In `packages/sim/src/spatial.ts`:

```ts
export type SpatialPlacementReason =
  | 'out-of-region'
  | 'route-on-equipment'
  | 'duplicate-route'
  | 'incompatible-stack'
  | 'footprint-mismatch'
  | 'ceiling-exceeded'
  | 'blocks-firing-lane';
```

- [ ] **Step 4: Add the check to `checkSpatialPartPlacement`**

The function currently `return null`s early when nothing overlaps. Restructure so the stack checks resolve first (their message is more specific), then the height checks run before returning. Replace the body from the overlap map onward with:

```ts
  const stackError = checkStackLegality(chassis, occupancy, build, candidate, candidateDef, cells);
  if (stackError) return stackError;
  return checkHeightLegality(chassis, occupancy, candidate, candidateDef, cells);
```

Move the existing overlap/`sameCells`/`stacksOn` logic verbatim into `checkStackLegality` with the same signature and the same returns, and add:

```ts
/**
 * A part must fit under the ceiling of every cell it covers, and a weapon must
 * not bury something already standing in its lane. Both directions are the same
 * inequality read from opposite ends, which is why the rule is order-independent:
 * whichever of the two parts is placed second is the one refused.
 */
function checkHeightLegality(
  chassis: ChassisSpec,
  occupancy: SpatialOccupancy,
  candidate: PlacedPart,
  def: PartDef,
  cells: Required<CellRef>[],
): SpatialPlacementError | null {
  const height = partHeight(def);
  for (const cell of cells) {
    const base = stackBase(chassis, occupancy, cell, def, candidate.instanceId);
    if (base + height > cellCeiling(chassis, occupancy, cell, candidate.instanceId)) {
      return { reason: 'ceiling-exceeded' };
    }
  }

  const clears = forwardClearance(def);
  if (clears === undefined) return null;
  const own = new Set(cells.map((cell) => spatialCellKey(chassis, cell)));
  for (const cell of cells) {
    const imposed = stackBase(chassis, occupancy, cell, def, candidate.instanceId) + clears;
    for (let y = 0; y < cell.y; y++) {
      const ahead = { regionId: cell.regionId, x: cell.x, y };
      const key = spatialCellKey(chassis, ahead);
      if (own.has(key)) continue;
      for (const entry of occupancy.stacksByCell.get(key) ?? []) {
        if (entry.instanceId === candidate.instanceId) continue;
        if (occupantTop(chassis, occupancy, ahead, entry.instanceId) > imposed) {
          return { reason: 'blocks-firing-lane' };
        }
      }
    }
  }
  return null;
}
```

- [ ] **Step 5: Run the tests**

Run: `npm run sim:test -- spatial`
Expected: PASS.

- [ ] **Step 6: Run the whole sim suite and expect content failures**

Run: `npm run sim:test`
Expected: `templates.test.ts`, `ladder.test.ts`, `placementFixture.test.ts` and `adaptation.test.ts` may now FAIL, because stock layouts predate the rule. **Do not weaken the rule to fix them.** Note which builds fail; Tasks 6 and 7 re-lay them. If only these content suites fail, that is the expected state at the end of this task.

- [ ] **Step 7: Name the two refusals in the workshop**

In `apps/web/src/App.tsx`, in `REJECTION_COPY`:

```ts
  'ceiling-exceeded': 'Too tall for that spot',
  'blocks-firing-lane': 'Its firing lane is blocked',
```

- [ ] **Step 8: Commit**

```bash
git add packages/sim/src/spatial.ts packages/sim/test/spatial.test.ts apps/web/src/App.tsx
git commit -m "Refuse a part that does not fit under its ceiling, from either end"
```

---

### Task 4: Chassis clearance zones, and the Mule's cargo bay

**Files:**
- Modify: `packages/sim/src/types.ts` (`ChassisSpec`, ~line 242)
- Modify: `packages/sim/src/spatial.ts` (`clearanceZoneHeight`)
- Modify: `packages/sim/src/chassis.ts` (`CH-5`)
- Test: `packages/sim/test/spatial.test.ts`

**Interfaces:**
- Consumes: `cellCeiling` (Task 2), which already calls `clearanceZoneHeight`.
- Produces: `ChassisClearanceZoneSpec { id: string; name: string; cells: CellRef[]; height: number }` and `ChassisSpec.clearanceZones?: ChassisClearanceZoneSpec[]`.

- [ ] **Step 1: Write the failing test**

Append to `packages/sim/test/spatial.test.ts`:

```ts
describe('authored chassis clearance', () => {
  const chassis = getChassis('CH-5'); // Mule: body is rows 2-5, row 5 is '.####.'
  const at = (instanceId: string, partId: string, x: number, y: number): PlacedPart =>
    ({ instanceId, partId, origin: { regionId: 'body', x, y }, rotation: 0, integrity: 1 });
  const check = (candidate: PlacedPart) =>
    checkSpatialPartPlacement(chassis, { parts: [], routes: [] }, candidate);

  it('roofs the Mule cargo row at one level', () => {
    expect(cellCeiling(chassis, buildSpatialOccupancy(chassis, { parts: [], routes: [] }),
      { regionId: 'body', x: 2, y: 5 })).toBe(1);
  });

  it('takes flat equipment in the bay', () => {
    expect(check(at('ammo', 'U-AMMO', 1, 5))).toBeNull();
  });

  it('refuses a reactor that hangs into the bay', () => {
    // R-E25 is rect(2,2): at (1,4) it fills y 4-5, so its lower half is in the
    // boot. Nothing one row tall is two levels tall, so hanging in is the only
    // way to violate a one-row bay -- which is exactly the rule worth having.
    expect(check(at('reactor', 'R-E25', 1, 4))?.reason).toBe('ceiling-exceeded');
  });

  it('leaves the rest of the hull unroofed', () => {
    expect(check(at('reactor', 'R-E25', 1, 2))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run sim:test -- spatial`
Expected: FAIL — the cargo row reports `Infinity`.

- [ ] **Step 3: Add the type**

In `packages/sim/src/types.ts`, beside `ChassisLocationZoneSpec`:

```ts
/**
 * A set of cells with an authored roof. Per-cell rather than per-region on
 * purpose: a region-wide roof is too blunt to be usable. The Mule's shoulder
 * regions are two mask rows deep, so a rect(2,3) gun cannot fit in one, and
 * roofing the whole hull would not mean "guns go on the shoulders" -- it would
 * mean the Mule can never mount a big gun at all.
 */
export interface ChassisClearanceZoneSpec {
  id: string;
  name: string;
  cells: CellRef[];
  /** Highest level a part may reach in these cells. */
  height: number;
}
```

and in `ChassisSpec`, beside `locationZones`:

```ts
  clearanceZones?: ChassisClearanceZoneSpec[];
```

- [ ] **Step 4: Implement `clearanceZoneHeight`**

Replace the Task 2 stub in `packages/sim/src/spatial.ts`. Cache the cell sets on the chassis by identity, the way `placementEffects.ts` caches its zones — `cellCeiling` runs per candidate cell per placement and the workshop calls it on every ghost move:

```ts
const clearanceCellCache = new WeakMap<ChassisSpec, { height: number; cells: Set<string> }[]>();

function clearanceZonesFor(chassis: ChassisSpec) {
  let zones = clearanceCellCache.get(chassis);
  if (!zones) {
    zones = (chassis.clearanceZones ?? []).map((zone) => ({
      height: zone.height,
      cells: new Set(zone.cells.map((cell) => spatialCellKey(chassis, cell))),
    }));
    clearanceCellCache.set(chassis, zones);
  }
  return zones;
}

function clearanceZoneHeight(chassis: ChassisSpec, cell: Required<CellRef>): number {
  const key = spatialCellKey(chassis, cell);
  let height = Infinity;
  for (const zone of clearanceZonesFor(chassis)) {
    if (zone.cells.has(key)) height = Math.min(height, zone.height);
  }
  return height;
}
```

- [ ] **Step 5: Author the Mule's bay**

In `packages/sim/src/chassis.ts`, on `CH-5`, after its `regions`/`ports`:

```ts
    clearanceZones: [{
      id: 'mule-cargo-bay',
      name: 'Cargo bay',
      cells: [1, 2, 3, 4].map((x) => ({ regionId: 'body', x, y: 5 })),
      height: 1,
    }],
```

- [ ] **Step 6: Run the test**

Run: `npm run sim:test -- spatial`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/sim/src/types.ts packages/sim/src/spatial.ts packages/sim/src/chassis.ts packages/sim/test/spatial.test.ts
git commit -m "Let a chassis author a low roof, and give the Mule a cargo bay"
```

---

### Task 5: Risers, and the gimbal that already was one

**Files:**
- Modify: `packages/sim/src/catalog.ts`
- Test: `packages/sim/test/spatial.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: part ids `U-RISE2`, `U-RISE3`, `U-RISEL`.

- [ ] **Step 1: Write the failing test**

Append to `packages/sim/test/spatial.test.ts`:

```ts
describe('raised mounting', () => {
  const chassis = getChassis('CH-9'); // Bastion: hull is x 2-5, y 0-8
  const at = (instanceId: string, partId: string, x: number, y: number): PlacedPart =>
    ({ instanceId, partId, origin: { regionId: 'hull', x, y }, rotation: 0, integrity: 1 });
  const check = (parts: PlacedPart[], candidate: PlacedPart) =>
    checkSpatialPartPlacement(chassis, { parts, routes: [] }, candidate);

  const riser = (instanceId: string) => at(instanceId, 'U-RISE3', 4, 5);
  const gun = at('gun', 'W-AC', 4, 5); // rect(2,3), x 4-5, y 5-7

  it('makes the gimbal a raised mount', () => {
    expect(partHeight(getPart('U-TUR'))).toBe(1);
  });

  it('lets every weapon stand on a support, not just the machine gun', () => {
    for (const id of ['W-AC', 'W-BR', 'W-LAS', 'W-RKT', 'W-ION', 'W-CB', 'W-SC']) {
      expect(getPart(id).spatial?.stacksOn, id).toContain('support');
    }
  });

  it('stacks a riser under a gun, and a riser under a riser', () => {
    expect(check([], riser('r1'))).toBeNull();
    expect(check([riser('r1')], riser('r2'))).toBeNull();
    expect(check([riser('r1')], gun)).toBeNull();
  });

  it('raises what a gun will tolerate in its lane, one level per riser', () => {
    // Ground level: the gun clears 1, so a two-level reactor is in the way.
    expect(check([gun], at('reactor', 'R-E25', 4, 3))?.reason).toBe('ceiling-exceeded');
    // One riser: base 1, so it now clears 2 and the reactor fits.
    expect(check([riser('r1'), at('gun', 'W-AC', 4, 5)], at('reactor', 'R-E25', 4, 3))).toBeNull();
    // Two risers: base 2, so it clears 3 -- a whole second gun in the same lane.
    expect(check(
      [riser('r1'), riser('r2'), at('gun', 'W-AC', 4, 5)],
      at('front', 'W-AC', 4, 0),
    )).toBeNull();
  });
});
```

Note what the third assertion is saying: one riser does **not** buy you a second
gun. A gun stands 3 levels and clears 1, so clearing another gun needs the rear
gun's base at 2 — two risers, or a riser under a gimbal. That progression is the
intended shape of the mechanic, not an off-by-one.

These coordinates were checked against `bastionHullMask`: the hull is columns 2-5 by rows 0-8, so `(4,5)` and `(4,0)` are both fully in mask for a `rect(2,3)` footprint, and neither touches the core cell at `(2,4)`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run sim:test -- spatial`
Expected: FAIL — `U-RISE3` is not in the catalog.

- [ ] **Step 3: Add the risers**

In `packages/sim/src/catalog.ts`, in the structural/utility block near `U-TUR`:

```ts
  'U-RISE2': {
    id: 'U-RISE2', name: 'Block (riser)', category: 'structural',
    shape: rect(2, 2), massKg: 60, hp: 20, tier: 1,
    spatial: { layer: 'support', stacksOn: ['support'], height: 1, transfersPower: true, electricalCapacityKw: 60, transfersHeat: true, thermalConductance: 1 },
  },
  'U-RISE3': {
    id: 'U-RISE3', name: 'Pylon (riser)', category: 'structural',
    shape: rect(2, 3), massKg: 90, hp: 25, tier: 1,
    spatial: { layer: 'support', stacksOn: ['support'], height: 1, transfersPower: true, electricalCapacityKw: 60, transfersHeat: true, thermalConductance: 1 },
  },
  'U-RISEL': {
    id: 'U-RISEL', name: 'Beam (riser)', category: 'structural',
    shape: line(3), massKg: 70, hp: 20, tier: 1,
    spatial: { layer: 'support', stacksOn: ['support'], height: 1, transfersPower: true, electricalCapacityKw: 60, transfersHeat: true, thermalConductance: 1 },
  },
```

A riser conducts power and heat because a gun sitting on one must still reach the network — a support layer that broke connectivity would make raised mounting unusable.

Stacks require identical footprints, so risers exist per shape, not per part. `rect(2,5)` (`W-RG`, the railgun) deliberately has none: a gun that size sits where it sits.

- [ ] **Step 4: Give `U-TUR` a height**

Extend its existing `spatial` block with `height: 1`, `stacksOn: ['support']`. It is already the support part guns stack on and already carries `weaponArcBonusDeg: 25`, so this makes the turret mount a raised mount that also swings wider.

- [ ] **Step 5: Let every weapon stand on a support**

Add `stacksOn: ['support']` to the `spatial` block of `W-AC`, `W-BR`, `W-LAS`, `W-RKT`, `W-ION`, `W-CB`, `W-SC`, creating the block where absent. Only `W-MG` declares it today, which is why nothing but the machine gun can currently sit on a gimbal.

- [ ] **Step 6: Run the test**

Run: `npm run sim:test -- spatial`
Expected: PASS.

- [ ] **Step 7: Check the audit still holds**

Run: `npm run game:audit`
Expected: PASS. It checks content validity — a new part with an impossible shape or a self-dependent unlock fails here.

- [ ] **Step 8: Commit**

```bash
git add packages/sim/src/catalog.ts packages/sim/test/spatial.test.ts
git commit -m "Sell height: three risers, and a gimbal that finally lifts what it mounts"
```

---

### Task 6: Teach the between-fights auto-placer the ceiling

`adaptation.ts:87` calls only `checkPlacement` — the grid rule. It has never consulted `checkSpatialPartPlacement`, so it does not check stacking either, and it will happily generate a fitting that the workshop would refuse.

**Files:**
- Modify: `packages/sim/src/adaptation.ts:73-107` (`addParts`)
- Test: `packages/sim/test/adaptation.test.ts`

**Interfaces:**
- Consumes: `checkSpatialPartPlacement` (Task 3).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `packages/sim/test/adaptation.test.ts`, following the existing suite's shape for enumerating ops:

```ts
import { validateWholeBuildPlacement } from '../src/spatial.js';

it('never produces a fitting the workshop would refuse', () => {
  for (const op of FITTING_OPS) {
    const adapted = op.apply(baseBuild());
    if (!adapted) continue;
    const issues = validateWholeBuildPlacement(getChassis(adapted.chassisId), adapted);
    expect(issues, `${op.id}: ${JSON.stringify(issues)}`).toEqual([]);
  }
});
```

Use whatever the file already names the op catalog and the starting build — read the top of `adaptation.test.ts` and match it rather than inventing `FITTING_OPS`/`baseBuild` if they are called something else.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run sim:test -- adaptation`
Expected: FAIL on at least one op that adds a gun or a reactor into an occupied lane.

- [ ] **Step 3: Consult the spatial rules in the search**

In `packages/sim/src/adaptation.ts`, in `addParts`, after the existing `checkPlacement` guard:

```ts
        if (checkPlacement(chassis, parts, candidate, def) !== null) continue;
        // The workshop's rules, not just the grid's: stacking, regions and the
        // ceiling. Without this the auto-placer can hand back a fitting the
        // player could never have built by hand.
        if (checkSpatialPartPlacement(chassis, { parts, routes: build.routes ?? [] }, candidate, def) !== null) continue;
```

and import `checkSpatialPartPlacement` from `./spatial.js` alongside the existing imports.

- [ ] **Step 4: Run the test**

Run: `npm run sim:test -- adaptation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/adaptation.ts packages/sim/test/adaptation.test.ts
git commit -m "Have the auto-placer obey the same rules the workshop enforces"
```

---

### Task 7: Re-lay the stock content

Content is re-authorable; the game is not shipped and nothing needs preserving. Fix layouts, never the rule.

**Files:**
- Modify: `packages/sim/src/templates.ts`
- Modify: `packages/sim/src/ladder.ts` (if it authors its own layouts)
- Modify: the starter blueprint (find it: `grep -rn "starter" packages/game/src packages/sim/src`)
- Test: `packages/sim/test/templates.test.ts`, `ladder.test.ts`, `placementFixture.test.ts`

**Interfaces:**
- Consumes: the rules from Tasks 3-5.
- Produces: no new exports.

- [ ] **Step 1: See exactly what is illegal**

Run: `npm run sim:test -- templates ladder placementFixture`
Expected: FAIL. Each failure names a build and a reason.

- [ ] **Step 2: Re-lay each failing build**

For each: move the offending part out of the gun's lane, move it behind the gun, put the gun on a riser, or swap the part for a flat one. Prefer moving the *blocker* — a template's weapon loadout is its archetype and should survive the re-lay, while where its ammo bin sits is not load-bearing.

Keep every build's part list intact where possible so the balance shift stays attributable to layout rather than to content changes. If a template genuinely cannot hold its loadout under the new rule, say so in the commit message rather than silently dropping a weapon.

- [ ] **Step 3: Re-run until green**

Run: `npm run sim:test`
Expected: PASS, whole suite.

- [ ] **Step 4: Check the game package**

Run: `npm run game:test && npm run game:audit`
Expected: PASS. `game:audit` is a hard gate and stays one.

- [ ] **Step 5: Commit**

```bash
git add -A packages/sim packages/game
git commit -m "Re-lay the stock builds so no gun is firing through its own hull"
```

---

### Task 8: Show the player the two numbers

A player cannot plan a lane they cannot read.

**Files:**
- Modify: `apps/web/src/components/PartInspector.tsx:83` (beside the Mass row)
- Test: `apps/web/src/components/PartInspector.test.tsx`

**Interfaces:**
- Consumes: `partHeight`, `forwardClearance` from `@mechbattler/sim` — check they are re-exported from `packages/sim/src/index.ts` and add them there if not.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/components/PartInspector.test.tsx`, matching the file's existing render helper:

```ts
it('shows how tall a part stands and what it demands ahead', () => {
  renderInspector('W-AC');
  expect(screen.getByText('Height')).toBeInTheDocument();
  expect(screen.getByText('3 levels')).toBeInTheDocument();
  expect(screen.getByText('Clear ahead')).toBeInTheDocument();
  expect(screen.getByText('1 level')).toBeInTheDocument();
});

it('says nothing about clearance for a part that imposes none', () => {
  renderInspector('U-AMMO');
  expect(screen.queryByText('Clear ahead')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run web:test -- PartInspector`
Expected: FAIL — no Height row.

- [ ] **Step 3: Add the rows**

In `apps/web/src/components/PartInspector.tsx`, after the Mass row, reading from the sim and never typing a number:

```tsx
        <div className="inspector-row">
          <span>Height</span>
          <span>{partHeight(def)} level{partHeight(def) === 1 ? '' : 's'}</span>
        </div>
        {forwardClearance(def) !== undefined && (
          <div className="inspector-row">
            <span>Clear ahead</span>
            <span>
              {forwardClearance(def)} level{forwardClearance(def) === 1 ? '' : 's'}
            </span>
          </div>
        )}
```

- [ ] **Step 4: Run the tests**

Run: `npm run web:test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/PartInspector.tsx apps/web/src/components/PartInspector.test.tsx packages/sim/src/index.ts
git commit -m "Name a part's height and the lane it demands, in the inspector"
```

---

### Task 9: Look at it

Tests passing means the units are fine. It does not mean the workshop refuses a placement legibly. CLAUDE.md is explicit about this and it has been learned expensively.

**Files:**
- No source changes expected. Fix what you find.

- [ ] **Step 1: Make sure the dev server is serving the new code**

```bash
pm2 restart mechbattler-dev
curl -s http://localhost:5160/src/App.tsx | grep -c 'blocks-firing-lane'
```
Expected: `1` or more. Never start an ad-hoc vite; edits are not live until vite has rebuilt.

- [ ] **Step 2: Drive the workshop and watch a refusal**

```bash
npm run web:shot -- 'http://localhost:5160/?view=workshop' /tmp/height-ghost.png \
  --w 390 --h 844 --waitFor '.part-row' --tap '.part-row' --tap '.plate-cell'
```

Then open `/tmp/height-ghost.png` and actually look at it. Read the console-error line beside the image.

- [ ] **Step 3: Prove the ghost turns red for the right reason**

Place a gun, then arm a reactor over a cell in its lane and measure rather than believe the picture:

```bash
npm run web:shot -- 'http://localhost:5160/?view=workshop' /tmp/height-red.png \
  --w 390 --h 844 --waitFor '.part-row' \
  --eval "document.querySelectorAll('.ghost-bad').length"
```

Expected: the rejection copy reads "Too tall for that spot" or "Its firing lane is blocked", not a raw reason slug. If an `--eval` disagrees with the source, re-check what is actually being served before believing it.

- [ ] **Step 4: Run the screen audit**

Run: `npm run web:audit`
Expected: PASS. The new inspector rows must not push text under 11px or overflow horizontally.

- [ ] **Step 5: Run the campaign flow**

Run: `npm run web:campaign`
Expected: PASS. A run must still advance — the auto-placer change in Task 6 sits directly in that path.

- [ ] **Step 6: Record what balance did**

```bash
npm run balance:collect
npm run balance:report
```

Expected: builds will have moved, because legal layouts changed. Report the movement in the commit message. **Do not re-baseline.** Per the working agreement, the baseline is only ever re-cut during a deliberate balance pass, never to make a swing go away.

- [ ] **Step 7: Full verify and commit**

```bash
npm run verify
git add -A
git commit -m "Verify component height end to end, and record where balance moved"
```

---

## Notes for whoever executes this

- The one rule that is easy to get wrong is a gun blocking itself. A `rect(2,3)` gun occupies three cells in its own lane; both `cellCeiling` and the forward scan must exclude the candidate's own instance, or no gun is placeable anywhere and every test in Task 3 fails at once.
- `imposed` is per lane, not per part. A two-column gun sits on a separate stack in each column and may be raised in one and not the other, so it uses its own base *in that lane*.
- If a stock build cannot be re-laid without dropping a weapon, that is a content finding worth writing down in `docs/17-balance-findings.md`, not a reason to soften the rule.
