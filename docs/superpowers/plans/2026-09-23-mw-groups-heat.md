# Weapon Groups, Alpha and Spending Heat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the player MechWarrior's two central decisions during a live fight:
- which weapon group to fire, including an Alpha strike;
- when to run hot, with a mech-wide reactor shutdown as the price.

**Architecture:**
- The sim gets three small rules:
  - a held gun finishes loading and waits;
  - a one-shot volley token arms every loaded gun;
  - the whole mech shuts down when the reactor or core cells overheat.
- Everything else is control data above the sim:
  - groups live on `Build`;
  - the live screen expands groups into the existing per-gun `ManualOrders.weapons` map;
  - OVR lifts only the autopilot's heat gate.

The sim never learns what a group is.

**Tech Stack:** TypeScript, vitest, React (apps/web), npm workspaces (`@mechbattler/sim`, `@mechbattler/game`, `@mechbattler/web`).

**Spec:** `docs/superpowers/specs/2026-09-23-mw-groups-heat-design.md`

## Global Constraints

- Every figure the player sees comes from `packages/sim`. The UI never types a threshold (CLAUDE.md, "Never copy sim constants into UI code").
- Balance is report-only. Never gate on it and never rebaseline in this work (CLAUDE.md).
- `apps/web/src/styles/shell.css` and `styles/battle.css` are verbatim prototype sheets. Do not edit them. New styles go in `apps/web/src/components/BattleLiveScreen.css` or a component's own CSS.
- Tap targets are ≥ 44 px. Nothing resizes with its text. Text is ≥ 11 px (docs/14, `web:audit`).
- The dev server runs under pm2 as `mechbattler-dev` on port 5160. Never start vite yourself.
- Golden battle (`packages/sim/test/determinism.test.ts`):
  - The first time it moves on this branch, bump `SIM_VERSION` (`packages/sim/src/version.ts`, currently `2.19.0`) to `2.20.0` and re-pin it with a dated comment giving the reason.
  - Later re-pins on this branch keep `2.20.0` and append a line to that comment.
  - Only re-pin after the test shows the change is the intended one.
- Cook-off stays unreachable. It is hardcoded to the disabled `U-AMMO` part. Do not touch it.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01P6ijcVyWgTXukgPycqrRLo
  ```

## Review Focus

1. **Alpha must survive the Auto button.** The Alpha token only ever increases. If "Auto" or `A` resets it to 0, every later press is ignored as a repeat. *Pinned in Task 7 (`resetToAuto` keeps `alpha`).*
2. **One press fires once.** An Alpha press is re-issued at 4 Hz by the legacy controller path and at 20 Hz in lockstep. It must fire each loaded gun once, not once per re-issue. *Pinned in Task 4.*
3. **Stale groups.** After a part is removed, detached, or lost as salvage, a stale `weaponGroups` entry must not crash the game or fire a ghost. The chip reads empty and is disabled. *Pinned in Tasks 6 and 7.*
4. **Alpha during a reactor shutdown.** It fires nothing and does not leave a pending volley that goes off on restart. *Pinned in Task 5.*
5. **A charged gun that is full when brownout sheds it** still fires on release from its stored charge, rather than going silent. *Pinned in Task 3.*

---

### Task 1: One fire-control gate, OVR, and spread past fire-hold

The autopilot (`combat.ts:1461-1489`) and the HUD frame sampler (`combat.ts:~1950-1964`) each compute the same arc/range/min-range/heat gate. OVR needs a third caller. This task extracts the gate into one function, uses it in all three places, and adds the heat-spread ramp past 115 °C.

**Files:**
- Modify: `packages/sim/src/combat.ts`:
  - the autopilot weapons block around :1461;
  - `sampleMechFrame` around :1950;
  - `ManualOrders` at :1527;
  - `mergeManualOrders` at :1561;
  - `heatDispersionMult` at :182, plus a new constant next to `HEAT_DISPERSION_AT_HOLD` at :127.
- Test: `packages/sim/test/orders.test.ts`, `packages/sim/test/weaponSigma.test.ts`

**Interfaces:**
- Produces:
  - `export type FireGate = 'arc' | 'range' | 'minrange' | 'heat' | null;`
  - `export function fireGate(self: Combatant, enemy: Combatant, instanceId: string, terrain: TerrainGrid, snapshot: SimSnapshot | null): FireGate`. It covers geometry and heat only. Callers check `isPartFunctional` themselves.
  - `ManualOrders.overrideHeat?: boolean`
  - `export const HEAT_DISPERSION_AT_SHUTDOWN = 2.0;`

- [ ] **Step 1: Write the failing tests**

Append to `packages/sim/test/orders.test.ts`. It already imports `Battle`, `withManualOrders`, `autopilotController` and `muleGunline`. Also add `HEAT_FIRE_HOLD_C` from `../src/simulation.js` to the imports.

```ts
describe('OVR: the heat override (MW spec §3)', () => {
  /** Pins the gun's cells at `tempC` every tick so the autopilot's heat gate is the only thing in question. */
  function heldHot(overrideHeat: boolean) {
    const battle = new Battle({
      builds: [muleGunline(), muleGunline()],
      seed: 5,
      spawnDistanceM: 40,
      controllers: [withManualOrders(autopilotController, () => ({ overrideHeat })), autopilotController],
      timeoutS: 6,
    });
    const me = battle.combatants[0];
    const cellKeys = me.sim.thermal.cellKeysByInstance.get('ac')!;
    const pin = () => { for (const k of cellKeys) me.sim.thermal.cells.get(k)!.tempC = HEAT_FIRE_HOLD_C + 5; };
    const myShots = () => battle.events.filter((e) => e.type === 'shot' && e.mech === 0).length;
    // The first command tick has no snapshot yet, so fire control cannot see heat
    // and a loaded gun gets one free shot. Count only after the first two
    // command windows (10 ticks), once the autopilot is reading pinned temperatures.
    pin();
    for (let t = 0; t < 10; t++) { battle.step(); pin(); }
    const before = myShots();
    for (let t = 0; t < 80 && battle.step(); t++) pin();
    return myShots() - before;
  }

  it('the autopilot holds a gun past fire-hold, and OVR fires it anyway', () => {
    expect(heldHot(false)).toBe(0);
    expect(heldHot(true)).toBeGreaterThan(0);
  });

  it('OVR frees only the heat gate: a gun out of range stays silent', () => {
    const battle = new Battle({
      builds: [muleGunline(), muleGunline()],
      seed: 5,
      spawnDistanceM: 400,
      controllers: [withManualOrders(autopilotController, () => ({ overrideHeat: true, move: 'hold' })), autopilotController],
      timeoutS: 2,
    });
    while (battle.step()) { /* tick */ }
    expect(battle.events.filter((e) => e.type === 'shot' && e.mech === 0)).toHaveLength(0);
  });
});
```

Append to `packages/sim/test/weaponSigma.test.ts`. Import `heatDispersionMult`, `HEAT_DISPERSION_AT_HOLD` and `HEAT_DISPERSION_AT_SHUTDOWN` from `../src/combat.js`, and `HEAT_FIRE_HOLD_C` and `HEAT_SHUTDOWN_C` from `../src/simulation.js`.

```ts
describe('heat spread past fire-hold (MW spec §3)', () => {
  it('keeps widening from the hold line to shutdown, then saturates', () => {
    expect(heatDispersionMult(HEAT_FIRE_HOLD_C)).toBeCloseTo(HEAT_DISPERSION_AT_HOLD, 12);
    const mid = heatDispersionMult((HEAT_FIRE_HOLD_C + HEAT_SHUTDOWN_C) / 2);
    expect(mid).toBeCloseTo((HEAT_DISPERSION_AT_HOLD + HEAT_DISPERSION_AT_SHUTDOWN) / 2, 12);
    expect(heatDispersionMult(HEAT_SHUTDOWN_C)).toBeCloseTo(HEAT_DISPERSION_AT_SHUTDOWN, 12);
    expect(heatDispersionMult(HEAT_SHUTDOWN_C + 40)).toBeCloseTo(HEAT_DISPERSION_AT_SHUTDOWN, 12);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run sim:test -- orders weaponSigma`

Expected: FAIL. `overrideHeat` is ignored (the first test gets 0 shots under OVR), and `HEAT_DISPERSION_AT_SHUTDOWN` is not exported.

- [ ] **Step 3: Implement**

In `combat.ts`, next to `HEAT_DISPERSION_AT_HOLD`:

```ts
/**
 * Dispersion multiplier at the part-shutdown line. Past fire-hold heat keeps
 * walking the shots (MW spec §3) -- the RogueTech soft ramp docs/07 §7 wanted,
 * applied only in the band OVR makes reachable.
 */
export const HEAT_DISPERSION_AT_SHUTDOWN = 2.0;
```

Replace the body of `heatDispersionMult`:

```ts
export function heatDispersionMult(tempC: number): number {
  if (tempC <= HEAT_FIRE_HOLD_C) {
    const span = HEAT_FIRE_HOLD_C - HEAT_AMBIENT_C;
    const t = span <= 0 ? 0 : (tempC - HEAT_AMBIENT_C) / span;
    return 1 + (HEAT_DISPERSION_AT_HOLD - 1) * Math.max(0, t);
  }
  const over = Math.min(1, (tempC - HEAT_FIRE_HOLD_C) / (HEAT_SHUTDOWN_C - HEAT_FIRE_HOLD_C));
  return HEAT_DISPERSION_AT_HOLD + (HEAT_DISPERSION_AT_SHUTDOWN - HEAT_DISPERSION_AT_HOLD) * over;
}
```

Import `HEAT_SHUTDOWN_C` from `./simulation.js` if combat.ts doesn't already.

Add `fireGate` just above `autopilotController`. The body is the frame sampler's existing logic, moved here, in the same order and with the same unscaling:

```ts
/**
 * Which fire-control gate would silence this gun right now: the one check the
 * autopilot fires by, the HUD names, and OVR lifts (MW spec §3). Geometry and
 * heat only -- the caller decides what a destroyed gun means.
 */
export type FireGate = 'arc' | 'range' | 'minrange' | 'heat' | null;

export function fireGate(
  self: Combatant, enemy: Combatant, instanceId: string, terrain: TerrainGrid, snapshot: SimSnapshot | null,
): FireGate {
  const part = self.build.parts.find((p) => p.instanceId === instanceId)!;
  const def = getPart(part.partId);
  const toEnemy = sub(enemy.pos, self.pos);
  const range = len(toEnemy);
  const bearingOffset = Math.abs(wrapAngle(datan2(toEnemy.y, toEnemy.x) - self.facingRad));
  const myTile = terrainAt(terrain, self.pos.x, self.pos.y);
  const rangeMultiplier = self.weaponRangeMultiplier(instanceId) * (myTile === 'hill' ? HILL_RANGE_MULT : 1);
  const despawnRange = def.weapon!.falloff.max * WEAPON_REACH_MULT * rangeMultiplier;
  const halfArc = (self.weaponArcDeg(instanceId, def.weapon!.mountArcDeg) / 2) * (Math.PI / 180);
  if (range > despawnRange) return 'range';
  if (bearingOffset > halfArc) return 'arc';
  if (falloffAt(def, range / rangeMultiplier) <= 0) return 'minrange';
  if (snapshot !== null && self.hottestCellC(instanceId, snapshot) >= HEAT_FIRE_HOLD_C) return 'heat';
  return null;
}
```

Autopilot: replace the loop body at :1465-1489. Keep the long comment about `falloff.min` above the `fireGate` definition, where it now belongs.

```ts
  for (const p of self.build.parts) {
    const def = getPart(p.partId);
    if (def.category !== 'weapon') continue;
    enabled[p.instanceId] = self.isPartFunctional(p.instanceId)
      && fireGate(self, enemy, p.instanceId, terrain, snapshot) === null;
  }
```

Then delete the now-unused locals `bearingToEnemy`, `bearingOffset`, `halfArc`, `rangeMultiplier` and `despawnRange`. Keep `bearingToEnemy` if the face block below still uses it; it does, at :1508.

Frame sampler: replace the `if (!destroyed) { ... }` gate block with:

```ts
      const gate: WeaponFrame['gate'] = destroyed ? null : fireGate(c, enemy, p.instanceId, this.terrain, snap);
```

The frame used to read `tempC = snap ? ... : 25` for its heat check, and `fireGate` treats a null snapshot as cool. Both mean "not hot".

`ManualOrders`: add

```ts
  /**
   * OVR (MW spec §3): fire guns the autopilot is withholding only for
   * temperature. Other gates stand; part shutdown at 130 °C is physics and
   * still applies. Player-only -- the autopilot never sets it.
   */
  overrideHeat?: boolean;
```

`mergeManualOrders`: replace the weapons branch.

```ts
    if (o.verb === 'weapons' && (m.weapons || m.overrideHeat)) {
      const enabled = { ...o.enabled };
      if (m.overrideHeat) {
        for (const p of ctx.self.build.parts) {
          if (getPart(p.partId).category !== 'weapon' || enabled[p.instanceId]) continue;
          if (!ctx.self.isPartFunctional(p.instanceId)) continue;
          if (fireGate(ctx.self, ctx.enemy, p.instanceId, ctx.terrain, ctx.snapshot) === 'heat') enabled[p.instanceId] = true;
        }
      }
      if (m.weapons) for (const [id, ovr] of Object.entries(m.weapons)) enabled[id] = ovr === 'force';
      return { verb: 'weapons', enabled };
    }
```

- [ ] **Step 4: Run the whole sim suite**

Run: `npm run sim:test`

Expected:
- the new tests pass;
- every other test passes, **including the golden battle**, because extracting `fireGate` is behaviour-preserving;
- the heat ramp only changes spread above 115 °C.

If the golden moves:
- A move caused by the ramp is legitimate. The measured peak is 125.6 °C, so guns do pass 115. Follow the Global Constraints golden rule.
- Any other move means the extraction is not faithful. Diff the operand order against the old code and fix it. Do not re-pin.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/combat.ts packages/sim/test/orders.test.ts packages/sim/test/weaponSigma.test.ts packages/sim/test/determinism.test.ts packages/sim/src/version.ts
git commit -m "fireGate: one fire-control check for autopilot, HUD and OVR; heat spread past hold"
```

---

### Task 2: Measure whether OVR can ever reach the reactor

The spec's "measure before building" step, for §4. This is a report-only harness, and it ends at a **checkpoint**.

**Files:**
- Create: `packages/sim/scripts/overheat.ts`
- Modify: `packages/sim/package.json` (script `"overheat": "node --import tsx scripts/overheat.ts"`)
- Modify: root `package.json` (script `"sim:overheat": "npm run overheat --workspace=@mechbattler/sim --"`)
- Modify: `docs/17-balance-findings.md`, adding F77

**Interfaces:**
- Consumes: `ManualOrders.overrideHeat` (Task 1), `withManualOrders`, `autopilotController`, `TEMPLATES`, `CORE_INSTANCE_ID`, `getPart`.

- [ ] **Step 1: Write the harness**

```ts
/**
 * How hot does a mech get when the player spends heat (MW spec §4)?
 *
 * Runs each canonical template as side 0 against every other, once with the
 * autopilot's fire discipline and once with OVR held on, and reports the peak
 * weapon-cell and reactor/core temperatures and when (if ever) the reactor or
 * core first reached HEAT_SHUTDOWN_C. That number decides whether a mech-wide
 * shutdown is a real risk, never happens, or is a trap -- measured, not guessed.
 *
 * `npm run sim:overheat [seeds]`. Report-only.
 */
import {
  Battle, TEMPLATES, CORE_INSTANCE_ID, HEAT_SHUTDOWN_C, getPart,
  autopilotController, withManualOrders, type Combatant,
} from '../src/index.js';

const SEEDS = Number(process.argv[2]) || 3;

function peakOf(c: Combatant, ids: string[]): number {
  let max = -Infinity;
  for (const id of ids) {
    for (const k of c.sim.thermal.cellKeysByInstance.get(id) ?? []) {
      const t = c.sim.thermal.cells.get(k)!.tempC;
      if (t > max) max = t;
    }
  }
  return max;
}

interface Row { weaponPeak: number; corePeak: number; firstCrossS: number | null; wins: number; fights: number }

function run(overrideHeat: boolean, ti: number): Row {
  const row: Row = { weaponPeak: -Infinity, corePeak: -Infinity, firstCrossS: null, wins: 0, fights: 0 };
  for (let tj = 0; tj < TEMPLATES.length; tj++) {
    if (tj === ti) continue;
    for (let s = 0; s < SEEDS; s++) {
      const battle = new Battle({
        builds: [TEMPLATES[ti]!.build, TEMPLATES[tj]!.build],
        seed: 4000 + s * 7919,
        controllers: [withManualOrders(autopilotController, () => ({ overrideHeat })), autopilotController],
      });
      const me = battle.combatants[0];
      const weaponIds = me.build.parts.filter((p) => getPart(p.partId).category === 'weapon').map((p) => p.instanceId);
      const coreIds = [CORE_INSTANCE_ID, ...me.build.parts.filter((p) => getPart(p.partId).category === 'reactor').map((p) => p.instanceId)];
      while (battle.step()) {
        row.weaponPeak = Math.max(row.weaponPeak, peakOf(me, weaponIds));
        const core = peakOf(me, coreIds);
        row.corePeak = Math.max(row.corePeak, core);
        if (core >= HEAT_SHUTDOWN_C && (row.firstCrossS === null || battle.timeS < row.firstCrossS)) row.firstCrossS = battle.timeS;
      }
      row.fights++;
      if (battle.report().winner === 0) row.wins++;
    }
  }
  return row;
}

const f = (n: number) => n.toFixed(1).padStart(6);
console.log(`template                  | weapon peak off/on | core peak off/on | core ≥${HEAT_SHUTDOWN_C}°C at (on) | win off/on`);
for (let i = 0; i < TEMPLATES.length; i++) {
  const off = run(false, i);
  const on = run(true, i);
  console.log(
    `${TEMPLATES[i]!.id.padEnd(25)} | ${f(off.weaponPeak)} / ${f(on.weaponPeak)} | ${f(off.corePeak)} / ${f(on.corePeak)} | ${
      on.firstCrossS === null ? '   never' : `${on.firstCrossS.toFixed(1).padStart(6)} s`} | ${
      (off.wins / off.fights).toFixed(2)} / ${(on.wins / on.fights).toFixed(2)}`,
  );
}
```

Check that `Combatant`, `CORE_INSTANCE_ID` and `HEAT_SHUTDOWN_C` are all re-exported through `src/index.ts`. They are, via `combat.js`, `thermal.js` and `simulation.js`.

- [ ] **Step 2: Add the npm scripts, then run**

Run: `npm run sim:overheat`

Expected: a table with 7 rows. It takes roughly a minute.

- [ ] **Step 3: Record the finding**

Append `## F77 — What OVR does to heat, and whether the reactor can cook` to `docs/17-balance-findings.md`. Include:
- the table;
- the date;
- `simContentHash()` (print it with `node --import tsx -e "import('@mechbattler/sim').then(m=>console.log(m.simContentHash()))"` from `packages/sim`);
- one paragraph reading the result.

- [ ] **Step 4: CHECKPOINT: decide whether §4 proceeds as written**

- **If at least one template's reactor/core crosses and at least one never does:** proceed. Set `HEAT_MECH_SHUTDOWN_C = HEAT_SHUTDOWN_C` in Task 5.
- **If none cross, or all cross within 10 s of the fight's start:** **stop and ask the user.**
  - Show the table.
  - Offer two options: lower the threshold to a measured percentile, or make weapon heat conduct into the reactor.
  - Explain what each would mean.

  This changes the rule, so it is the user's call (CLAUDE.md "Only stop early for...").

- [ ] **Step 5: Commit**

```bash
git add packages/sim/scripts/overheat.ts packages/sim/package.json package.json docs/17-balance-findings.md
git commit -m "sim:overheat: measure what OVR does to reactor heat (F77)"
```

---

### Task 3: A held gun loads and waits

Implements spec §1.

**Files:**
- Modify: `packages/sim/src/simulation.ts`:
  - `InstanceRuntime` / `freshRuntime` at :121-143;
  - step 2 at :416;
  - step 3 at :465-487;
  - step 6 at :629-636;
  - step 6b at :652-674;
  - a new step 6c;
  - a loaded-flag pass before `return`.
- Modify: `packages/sim/src/combat.ts`: `WeaponFrame` gets `loaded`, set in `sampleMechFrame`.
- Test: create `packages/sim/test/heldLoad.test.ts`
- Modify: `packages/sim/test/determinism.test.ts` (re-pin) and `packages/sim/src/version.ts`

**Interfaces:**
- Produces:
  - `InstanceRuntime.loaded: boolean`: true when the next shot needs only the trigger. It is recomputed at the end of every `step`.
  - `WeaponFrame.loaded: boolean`
- Inside `step`, a local `triggered(id)` closure is the single "is this gun cleared to fire" test (Task 4 extends it).

- [ ] **Step 1: Write the failing tests**

`packages/sim/test/heldLoad.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/simulation.js';
import { getChassis } from '../src/chassis.js';
import type { Build, PlacedPart } from '../src/types.js';

/**
 * MW spec §1: a held gun finishes loading and waits, so guns released together
 * fire together. Before this, holding a gun paused its load and a release fired
 * staggered by up to a whole cycle.
 */
const chassis = getChassis('CH-5');
const at = (instanceId: string, partId: string, x: number, y: number): PlacedPart => ({
  instanceId, partId, origin: { regionId: 'body', x, y }, rotation: 0, integrity: 1,
});
const WIRE = [1, 2, 3, 4, 5].map((x) => ({ kind: 'wire' as const, regionId: 'body', x, y: 2 }));
const DT = 1 / 20;

function sim(parts: PlacedPart[], reactor = 'R-C90'): Simulation {
  const build: Build = { chassisId: chassis.id, parts: [at('reactor', reactor, 3, 3), ...parts], routes: WIRE, powerPriority: [] };
  return new Simulation(chassis, build);
}
/** Steps with `enabled`, returning the ids that fired on each tick. */
function stepN(s: Simulation, n: number, enabled: string[]): string[][] {
  const weaponsEnabled = Object.fromEntries(enabled.map((id) => [id, true]));
  const out: string[][] = [];
  for (let i = 0; i < n; i++) out.push(s.step(DT, { weaponsEnabled, speedSetting: 'stationary' }).shotsThisTick.map((e) => e.instanceId));
  return out;
}

describe('a held gun loads and waits', () => {
  it.each([
    ['ballistic', 'W-AC'],
    ['charged', 'W-LAS'],
    ['continuous or salvo', 'W-RKT'],
  ])('%s: held past its cycle, fires on the first released tick', (_label, partId) => {
    const s = sim([at('gun', partId, 1, 1)]);
    // Fire once so the gun starts from an empty load, then hold for 20 s.
    stepN(s, 400, ['gun']);
    stepN(s, 400, []);
    expect(s.instanceRuntime.get('gun')!.loaded).toBe(true);
    const ticks = stepN(s, 1, ['gun']);
    expect(ticks[0]).toContain('gun');
  });

  it('mixed guns released together fire on the same tick', () => {
    const s = sim([at('ac', 'W-AC', 1, 1), at('las', 'W-LAS', 5, 1)]);
    stepN(s, 400, []);
    const [first] = stepN(s, 1, ['ac', 'las']);
    expect(first).toEqual(expect.arrayContaining(['ac', 'las']));
  });

  it('a held gun does not fire', () => {
    const s = sim([at('ac', 'W-AC', 1, 1)]);
    expect(stepN(s, 400, []).flat()).toHaveLength(0);
  });

  it('a full charged gun fires on release even when the bus cannot feed it that tick', () => {
    // Review Focus 5: the shot is paid for; brownout must not swallow it.
    const s = sim([at('las', 'W-LAS', 5, 1)], 'R-E25');
    stepN(s, 400, []);
    expect(s.instanceRuntime.get('las')!.loaded).toBe(true);
    const weaponsEnabled = { las: true };
    const snap = s.step(DT, { weaponsEnabled, speedSetting: 'flank' }); // flank competes for the bus
    expect(snap.shotsThisTick.map((e) => e.instanceId)).toContain('las');
  });
});
```

Check the placements against the shipped fixture layout first. `mechanicalFire.test.ts` places `W-MG` at (1,1) and `W-LAS` at (5,1) on CH-5 with this exact wire row. If `W-AC` or `W-RKT` does not fit at (1,1), use the origin `templates.ts` gives that part on a CH-5 build (for example `muleGunline` for `W-AC`). Do not change the test's intent.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run sim:test -- heldLoad`

Expected:
- FAIL, because `loaded` is undefined;
- the charged case does not fire on the first released tick;
- "a held gun does not fire" may already pass.

- [ ] **Step 3: Implement in `simulation.ts`**

`InstanceRuntime`: add

```ts
  /** The next shot needs only the trigger (MW spec §1). Recomputed at the end of every step. */
  loaded: boolean;
```

and `loaded: false` in `freshRuntime()`.

At the top of `step`, after `M` is defined:

```ts
    /** The one "is this gun cleared to fire" test for every firing class. */
    const triggered = (id: string): boolean => command.weaponsEnabled[id] === true;
```

- **Step 2 (cap-fed):** replace `const enabled = command.weaponsEnabled[p.instanceId] === true;` with `const enabled = triggered(p.instanceId);`.
- **Step 3:** replace the weapon branch (`if (def.category === 'weapon') { ... }`):

```ts
      if (def.category === 'weapon') {
        const enabled = triggered(p.instanceId);
        if (def.draw?.continuousKw) {
          if (enabled) kw = def.draw.continuousKw * M(p.instanceId).drawKw;
          // Held: the load keeps coming and waits at full (MW spec §1). The draw
          // is the shot's, so a held continuous gun asks for nothing.
          else rt.cycleTimer = Math.min(def.weapon!.cycleS * M(p.instanceId).cycleS, rt.cycleTimer + dtSec);
        } else if (
          def.draw?.chargedEnergyPerShotKj && rt.cooldownRemainingS <= 0
          && rt.chargeKj < def.draw.chargedEnergyPerShotKj
        ) {
          // Charges whether or not it is cleared to fire, until full. The
          // threshold is the unscaled shot energy -- the same one step 6c fires at.
          kw = (def.draw.maxChargeKw ?? 0) * M(p.instanceId).drawKw;
        }
      }
```

- **Step 6 (charged branch):** replace it with a charge-only accumulator:

```ts
      } else if (def.draw?.chargedEnergyPerShotKj) {
        rt.chargeKj = Math.min(def.draw.chargedEnergyPerShotKj, rt.chargeKj + kw * dtSec);
      }
```

- **New step 6c**, after the 6b loop:

```ts
    // --- 6c. Fire charged weapons from a full charge ---
    //
    // Split from charging (step 6) so a charged gun held full can fire the tick
    // it is released, whether or not the bus feeds it that tick (MW spec §1):
    // the shot's energy is already in the gun.
    for (const p of this.parts) {
      const def = getPart(p.partId);
      if (def.category !== 'weapon' || !def.draw?.chargedEnergyPerShotKj) continue;
      if (!this.networkIdByInstance.has(p.instanceId)) continue;
      const rt = this.runtime.get(p.instanceId)!;
      if (rt.destroyed || rt.isShutdown || rt.cookedOff) continue;
      if (!triggered(p.instanceId) || rt.cooldownRemainingS > 0) continue;
      if (rt.chargeKj < def.draw.chargedEnergyPerShotKj) continue;
      const eff = M(p.instanceId);
      shotsThisTick.push({ tSec: this.tSec, instanceId: p.instanceId, partId: p.partId, totalDamage: def.weapon!.damage * eff.damage });
      if (def.heat?.heatPerShotKj) addHeat(this.thermal.cellKeysByInstance.get(p.instanceId)!, def.heat.heatPerShotKj * (this.coveredHeatMultByInstance.get(p.instanceId) ?? 1));
      rt.chargeKj = 0;
      rt.cooldownRemainingS = def.weapon!.cycleS * eff.cycleS - (def.draw.minChargeS ?? 0);
    }
```

- **Step 6b (mechanical):** replace `if (command.weaponsEnabled[p.instanceId] !== true) continue;` and the `cycleS` line with:

```ts
      const eff = M(p.instanceId);
      const cycleS = def.weapon!.cycleS * eff.cycleS;
      if (!triggered(p.instanceId)) {
        rt.cycleTimer = Math.min(cycleS, rt.cycleTimer + dtSec); // held: load and wait (MW spec §1)
        continue;
      }
```

Then remove the now-duplicate `eff` and `cycleS` declarations below it.

- **Loaded pass**, immediately before building `cellTempsC`:

```ts
    // --- 12. Loaded flags (MW spec §1): what an Alpha would fire right now ---
    for (const p of this.parts) {
      const def = getPart(p.partId);
      if (def.category !== 'weapon') continue;
      const rt = this.runtime.get(p.instanceId)!;
      const usable = !rt.destroyed && !rt.isShutdown && !rt.cookedOff && this.networkIdByInstance.has(p.instanceId);
      rt.loaded = usable && (
        def.draw?.capFedEnergyPerShotKj ? rt.cooldownRemainingS <= 0
          : def.draw?.chargedEnergyPerShotKj ? rt.cooldownRemainingS <= 0 && rt.chargeKj >= def.draw.chargedEnergyPerShotKj
            : rt.cycleTimer >= def.weapon!.cycleS * M(p.instanceId).cycleS
      );
    }
```

In `combat.ts`:
- add to `WeaponFrame`: `/** Loaded and waiting only on the trigger (MW spec §1). */ loaded: boolean;`
- set `loaded: rt.loaded` in `sampleMechFrame`'s `weapons.push`.

- [ ] **Step 4: Run the tests**

Run: `npm run sim:test`

Expected: `heldLoad` passes and the golden battle **fails**, because held lasers now pre-charge and charged shots are ordered after mechanical ones within a tick. First confirm that the shift comes from this change:
- `git stash` the `simulation.ts` edits and confirm the golden passes;
- `git stash pop`.

Then re-pin under the Global Constraints rule. The comment should say: "held guns load and wait, and charged guns fire from a full charge (MW spec §1)". Fix any other failing test only if its assertion encoded "a held gun stops loading". Quote the old assertion in the commit message.

- [ ] **Step 5: Check for silent mechs**

Run: `npm run sim:hitrate -- 2`, both before (on `git stash`) and after.

Expected: the total shot count across the round robin moves by less than 25%, and no weapon row drops to 0 shots. If a weapon goes silent, stop and debug with superpowers:systematic-debugging (memory: silent-mech combat bugs).

- [ ] **Step 6: Commit**

```bash
git add packages/sim/src/simulation.ts packages/sim/src/combat.ts packages/sim/test/heldLoad.test.ts packages/sim/test/determinism.test.ts packages/sim/src/version.ts
git commit -m "A held gun loads and waits, so guns released together fire together"
```

---

### Task 4: Alpha, a one-shot volley token

**Files:**
- Modify: `packages/sim/src/simulation.ts`:
  - `InstanceRuntime.volleyPending`;
  - `triggered`;
  - clearing on fire;
  - a new `armVolley()`.
- Modify: `packages/sim/src/combat.ts`:
  - `MechOrder` weapons variant;
  - `ManualOrders.alpha`;
  - `mergeManualOrders`;
  - `Combatant.commandVolley`;
  - `Battle.issueOrders`;
  - the `BattleEvent` `alpha`;
  - `stateHash`.
- Test: create `packages/sim/test/alpha.test.ts`, and extend `packages/sim/test/lockstep.test.ts`

**Interfaces:**
- Produces:
  - `MechOrder` weapons: `{ verb: 'weapons'; enabled: Record<string, boolean>; volley?: number }`
  - `ManualOrders.alpha?: number`: a monotonically increasing press counter. `undefined` or `0` means never pressed.
  - `Simulation.armVolley(): string[]`: marks every `loaded` weapon `volleyPending` and returns their ids.
  - `Combatant.commandVolley(token: number): string[] | null`: `null` when the token is not newer than the last one seen.
  - `BattleEvent` `{ tSec: number; type: 'alpha'; mech: 0 | 1; instanceIds: string[] }`

- [ ] **Step 1: Write the failing tests**

`packages/sim/test/alpha.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Battle, autopilotController, withManualOrders, type ManualOrders } from '../src/combat.js';
import { TEMPLATES } from '../src/templates.js';
import { getPart } from '../src/catalog.js';

/** MW spec §3: Alpha fires every loaded gun once, then leaves each in its previous state. */
const gunline = TEMPLATES.find((t) => t.id === 'mule-gunline')!.build;

function fight(manual: () => ManualOrders) {
  return new Battle({
    builds: [gunline, gunline], seed: 9, spawnDistanceM: 60, timeoutS: 30,
    controllers: [withManualOrders(autopilotController, manual), autopilotController],
  });
}
const gunIds = gunline.parts.filter((p) => getPart(p.partId).category === 'weapon').map((p) => p.instanceId);
const hold = Object.fromEntries(gunIds.map((id) => [id, 'hold' as const]));

describe('Alpha', () => {
  it('fires each loaded gun exactly once, even though the order is re-issued every command tick', () => {
    let m: ManualOrders = { weapons: hold };
    const battle = fight(() => m);
    for (let t = 0; t < 100; t++) battle.step();       // 5 s held: everything loads
    m = { weapons: hold, alpha: 1 };
    for (let t = 0; t < 100; t++) battle.step();       // 5 s more with the same token
    const alphas = battle.events.filter((e) => e.type === 'alpha' && e.mech === 0);
    expect(alphas).toHaveLength(1);
    const shots = battle.events.filter((e) => e.type === 'shot' && e.mech === 0);
    for (const id of gunIds) expect(shots.filter((e) => e.type === 'shot' && e.instanceId === id)).toHaveLength(1);
  });

  it('a new token fires again once the guns have reloaded', () => {
    let m: ManualOrders = { weapons: hold };
    const battle = fight(() => m);
    for (let t = 0; t < 100; t++) battle.step();
    m = { weapons: hold, alpha: 1 };
    for (let t = 0; t < 200; t++) battle.step();
    m = { weapons: hold, alpha: 2 };
    for (let t = 0; t < 20; t++) battle.step();
    expect(battle.events.filter((e) => e.type === 'alpha' && e.mech === 0)).toHaveLength(2);
  });

  it('an unloaded gun ignores the token rather than firing when it later loads', () => {
    let m: ManualOrders = { weapons: hold };
    const battle = fight(() => m);
    for (let t = 0; t < 100; t++) battle.step();
    m = { weapons: hold, alpha: 1 };
    // Fired; now reloading. This relies on every gun on the template taking
    // longer than 0.5 s to reload -- assert it rather than assume it.
    for (const id of gunIds) expect(getPart(gunline.parts.find((p) => p.instanceId === id)!.partId).weapon!.cycleS).toBeGreaterThan(0.6);
    for (let t = 0; t < 10; t++) battle.step();
    m = { weapons: hold, alpha: 2 };                       // pressed while nothing is loaded
    const before = battle.events.filter((e) => e.type === 'shot' && e.mech === 0).length;
    for (let t = 0; t < 200; t++) battle.step();
    expect(battle.events.filter((e) => e.type === 'shot' && e.mech === 0).length).toBe(before);
  });
});
```

Also extend `packages/sim/test/lockstep.test.ts`. Read the file first and copy its existing "two drivers produce the same hash" pattern exactly. Write one case that issues a `TickOrder` with `manual: { weapons: hold, alpha: 1 }` at tick 100. It must assert that both peers' `stateHash()` are equal at the end, and that exactly one `alpha` event exists for that mech.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run sim:test -- alpha lockstep`

Expected: FAIL, because no `alpha` events are emitted.

- [ ] **Step 3: Implement**

`simulation.ts`:
- `InstanceRuntime`: add `/** Armed by an Alpha: fire once on the next chance, then clear (MW spec §3). */ volleyPending: boolean;`, and set `volleyPending: false` in `freshRuntime`.
- `triggered`:

  ```ts
  const triggered = (id: string): boolean =>
    command.weaponsEnabled[id] === true || this.runtime.get(id)?.volleyPending === true;
  ```

- Right after all firing steps (after 6c, before step 7), clear the flag on every gun that fired:

  ```ts
  for (const shot of shotsThisTick) this.runtime.get(shot.instanceId)!.volleyPending = false;
  ```

  This must run after step 2 as well. Step 2 pushes to the same `shotsThisTick`, so one pass after 6c covers every class.
- New public method:

  ```ts
  /**
   * Alpha (MW spec §3): every weapon loaded right now fires on its next chance,
   * once. Guns not loaded ignore it -- Alpha fires what is ready, as in
   * MechWarrior. Returns the armed ids.
   */
  armVolley(): string[] {
    const armed: string[] = [];
    for (const p of this.parts) {
      const rt = this.runtime.get(p.instanceId)!;
      if (getPart(p.partId).category === 'weapon' && rt.loaded) { rt.volleyPending = true; armed.push(p.instanceId); }
    }
    return armed;
  }
  ```

- Add an accessor for the hash: `volleyPendingIds(): string[]`, returning ids whose `volleyPending` is true, in `this.parts` order.

`combat.ts`:
- `MechOrder` weapons variant: `| { verb: 'weapons'; enabled: Record<string, boolean>; /** Alpha press token (MW spec §3). */ volley?: number }`
- `ManualOrders`: `/** Alpha press counter; only a value greater than the last one seen fires (MW spec §3). */ alpha?: number;`
- `mergeManualOrders` weapons branch: widen the guard to `(m.weapons || m.overrideHeat || m.alpha)`, and return `{ verb: 'weapons', enabled, ...(m.alpha ? { volley: m.alpha } : {}) }`.
- `Combatant`: add `private lastVolleyToken = 0;` and

  ```ts
  /** Arms an Alpha on a token newer than the last seen; re-issues of the same press are ignored. */
  commandVolley(token: number): string[] | null {
    if (token <= this.lastVolleyToken) return null;
    this.lastVolleyToken = token;
    return this.sim.armVolley();
  }
  ```

- `BattleEvent`: add `| { tSec: number; type: 'alpha'; mech: 0 | 1; instanceIds: string[] }`
- `Battle.issueOrders`: inside the loop, before `applyOrder`:

  ```ts
      if (order.verb === 'weapons' && order.volley !== undefined) {
        const armed = this.combatants[mech].commandVolley(order.volley);
        if (armed) this.events.push({ tSec: this.tSec, type: 'alpha', mech, instanceIds: armed });
      }
  ```

  Sticky latency does not apply to a volley. Say so in a one-line comment.
- `stateHash`: after the capacitor loop, add `u(c.sim.volleyPendingIds().length);`

Everything that switches over `BattleEvent['type']` must handle `'alpha'`. Run `npm run web:build` after this step to find them. The ticker (`BattleTicker`) should print `ALPHA — n guns`. Any other exhaustive switch can ignore it.

- [ ] **Step 4: Run the tests**

Run: `npm run sim:test && npm run web:build`

Expected: all pass, and the golden **moves**, because the hash now includes pending volleys. Re-pin under the Global Constraints rule.

- [ ] **Step 5: Commit**

```bash
git add packages/sim apps/web/src
git commit -m "Alpha: a one-shot volley token that fires every loaded gun once"
```

---

### Task 5: Mech-wide shutdown

Implements spec §4, using the threshold settled at Task 2's checkpoint.

**Files:**
- Modify: `packages/sim/src/simulation.ts`:
  - a constant;
  - a `mechShutdown` field and getter;
  - guards in steps 1, 2, 3, 4/5 and 7;
  - a trigger in step 11;
  - snapshot fields.
- Modify: `packages/sim/src/combat.ts`:
  - `BattleEvent` types;
  - `logTransitions`;
  - `integrateMovement` (no turning);
  - `MechFrame` fields;
  - `stateHash`.
- Test: create `packages/sim/test/mechShutdown.test.ts`

**Interfaces:**
- Produces:
  - `export const HEAT_MECH_SHUTDOWN_C` in `simulation.ts`
  - `Simulation.isMechShutdown: boolean` (getter)
  - `SimSnapshot.mechShutdown: boolean`
  - `SimSnapshot.reactorCoreC: number`: the hottest reactor or core cell
  - `BattleEvent` `{ tSec; type: 'mech-shutdown' | 'mech-restart'; mech: 0 | 1; tempC: number }`
  - `MechFrame.mechShutdown: boolean`
  - `MechFrame.reactorCoreC: number`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { Simulation, HEAT_MECH_SHUTDOWN_C, HEAT_RESTART_C } from '../src/simulation.js';
import { Battle } from '../src/combat.js';
import { CORE_INSTANCE_ID } from '../src/thermal.js';
import { TEMPLATES } from '../src/templates.js';
import { getChassis } from '../src/chassis.js';
import { getPart } from '../src/catalog.js';

/** MW spec §4: an overheated reactor or core shuts the whole mech down until it cools. */
const gunline = TEMPLATES.find((t) => t.id === 'mule-gunline')!.build;
const reactorAndCore = (s: Simulation) => [
  CORE_INSTANCE_ID,
  ...s.parts.filter((p) => getPart(p.partId).category === 'reactor').map((p) => p.instanceId),
].flatMap((id) => s.thermal.cellKeysByInstance.get(id) ?? []);
const setTemp = (s: Simulation, c: number) => { for (const k of reactorAndCore(s)) s.thermal.cells.get(k)!.tempC = c; };
const allGuns = Object.fromEntries(gunline.parts.filter((p) => getPart(p.partId).category === 'weapon').map((p) => [p.instanceId, true]));

describe('mech-wide shutdown', () => {
  it('trips at the threshold: nothing fires, nothing is supplied, and it restarts only below the restart line', () => {
    const s = new Simulation(getChassis(gunline.chassisId), gunline);
    for (let i = 0; i < 100; i++) s.step(0.05, { weaponsEnabled: allGuns, speedSetting: 'cruise' });
    setTemp(s, HEAT_MECH_SHUTDOWN_C + 1);
    let snap = s.step(0.05, { weaponsEnabled: allGuns, speedSetting: 'cruise' });
    expect(snap.mechShutdown).toBe(true);
    for (let i = 0; i < 40; i++) {
      setTemp(s, HEAT_RESTART_C + 5);                     // cooler, but not cool enough
      snap = s.step(0.05, { weaponsEnabled: allGuns, speedSetting: 'cruise' });
      expect(snap.mechShutdown).toBe(true);
      expect(snap.shotsThisTick).toHaveLength(0);
      expect(snap.totalSupplyKw).toBe(0);
    }
    setTemp(s, HEAT_RESTART_C - 5);
    snap = s.step(0.05, { weaponsEnabled: allGuns, speedSetting: 'cruise' });
    expect(snap.mechShutdown).toBe(false);
  });

  it('nothing loads while shut down, so Alpha finds nothing to fire and no volley waits for the restart', () => {
    // Review Focus 4.
    const s = new Simulation(getChassis(gunline.chassisId), gunline);
    for (let i = 0; i < 100; i++) s.step(0.05, { weaponsEnabled: allGuns, speedSetting: 'stationary' });
    setTemp(s, HEAT_MECH_SHUTDOWN_C + 1);
    s.step(0.05, { weaponsEnabled: {}, speedSetting: 'stationary' });
    expect(s.armVolley()).toEqual([]);
  });

  it('in battle: logs both transitions, and the shut-down mech neither turns nor drives', () => {
    const battle = new Battle({ builds: [gunline, gunline], seed: 3, timeoutS: 20 });
    for (let t = 0; t < 40; t++) battle.step();
    const me = battle.combatants[0];
    setTemp(me.sim, HEAT_MECH_SHUTDOWN_C + 1);
    battle.step();
    const facing = me.facingRad;
    for (let t = 0; t < 20; t++) { setTemp(me.sim, HEAT_MECH_SHUTDOWN_C + 1); battle.step(); }
    expect(me.facingRad).toBe(facing);
    expect(Math.hypot(me.vel.x, me.vel.y)).toBeLessThan(0.5);
    setTemp(me.sim, 30);
    battle.step();
    const types = battle.events.filter((e) => e.type === 'mech-shutdown' || e.type === 'mech-restart').map((e) => e.type);
    expect(types).toEqual(['mech-shutdown', 'mech-restart']);
    expect(battle.latestFrame()!.mechs[0].mechShutdown).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run sim:test -- mechShutdown`

Expected: FAIL at import, because `HEAT_MECH_SHUTDOWN_C` is not exported.

- [ ] **Step 3: Implement in `simulation.ts`**

Constant, beside the heat ladder, using the value settled at Task 2's checkpoint:

```ts
/**
 * The reactor or core at or above this shuts the whole mech down (MW spec §4):
 * no fire, no drive, no reactor, until those cells fall below HEAT_RESTART_C.
 * Only OVR can get here -- the autopilot never passes fire-hold. See docs/17 F77.
 */
export const HEAT_MECH_SHUTDOWN_C = HEAT_SHUTDOWN_C;
```

Field and getter: `private mechShutdown = false;` and `get isMechShutdown(): boolean { return this.mechShutdown; }`.

Guards:
- **Top of `step`, before `triggered`:**

  ```ts
  if (this.mechShutdown) command = { ...command, weaponsEnabled: {}, speedSetting: 'stationary' };
  ```

  `command` is a parameter, so reassigning it is fine. `triggered` must also return false while shut down. Prefix it with `!this.mechShutdown && (...)`.
- **Held loading** in step 3 (continuous) and step 6b (mechanical): only advance `cycleTimer` when `!this.mechShutdown`.
- **Step 3 charged request:** add `&& !this.mechShutdown`.
- **Step 1:** at the top of the loop body, `if (this.mechShutdown) { this.reactorAvailableKw.set(p.instanceId, 0); continue; }`
- **Step 4:** `const capBudgetKw = this.mechShutdown ? 0 : Math.min(pooledDischargeKw, availableStoredKj / dtSec);`
- **Step 5:** wrap both the discharge and charge blocks in `if (!this.mechShutdown) { ... }`.
- **Step 7:** at the top of the loop body, `if (this.mechShutdown) continue;`. A reactor that is off makes no waste heat.
- **Loaded pass (step 12):** add `!this.mechShutdown &&` to `usable`.

Trigger, at the end of step 11:

```ts
    let reactorCoreC = AMBIENT_C;
    for (const id of [CORE_INSTANCE_ID, ...this.parts.filter((p) => getPart(p.partId).category === 'reactor').map((p) => p.instanceId)]) {
      reactorCoreC = Math.max(reactorCoreC, this.hottestCellC(id));
    }
    if (!this.mechShutdown && reactorCoreC >= HEAT_MECH_SHUTDOWN_C) this.mechShutdown = true;
    else if (this.mechShutdown && reactorCoreC < HEAT_RESTART_C) this.mechShutdown = false;
```

Add `mechShutdown: boolean; reactorCoreC: number;` to `SimSnapshot`, and include `mechShutdown: this.mechShutdown, reactorCoreC` in the returned object.

Also check the per-part shutdown line in step 11. It still reads `hottest < 110` as a literal. Replace it with `HEAT_RESTART_C` while you are there.

- [ ] **Step 4: Implement in `combat.ts`**

- `BattleEvent`: `| { tSec: number; type: 'mech-shutdown' | 'mech-restart'; mech: 0 | 1; tempC: number }`
- `Battle`: `private lastMechShutdown: [boolean, boolean] = [false, false];`. In `logTransitions`:

  ```ts
      if (snapshot.mechShutdown !== this.lastMechShutdown[i]) {
        this.events.push({ tSec: this.tSec, type: snapshot.mechShutdown ? 'mech-shutdown' : 'mech-restart', mech: i, tempC: snapshot.reactorCoreC });
        this.lastMechShutdown[i] = snapshot.mechShutdown;
      }
  ```

- `integrateMovement`: add a trailing parameter `frozen = false`. Wrap the facing update in `if (!frozen && tSec >= self.staggerUntilS)`, and treat `frozen` like `locomotionShed` for `targetVel`: `if (self.destination && !locomotionShed && !frozen)`. The mech decelerates at its normal accel rather than stopping dead. In `Battle.step`, pass `this.lastSnapshots[i]?.mechShutdown ?? false`.
- `MechFrame`:

  ```ts
  /** Whole-mech reactor shutdown (MW spec §4). */
  mechShutdown: boolean;
  /** Hottest reactor or core cell, °C. */
  reactorCoreC: number;
  ```

  In `sampleMechFrame`, set `mechShutdown: snap?.mechShutdown ?? false, reactorCoreC: snap?.reactorCoreC ?? HEAT_AMBIENT_C`.
- `stateHash`: `u(c.sim.isMechShutdown ? 1 : 0);`
- The ticker in apps/web prints `REACTOR SHUTDOWN` and `REACTOR RESTART` for the new events. Run `npm run web:build` to find the switch.

- [ ] **Step 5: Run the tests**

Run: `npm run sim:test && npm run web:build`

Expected: all pass. The golden moves only through the hash term. The fight itself should not change, because nothing in the golden reaches the reactor threshold. Re-pin under the Global Constraints rule, and state in the comment that the outcome, duration and shots are unchanged. If they *did* change, investigate before re-pinning.

- [ ] **Step 6: Commit**

```bash
git add packages/sim apps/web/src
git commit -m "Mech-wide shutdown when the reactor or core overheats"
```

---

### Task 6: Weapon groups on the build, and the workshop editor

**Files:**
- Modify: `packages/sim/src/types.ts` (`Build`, around :378)
- Create: `packages/sim/src/weaponGroups.ts`, exported from `packages/sim/src/index.ts`
- Test: create `packages/sim/test/weaponGroups.test.ts`
- Modify: `packages/game/src/types.ts`, `packages/game/src/domain.ts` (:46, :64, :566), `packages/game/src/persistence.ts` (:69) and `apps/web/src/state/profileState.ts` (:181): carry `weaponGroups` wherever a Build is copied field by field.
- Modify: `apps/web/src/state/useBuild.ts`:
  - `EditorState`;
  - `Action`;
  - `LOAD_BUILD`;
  - a new `SET_WEAPON_GROUP` case;
  - the `build` memo;
  - the returned API.
- Test: `apps/web/src/state/useBuild.test.ts`
- Create: `apps/web/src/components/WeaponGroupList.tsx`
- Modify: `apps/web/src/components/ReadoutSheet.tsx` (a new prop, rendered under `PowerPriorityList`) and `apps/web/src/App.tsx` (:967, pass `setWeaponGroup`)

**Interfaces:**
- Produces:
  - `Build.weaponGroups?: string[][]`
  - `export const MAX_WEAPON_GROUPS = 3`
  - `export function defaultWeaponGroups(build: Build): string[][]`: always length 3.
  - `export function normaliseWeaponGroups(build: Build): string[][]`: always length 3; only live weapon ids; each id at most once.
  - `useBuild().setWeaponGroup(instanceId: string, group: number | null): void`

- [ ] **Step 1: Write the failing sim tests**

```ts
import { describe, expect, it } from 'vitest';
import { defaultWeaponGroups, normaliseWeaponGroups, MAX_WEAPON_GROUPS } from '../src/weaponGroups.js';
import { TEMPLATES } from '../src/templates.js';
import { getPart } from '../src/catalog.js';
import type { Build } from '../src/types.js';

const guns = (b: Build) => b.parts.filter((p) => getPart(p.partId).category === 'weapon').map((p) => p.instanceId);

describe('weapon groups (MW spec §2)', () => {
  it('defaults every gun into exactly one of three groups, long reach first', () => {
    for (const t of TEMPLATES) {
      const g = defaultWeaponGroups(t.build);
      expect(g).toHaveLength(MAX_WEAPON_GROUPS);
      expect(g.flat().sort()).toEqual(guns(t.build).sort());
      expect(g[2]).toEqual([]);
      const reach = (id: string) => getPart(t.build.parts.find((p) => p.instanceId === id)!.partId).weapon!.falloff.idealMax;
      for (const long of g[0]!) for (const short of g[1]!) expect(reach(long)).toBeGreaterThan(reach(short));
    }
  });

  it('a build with no guns gets three empty groups', () => {
    expect(defaultWeaponGroups({ chassisId: 'CH-5', parts: [], powerPriority: [] })).toEqual([[], [], []]);
  });

  it('drops ids that are no longer guns on the build, and duplicates (Review Focus 3)', () => {
    const b = TEMPLATES[0]!.build;
    const [first] = guns(b);
    const g = normaliseWeaponGroups({ ...b, weaponGroups: [[first!, 'gone'], [first!], ['also-gone']] });
    expect(g).toEqual([[first], [], []]);
  });

  it('pads short lists and ignores a fourth group', () => {
    const b = TEMPLATES[0]!.build;
    const ids = guns(b);
    expect(normaliseWeaponGroups({ ...b, weaponGroups: [[ids[0]!]] })).toHaveLength(3);
    expect(normaliseWeaponGroups({ ...b, weaponGroups: [[], [], [], [ids[0]!]] }).flat()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run sim:test -- weaponGroups`

Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement the sim side**

`types.ts`, in `Build` after `powerPriority`:

```ts
  /**
   * Up to three player-assigned weapon groups of instanceIds (MW spec §2).
   * Control data only: the sim never reads it. Absent = defaultWeaponGroups.
   */
  weaponGroups?: string[][];
```

`weaponGroups.ts`:

```ts
import { getPart } from './catalog.js';
import type { Build } from './types.js';

/** Group chips on the live console (MW spec §2). */
export const MAX_WEAPON_GROUPS = 3;

function weaponParts(build: Build) {
  return build.parts.filter((p) => getPart(p.partId).category === 'weapon');
}

/**
 * Long guns in G1, short guns in G2, G3 empty. "Long" is idealMax at or above
 * the build's upper median, so two guns of different reach always split, and
 * guns of equal reach stay together in G1.
 */
export function defaultWeaponGroups(build: Build): string[][] {
  const guns = weaponParts(build);
  if (guns.length === 0) return [[], [], []];
  const reach = (partId: string) => getPart(partId).weapon!.falloff.idealMax;
  const sorted = guns.map((p) => reach(p.partId)).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return [
    guns.filter((p) => reach(p.partId) >= median).map((p) => p.instanceId),
    guns.filter((p) => reach(p.partId) < median).map((p) => p.instanceId),
    [],
  ];
}

/** The build's groups, read safely: live weapon ids only, each at most once, always three lists. */
export function normaliseWeaponGroups(build: Build): string[][] {
  if (!build.weaponGroups) return defaultWeaponGroups(build);
  const live = new Set(weaponParts(build).map((p) => p.instanceId));
  const seen = new Set<string>();
  const out: string[][] = [];
  for (let i = 0; i < MAX_WEAPON_GROUPS; i++) {
    out.push((build.weaponGroups[i] ?? []).filter((id) => {
      if (!live.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    }));
  }
  return out;
}
```

Add `export * from './weaponGroups.js';` to `index.ts`.

The default test asserts `reach(long) > reach(short)`, and that holds by construction. If any template has a single gun, G2 is empty and the inner loop simply doesn't run.

- [ ] **Step 4: Carry groups through every field-by-field Build copy**

Run: `grep -rn "powerPriority: \[\.\.\.\|powerPriority: .*\.powerPriority" packages/game/src apps/web/src --include=*.ts --include=*.tsx | grep -v test`

At each hit that builds a `Build`, or the game's mech record, add the sibling line:

```ts
    ...(src.weaponGroups ? { weaponGroups: src.weaponGroups.map((g) => [...g]) } : {}),
```

Here `src` is whatever the line copies `powerPriority` from. Add `weaponGroups?: string[][]` to the game's mech type in `packages/game/src/types.ts` (the type that carries `powerPriority`). The filters at `domain.ts:454/477` need no twin, because `normaliseWeaponGroups` drops dead ids on read.

- [ ] **Step 5: Write the failing web reducer test**

Append to `apps/web/src/state/useBuild.test.ts`:

```ts
import { TEMPLATES, normaliseWeaponGroups } from '@mechbattler/sim';

describe('useBuild weapon groups (MW spec §2)', () => {
  it('moves a gun between groups and survives a load', () => {
    const tpl = TEMPLATES.find((t) => t.id === 'mule-gunline')!.build;
    const { result } = renderHook(() => useBuild(tpl.chassisId));
    act(() => result.current.loadBuild(tpl));
    const [gun] = normaliseWeaponGroups(result.current.build).flat();
    act(() => result.current.setWeaponGroup(gun!, 2));
    expect(normaliseWeaponGroups(result.current.build)[2]).toEqual([gun]);
    act(() => result.current.setWeaponGroup(gun!, null));
    expect(normaliseWeaponGroups(result.current.build).flat()).not.toContain(gun);
    const saved = result.current.build;
    act(() => result.current.loadBuild(saved));
    expect(result.current.build.weaponGroups).toEqual(saved.weaponGroups);
  });
});
```

Merge the import with the file's existing `@mechbattler/sim` import rather than adding a second one.

Run: `npm run web:test -- useBuild`

Expected: FAIL, because `setWeaponGroup` is not a function.

- [ ] **Step 6: Implement the reducer**

`useBuild.ts`:
- `EditorState`: `weaponGroups?: string[][];`
- `Action`: `| { type: 'SET_WEAPON_GROUP'; instanceId: string; group: number | null }`
- `LOAD_BUILD`: `weaponGroups: action.build.weaponGroups?.map((g) => [...g]),`
- New case:

  ```ts
      case 'SET_WEAPON_GROUP': {
        const current: Build = {
          chassisId: state.chassisId, parts: state.parts, powerPriority: state.powerPriority, weaponGroups: state.weaponGroups,
        };
        const groups = normaliseWeaponGroups(current).map((g) => g.filter((id) => id !== action.instanceId));
        if (action.group !== null) groups[action.group]!.push(action.instanceId);
        return { ...state, weaponGroups: groups };
      }
  ```

- `build` memo: add `...(state.weaponGroups ? { weaponGroups: state.weaponGroups } : {})`, and add `state.weaponGroups` to the dependency list.
- Returned API: `setWeaponGroup: (instanceId: string, group: number | null) => dispatch({ type: 'SET_WEAPON_GROUP', instanceId, group }),`

Import `normaliseWeaponGroups` from `@mechbattler/sim`.

- [ ] **Step 7: Build the editor**

`WeaponGroupList.tsx` follows `PowerPriorityList`'s structure and classes (`section-head`, `eyebrow`, `priority-row`, `priority-name`, `priority-btns`):

```tsx
import { getPart, normaliseWeaponGroups, MAX_WEAPON_GROUPS, type Build } from '@mechbattler/sim';

/** Assign each gun to G1-G3 or none (MW spec §2). Groups are what the live console's chips fire. */
export function WeaponGroupList({ build, onSet }: { build: Build; onSet: (instanceId: string, group: number | null) => void }) {
  const groups = normaliseWeaponGroups(build);
  const guns = build.parts.filter((p) => getPart(p.partId).category === 'weapon');
  const groupOf = (id: string) => groups.findIndex((g) => g.includes(id));
  return (
    <div>
      <div className="section-head"><span className="eyebrow">Weapon groups</span></div>
      {guns.length === 0 ? (
        <div className="priority-empty">No weapons placed yet.</div>
      ) : guns.map((p) => {
        const current = groupOf(p.instanceId);
        return (
          <div className="priority-row" key={p.instanceId}>
            <span className="priority-name">{getPart(p.partId).name}</span>
            <div className="priority-btns" role="group" aria-label={`Group for ${getPart(p.partId).name}`}>
              {Array.from({ length: MAX_WEAPON_GROUPS }, (_, g) => (
                <button key={g} type="button" aria-pressed={current === g} onClick={() => onSet(p.instanceId, g)}>G{g + 1}</button>
              ))}
              <button type="button" aria-pressed={current < 0} onClick={() => onSet(p.instanceId, null)} aria-label="No group">–</button>
            </div>
          </div>
        );
      })}
      <p className="stat-sub" style={{ marginTop: 8 }}>
        In a fight, each group has a chip: hold to load and wait, fire to release together. Ungrouped guns fire on Alpha and under the autopilot.
      </p>
    </div>
  );
}
```

`ReadoutSheet.tsx`: add the prop `onSetWeaponGroup: (instanceId: string, group: number | null) => void`, and render `<WeaponGroupList build={build} onSet={onSetWeaponGroup} />` right after `PowerPriorityList`. `App.tsx:967`: pass `onSetWeaponGroup={setWeaponGroup}` and destructure `setWeaponGroup` at :75.

- [ ] **Step 8: Run everything and look at it**

Run: `npm run sim:test && npm run game:test && npm run web:test && npm run web:build`

Expected: all pass.

Then open the readout sheet in the workshop at 390 px and look. Find the selector that opens the readout sheet by checking what `ReadoutBar.tsx` renders for its open button:

```bash
npm run web:shot -- 'http://localhost:5160/?view=workshop' "$SCRATCH/groups.png" --w 390 --h 844 --tap '<readout-bar open selector>' --waitFor '.priority-row' --tapText 'G2'
```

Open the PNG. The four buttons must fit on one row without clipping. Then run `node scripts/audit.mjs workshop` and expect it to pass: ≥44 px targets and no overflow.

- [ ] **Step 9: Commit**

```bash
git add packages/sim packages/game apps/web/src
git commit -m "Weapon groups: Build.weaponGroups, defaults from reach, and the workshop editor"
```

---

### Task 7: The live console: group chips, Alpha, OVR, keys, shutdown banner

**Files:**
- Create: `apps/web/src/state/groupOrders.ts` and `apps/web/src/state/groupOrders.test.ts`
- Modify: `apps/web/src/components/BattleLiveScreen.tsx`:
  - `ManualState`, `FULL_AUTO`, `isFullAuto`;
  - the controller closure;
  - the keys;
  - the Auto button;
  - a new `.live-groups` row;
  - `glassOverlay`;
  - the help caption.
- Modify: `apps/web/src/components/BattleHud.tsx`: `HeatColumn` gets an `override` prop, `BattleScene` gets a `heatOverride` pass-through, and a new exported `ShutdownBanner`.
- Modify: `apps/web/src/components/BattleLiveScreen.css`
- Test: create `apps/web/src/components/ShutdownBanner.test.tsx`

**Interfaces:**
- Consumes:
  - `normaliseWeaponGroups` (Task 6)
  - `ManualOrders.alpha` and `overrideHeat` (Tasks 1 and 4)
  - `WeaponFrame.loaded` (Task 3)
  - `MechFrame.mechShutdown` and `reactorCoreC` (Task 5)
  - `HEAT_RESTART_C`, `HEAT_MECH_SHUTDOWN_C`
- Produces:
  - `export type GroupState = 'auto' | 'hold' | 'fire'`
  - `export function expandGroupOrders(groups: string[][], states: GroupState[], perGun: Record<string, WeaponOverride>): Record<string, WeaponOverride>`
  - `export function cycleGroupState(s: GroupState): GroupState`
  - `export function resetToAuto<T extends { alpha: number }>(m: T, auto: Omit<T, 'alpha'>): T`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/state/groupOrders.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { expandGroupOrders, cycleGroupState, resetToAuto } from './groupOrders.js';

describe('group orders (MW spec §3)', () => {
  const groups = [['a', 'b'], ['c'], []];

  it('AUTO adds nothing, HOLD holds, FIRE forces', () => {
    expect(expandGroupOrders(groups, ['auto', 'auto', 'auto'], {})).toEqual({});
    expect(expandGroupOrders(groups, ['hold', 'fire', 'auto'], {})).toEqual({ a: 'hold', b: 'hold', c: 'force' });
  });

  it('a per-gun setting wins over its group', () => {
    expect(expandGroupOrders(groups, ['hold', 'auto', 'auto'], { b: 'force' })).toEqual({ a: 'hold', b: 'force' });
  });

  it('cycles AUTO → HOLD → FIRE → AUTO', () => {
    expect(cycleGroupState('auto')).toBe('hold');
    expect(cycleGroupState('hold')).toBe('fire');
    expect(cycleGroupState('fire')).toBe('auto');
  });

  it('returning to auto keeps the Alpha counter, or every later press would be ignored (Review Focus 1)', () => {
    const m = { alpha: 4, groups: ['fire', 'hold', 'auto'], overrideHeat: true };
    const reset = resetToAuto(m, { groups: ['auto', 'auto', 'auto'], overrideHeat: false });
    expect(reset.alpha).toBe(4);
    expect(reset.groups).toEqual(['auto', 'auto', 'auto']);
  });
});
```

`apps/web/src/components/ShutdownBanner.test.tsx`. Match the render and import style of `DamageGrid.test.tsx`.

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HEAT_RESTART_C } from '@mechbattler/sim';
import { ShutdownBanner } from './BattleHud.js';

describe('ShutdownBanner (MW spec §5)', () => {
  it('renders nothing while the reactor runs', () => {
    const { container } = render(<ShutdownBanner mechShutdown={false} reactorCoreC={90} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('names the restart line from the sim and how far there is to cool', () => {
    render(<ShutdownBanner mechShutdown reactorCoreC={HEAT_RESTART_C + 14} />);
    expect(screen.getByRole('status').textContent).toContain(`${HEAT_RESTART_C}°`);
    expect(screen.getByRole('status').textContent).toContain('14°');
  });
});
```

Run: `npm run web:test -- groupOrders ShutdownBanner`

Expected: FAIL, because the modules do not exist.

- [ ] **Step 2: Implement `groupOrders.ts`**

```ts
import type { WeaponOverride } from '../components/BattleHud.js';

/** A group chip's standing order (MW spec §3). */
export type GroupState = 'auto' | 'hold' | 'fire';

export function cycleGroupState(s: GroupState): GroupState {
  return s === 'auto' ? 'hold' : s === 'hold' ? 'fire' : 'auto';
}

/**
 * Groups onto the per-gun override map the sim already takes. HOLD holds (and,
 * since a held gun loads and waits, readies a volley); FIRE forces; a per-gun
 * setting wins over its group.
 */
export function expandGroupOrders(
  groups: string[][], states: GroupState[], perGun: Record<string, WeaponOverride>,
): Record<string, WeaponOverride> {
  const out: Record<string, WeaponOverride> = {};
  groups.forEach((ids, g) => {
    const s = states[g] ?? 'auto';
    if (s === 'auto') return;
    for (const id of ids) out[id] = s === 'hold' ? 'hold' : 'force';
  });
  return { ...out, ...perGun };
}

/**
 * Everything back to auto except the Alpha counter. The sim ignores any token
 * not greater than the last it saw, so zeroing it would silently disarm Alpha
 * for the rest of the fight.
 */
export function resetToAuto<T extends { alpha: number }>(m: T, auto: Omit<T, 'alpha'>): T {
  return { ...auto, alpha: m.alpha } as T;
}
```

Check where `WeaponOverride` is actually exported from: `grep -rn "type WeaponOverride" apps/web/src`. Import it from there.

- [ ] **Step 3: Implement `ShutdownBanner` and the HeatColumn override in `BattleHud.tsx`**

```tsx
/**
 * The whole mech is down (MW spec §4). It restarts when the reactor and core
 * cool below HEAT_RESTART_C, so the banner says how far that is -- from the
 * frame, not a countdown the HUD would have to model.
 */
export function ShutdownBanner({ mechShutdown, reactorCoreC }: { mechShutdown: boolean; reactorCoreC: number }) {
  if (!mechShutdown) return null;
  const toGo = Math.max(0, Math.ceil(reactorCoreC - HEAT_RESTART_C));
  return (
    <div className="shutdown-banner" role="status">
      <span className="shutdown-title">REACTOR SHUTDOWN</span>
      <span className="shutdown-sub">restarts below {HEAT_RESTART_C}° · {toGo}° to go</span>
    </div>
  );
}
```

Import `HEAT_RESTART_C` from `@mechbattler/sim` alongside the existing heat imports.

`HeatColumn`:
- add `override?: boolean` to its props;
- root class `heatcol${override ? ' ovr' : ''}`;
- when `override` is set and `tempC >= HEAT_FIRE_HOLD_C`, the risk text reads `'Override'` with class `warn`, instead of `'Holding fire'`.

`BattleScene`:
- add the prop `heatOverride?: boolean`;
- pass it through as `<HeatColumn ... override={heatOverride} />`.

- [ ] **Step 4: Wire `BattleLiveScreen.tsx`**

`ManualState`: add

```ts
  /** Per-group chip orders, G1..G3 (MW spec §3). */
  groups: GroupState[];
  /** OVR: fire through the autopilot's heat hold. */
  overrideHeat: boolean;
  /** Alpha press counter. Only ever increases -- see resetToAuto. */
  alpha: number;
```

- `FULL_AUTO` gains `groups: ['auto', 'auto', 'auto'], overrideHeat: false, alpha: 0`.
- `isFullAuto` also requires every group to be `'auto'` and `!m.overrideHeat`.
- Every place that currently does `setManual(FULL_AUTO)` becomes `setManual((m) => resetToAuto(m, FULL_AUTO))`. That covers the `a` key and the Auto button's else-branch. In the Auto button's "release" branch, the spread `...m` already keeps `alpha`.

Groups: `const groups = useMemo(() => normaliseWeaponGroups(build), [build]);`. The controller closure's `weapons` becomes:

```ts
          const weapons = expandGroupOrders(groups, m.groups, m.weapons);
          return {
            // ...existing move/throttle/face...
            weapons: Object.keys(weapons).length > 0 ? weapons : undefined,
            overrideHeat: m.overrideHeat || undefined,
            alpha: m.alpha || undefined,
          };
```

`groups` must be read inside the `useState(() => new Battle(...))` initialiser. Compute it before that `useState`, or read it through a ref, so the closure does not capture a stale value. The build does not change during a fight, so computing it once before the `useState` is correct.

Handlers:

```ts
  const cycleGroup = (g: number) => setManual((m) => ({ ...m, groups: m.groups.map((s, i) => (i === g ? cycleGroupState(s) : s)) }));
  const fireAlpha = () => setManual((m) => ({ ...m, alpha: m.alpha + 1 }));
  const toggleOverride = () => setManual((m) => ({ ...m, overrideHeat: !m.overrideHeat }));
```

Keys: replace the `1`–`9` branch with:

```ts
      } else if (e.key >= '1' && e.key <= '3') {
        cycleGroup(Number(e.key) - 1);
      } else if (e.key.toLowerCase() === 'x') {
        fireAlpha();
      } else if (e.key.toLowerCase() === 'o') {
        toggleOverride();
```

Space stays pause. Update the keybinding comment and the help caption to: `keys: space pause · 1–3 cycle weapon group · X alpha · O heat override · H hold position · F face mode · A full auto · right-click revert move`.

New row, directly after the `live-orders` div:

```tsx
          {/* Weapon groups (MW spec §3). Fixed-width chips: the state word and the
              loaded fill change, the box never does (docs/14). */}
          <div className="live-groups orders" role="group" aria-label="Weapon groups">
            {groups.map((ids, g) => {
              const frames = (live?.weapons ?? []).filter((w) => ids.includes(w.instanceId));
              const loaded = frames.filter((w) => w.loaded).length;
              return (
                <button
                  key={g} type="button" className="obtn grp"
                  disabled={ids.length === 0}
                  aria-pressed={manual.groups[g] !== 'auto'}
                  onClick={() => cycleGroup(g)}
                  title={`Group ${g + 1}: ${ids.length} guns, ${loaded} loaded — tap to cycle auto / hold / fire`}
                >
                  <span className="grp-fill" style={{ width: `${ids.length ? (100 * loaded) / ids.length : 0}%` }} />
                  <span className="grp-k">G{g + 1}</span>
                  <span className="grp-v">{manual.groups[g]}</span>
                </button>
              );
            })}
            <button
              type="button" className="obtn alpha"
              disabled={!live || live.mechShutdown}
              onClick={fireAlpha}
              title="Alpha strike: fire every loaded gun once"
            >
              Alpha {live ? live.weapons.filter((w) => w.loaded).length : 0}
            </button>
            <button
              type="button" className="obtn ovr"
              aria-pressed={manual.overrideHeat}
              onClick={toggleOverride}
              title={`Heat override: fire past ${HEAT_FIRE_HOLD_C}°C. The reactor shuts the mech down at ${HEAT_MECH_SHUTDOWN_C}°C.`}
            >
              OVR
            </button>
          </div>
```

Import `HEAT_FIRE_HOLD_C` and `HEAT_MECH_SHUTDOWN_C` from `@mechbattler/sim`. They are only in a tooltip, but they must still be read from the sim.

`glassOverlay`: render both overlays.

```tsx
            glassOverlay={<>
              {live && <ShutdownBanner mechShutdown={live.mechShutdown} reactorCoreC={live.reactorCoreC} />}
              {moveMode === 'waypoint' && (<div className="waypoint-bar">…unchanged…</div>)}
            </>}
```

Pass `heatOverride={manual.overrideHeat}` to `BattleScene`.

- [ ] **Step 5: Styles in `BattleLiveScreen.css`**

Do not edit `battle.css` or `shell.css`. Read the `.orders` / `.obtn` rules in `battle.css` first, so these rules extend those and don't fight them.

```css
.battle-app .live-groups { display: grid; grid-template-columns: repeat(3, 1fr) 1.2fr 0.8fr; gap: 6px; }
.battle-app .live-groups .obtn { min-height: 44px; position: relative; overflow: hidden; }
.battle-app .grp { display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.1; }
.battle-app .grp-fill { position: absolute; left: 0; bottom: 0; height: 3px; background: var(--acc, currentColor); transition: width .15s linear; }
.battle-app .grp-k { font-weight: 700; }
.battle-app .grp-v { font-size: 11px; text-transform: uppercase; opacity: .8; }
.battle-app .obtn.ovr[aria-pressed="true"] { color: var(--bad, #ff5a4f); border-color: currentColor; }
.battle-app .heatcol.ovr .heat-track { outline: 1px solid var(--bad, #ff5a4f); }
.battle-app .shutdown-banner {
  position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%);
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 8px 14px; background: rgba(0, 0, 0, .72); border: 1px solid var(--bad, #ff5a4f);
  color: var(--bad, #ff5a4f); pointer-events: none;
}
.battle-app .shutdown-title { font-weight: 800; letter-spacing: .08em; }
.battle-app .shutdown-sub { font-size: 11px; }
```

Replace the `var(--…, fallback)` names with whatever tokens `battle.css` and `shell.css` actually define for accent and danger. Grep `:root` in both files. Keep a fallback only if no token exists.

- [ ] **Step 6: Run the tests and the builds**

Run: `npm run web:test && npm run web:build`

Expected: all pass.

- [ ] **Step 7: Drive it and look (CLAUDE.md: "Look at the app before claiming it works")**

Check that vite has rebuilt first: `curl -s http://localhost:5160/src/components/BattleLiveScreen.tsx | grep -c live-groups` should print ≥ 1. If it prints 0, run `pm2 restart mechbattler-dev`.

```bash
SCRATCH=/tmp/claude-1000/-home-nykwil-MechBattler/4b4c7044-9d35-45d1-889a-981a08984dd3/scratchpad
npm run web:shot -- 'http://localhost:5160/?view=battle' "$SCRATCH/g-hold.png" --w 390 --h 844 \
  --waitFor '.live-groups' --tapText 'G1' \
  --eval "document.querySelector('.live-groups .grp').getAttribute('aria-pressed')"
npm run web:shot -- 'http://localhost:5160/?view=battle' "$SCRATCH/g-alpha.png" --w 390 --h 844 \
  --waitFor '.live-groups' --tapText 'Alpha' \
  --eval "[...document.querySelectorAll('.live-groups button')].map(b => b.getBoundingClientRect().height)"
npm run web:shot -- 'http://localhost:5160/?view=battle' "$SCRATCH/g-ovr.png" --w 390 --h 844 \
  --waitFor '.live-groups' --tapText 'OVR' \
  --eval "!!document.querySelector('.heatcol.ovr')"
```

Expected:
- `aria-pressed` reads `"true"` after tapping G1;
- every button height is ≥ 44;
- `.heatcol.ovr` exists;
- the driver reports no console errors and `overflowX` false.

Open each PNG and look:
- the new row sits under the orders row;
- the arena is still the dominant element;
- nothing is clipped.

Measure the arena height before and after: `--eval "document.querySelector('.canopy, .glass, svg').getBoundingClientRect().height"`. Pick the selector that `BattleScene` actually uses for the arena. Record the loss in the commit message.

Then run `npm run web:audit`, and expect it to pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "Live console: weapon group chips, Alpha, OVR and the reactor shutdown banner"
```

---

### Task 8: Docs, balance report, full verification

**Files:**
- Modify: `docs/02-power-heat-spec.md`: the load-and-wait rule and mech-wide shutdown.
- Modify: `docs/03-combat-spec.md`: groups, Alpha and OVR in the order channel.
- Modify: `docs/19-watchlist.md`: three entries:
  - every engagement now opens with a volley;
  - OVR is player-only;
  - the railgun does not pre-dump.
- Modify: `docs/07-status-and-handoff.md`: move sub-project 1 from §5 open to §4 shipped, with the date. Sub-projects 2 and 3 stay open.
- Modify: `docs/superpowers/specs/2026-09-23-mw-groups-heat-design.md`: record the three deviations:
  - Alpha is on `X` because Space is pause;
  - the events are kebab-case (`mech-shutdown` / `mech-restart`), plus `alpha`;
  - the banner shows the temperature still to cool, not a countdown.

- [ ] **Step 1: Write the doc changes above.** Each docs/19 entry follows that file's existing entry format: what, why it was left, and what would make us act.

- [ ] **Step 2: Full test suites**

Run: `npm run sim:test && npm run game:test && npm run game:audit && npm run web:test && npm run web:build`

Expected: all pass.

- [ ] **Step 3: Campaign flow**

Run: `npm run web:campaign`

Expected: PASS. The run still advances through a whole node.

- [ ] **Step 4: Balance, report only**

Run: `npm run balance:collect && npm run balance:report`

Read `artifacts/balance-report.md`. Quote any build that moved by 5 or more points in the final summary to the user. **Do not rebaseline.**

- [ ] **Step 5: Commit**

```bash
git add docs artifacts/balance-report.md
git commit -m "MW groups and heat: docs, watchlist, and the balance report it moved"
```
