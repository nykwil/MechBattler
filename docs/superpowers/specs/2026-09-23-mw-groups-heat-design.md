# Weapon groups, alpha strikes and spending heat

**Design, 23 Sep 2026.** The first of three sub-projects that bring what makes
MechWarrior's combat good into MechBattler. The other two are listed in §9 and
get their own specs.

## Why

MechWarrior 5's combat works because of a handful of things:

1. **Heat limits your damage, and you decide when to spend it.** You can always
   fire faster than you can cool. The skill is choosing *when* to run hot: an
   alpha strike spends a whole heat bar at once, and overheating shuts the mech
   down.
2. **Weapon groups.** Guns are bound to groups in the mechlab. In the fight you
   pick the group for the moment: long poke, brawl, or everything.
3. **Weapons differ in how their damage lands.** Lasers burn over time, PPCs
   and autocannons hit one spot hard, and missiles scatter.
4. **Damage by location.** Strip a torso and the guns in it die.
5. **A cockpit that shows the mech's state.** The heat bar is the most
   prominent thing on screen, next to a group panel, damage diagrams of both
   mechs, and range.

MechBattler already has 4 in effect: per-cell damage kills the parts in the
cell. Most of the machinery for 1 and 5 exists too. What's missing is the
*decision*. The autopilot's fire-hold stops every gun at 115 °C
(`combat.ts:1473`), so no build has measured above 125.6 °C (docs/17 F73). Part
shutdown at 130 °C and heat damage at 150 °C have never fired. Nobody ever
chooses to run hot. This spec gives the player that choice, and the groups to
spend it through.

## Decisions taken (23 Sep 2026, with the user)

- **The player is a group commander.** The autopilot still drives and aims. The
  player fires groups and Alpha, and can override heat discipline. Direct piloting
  was rejected: on a phone it turns the game into a real-time shooter.
- **Heat stays per cell, plus a mech-wide shutdown.** The per-cell thermal sim is
  what makes building matter, so it stays. On top of it, an overheated reactor or
  core shuts the whole mech down, which is MechWarrior's signature moment.
- **The volley is emergent, not a group rule.** Hold everything and release it
  together (the user's proposal). The single sim change that makes this exact is
  §1: *a held gun finishes loading and waits.* The sim never learns what a group
  is.
- **The cockpit is a frame, not a renderer.** The overhead map stays, as the nav
  screen (sub-project 2).

## What this is not

- Not a balance pass. Every move is noted in `balance:report`, never gated on,
  and never rebaselined here (CLAUDE.md).
- Not the cockpit restyle (sub-project 2) and not new weapon behaviours
  (sub-project 3).
- Not ammo. Cook-off is hardcoded to `U-AMMO` (`simulation.ts:812`), which stays
  disabled (docs/07 §6), so cook-off remains unreachable after this work. Only
  shutdown and heat damage become live.

---

## 1. A held gun loads and waits

Today a gun that isn't enabled stops loading. Continuous-draw and ballistic guns
stop advancing `cycleTimer` (`simulation.ts:622`, `:662`). Charged guns only draw
charge while enabled (`:476-480`). Releasing guns together therefore fires them
staggered, a full cycle or a charge time later.

New rule, for each firing class:

| Class | While held | On release |
|---|---|---|
| Continuous-draw (`continuousKw`) | `cycleTimer` advances and clamps at `cycleS`. Draws no power (the draw is the shot's). | Fires on the first enabled tick. |
| Ballistic (`firesMechanically`) | Same as continuous-draw. | Fires on the first enabled tick. |
| Charged (`chargedEnergyPerShotKj`) | Once its cooldown ends, it requests `maxChargeKw` until `chargeKj` reaches the shot, then stops requesting and holds the charge. It competes for the bus while filling, like any draw. | Fires on the first enabled tick. |
| Cap-fed (railgun) | Cooldown already ticks. It does **not** pre-dump, because holding stored capacitor energy in a gun would starve other cap users unseen. | Dumps as today (≤1 s), then fires. |

Guns that are destroyed, shut down, cooked off or unwired do not load. A gun that
is shed by brownout while pre-charging keeps its partial charge, as it does
today.

**Why the railgun is the exception.** It is the one gun whose delay is its
identity: the capacitor alpha is already a planned spike. Pre-dumping would also
change what the CAP gauge means mid-fight. If the volley ends up feeling wrong
with a railgun in it, reopen this.

**Side effect, noted and not fixed.** A gun the autopilot holds because the
enemy is out of range now arrives loaded, so every engagement opens with a
volley. This affects both sides equally, but it favours slow-cycle guns. Add it
to docs/19 and let `balance:report` measure it.

## 2. Weapon groups on the build

```ts
interface Build {
  // ...
  /** Up to 3 player-assigned groups of weapon instanceIds. Control data only: the sim never reads it. */
  weaponGroups?: string[][];
}
```

- **Default when absent:** `defaultWeaponGroups(build)`, exported from
  `@mechbattler/sim`. Guns are sorted by `falloff.idealMax`: guns at or above
  the build's median go in G1 (long), the rest in G2 (short), and G3 starts
  empty. The helper reads the catalog, and the UI never computes a band.
- **Validation:** instanceIds that are no longer weapons on the build are dropped
  on read (`normaliseWeaponGroups`), and a gun appears in at most one group.
  Ungrouped guns fire only on Alpha and under autopilot.
- **Editing:** in the workshop's readout sheet next to power priority
  (`ReadoutSheet.tsx`). Tap a gun, then tap G1, G2, G3 or none.
- Groups persist with saved blueprints exactly as `powerPriority` does.

## 3. Group controls and Alpha

### Group chips

Each group has a chip in the live console. Tapping it cycles:

- **AUTO**: the guns are under the autopilot (no override).
- **HOLD**: the guns are held (`'hold'`). Under §1 they load and wait.
- **FIRE**: the guns are forced (`'force'`) and chain-fire as they come ready.
  Moving HOLD → FIRE releases every loaded gun on the same tick. That is the
  group volley.

This expands to the existing per-gun `ManualOrders.weapons` map. Per-gun chips
stay, and a per-gun setting wins over its group's.

### Alpha

Alpha fires **every loaded gun once**, including ungrouped guns and guns in
AUTO or HOLD, and then leaves them in their previous state.

It cannot be a UI-side toggle. Controllers run at 4 Hz in live play, so a
forced MG would fire several times inside one command window, and lockstep must
replay it identically (docs/11 §3). It is therefore sim state:

- `ManualOrders.alpha?: number` is a monotonically increasing token. The UI
  increments it on each press.
- `mergeManualOrders` carries it through as `{ verb: 'weapons', enabled, volley?: number }`.
- The combatant stores the last token it has seen. On a **new** token, every gun
  that is loaded at that tick is marked `volleyPending`. A pending gun is treated
  as enabled until it fires once, then the flag clears. Guns that are not loaded
  on that tick ignore the token. Alpha fires what is ready, as in MechWarrior.
- Fire-hold does not apply to a pending gun. Physical shutdown still does.

### Heat override (OVR)

`ManualOrders.overrideHeat?: boolean`. While it is set, `mergeManualOrders`
re-enables any gun the autopilot withheld *only* for temperature. That needs the
autopilot to report its reason, and the HUD already derives the same reasons
(`HOT` and the others) from `combat.ts:1961-1964`, so reuse that code path
rather than recomputing it.

The autopilot never sets OVR. This asymmetry favours the player, and it is a
docs/19 entry.

### Heat past fire-hold

`heatDispersionMult` currently saturates at 1.5× at 115 °C. It is extended so
that past fire-hold it keeps rising, linearly to `HEAT_DISPERSION_AT_SHUTDOWN`
(2.0×) at 130 °C. This is the soft ramp docs/07 §7 wanted to mine from
RogueTech, applied only in the band that is now reachable. The constant lives in
`combat.ts`, and the HUD reads it.

### Keys (desktop)

`1`–`3` cycle groups, `Space` is Alpha, `O` toggles OVR. The existing `1`–`9`
per-gun keys are dropped. Per-gun control stays a tap on the gun chip. Nine
number keys for guns and three for groups would collide, and the group is the
unit a player thinks in.

## 4. Mech-wide shutdown

**Trigger:** the hottest cell among the reactor parts and `CORE_INSTANCE_ID`
reaches `HEAT_MECH_SHUTDOWN_C`, starting at 130 °C (`HEAT_SHUTDOWN_C`).

**While shut down:**
- no weapon fires or loads;
- locomotion and turning are zero;
- reactor output drops to 0, so reactor waste heat stops and the mech cools;
- capacitors neither charge nor discharge;
- incoming hits land normally.

**Restart:** once the same cells fall below `HEAT_RESTART_C` (110 °C). The
reactor spins up from 0 through its existing `throttleLagS`, so recovery isn't
instant.

**Events:** `mech_shutdown` and `mech_restart`, carrying the cell temperature.
They appear in the ticker, the report and replay.

**The autopilot's response:** none is needed. A shut-down mech issues no
effective orders. The autopilot does not try to avoid shutdown, because it never
passes fire-hold. Only the player can cause one.

### Measure before building (step 1 of the plan)

Whether this can ever fire depends on how much weapon heat conducts into reactor
and core cells. Before implementing §4, add a harness mode that runs each
canonical template with OVR forced on for the player's side. It reports:

- peak reactor and core temperature;
- time to the first crossing of 130 °C;
- peak weapon-cell temperature.

Expected outcomes:
- **Some builds cross and some don't:** the design holds as written.
- **None cross:** the trigger is unreachable. Choose between lowering the
  threshold and tagging reactor heat as the trigger. Record the finding in
  docs/17 and ask the user, because it changes what the rule means.
- **All cross within seconds:** OVR is a trap, not a choice. The same
  conversation applies.

Count shots per side across the template matrix before and after §1 (memory:
silent-mech combat bugs).

## 5. HUD minimum

This is the minimum for sub-project 1. The full cockpit is sub-project 2.

- **Group row:** three fixed-size chips (≥44 px). Each shows its state word
  (AUTO, HOLD or FIRE) and a fill for how many of its guns are loaded.
- **ALPHA:** a button with a count of the loaded guns it would fire.
- **OVR:** a toggle that tints the heat column when set.
- **Heat column:** add lines at 130 °C and 150 °C, read from the sim constants.
- **SHUTDOWN:** a banner on the glass with a restart countdown derived from the
  frames, never typed in.

These must fit without resizing the console (docs/14: nothing resizes with its
text), and `web:audit` must pass.

## 6. Where it lands

| Change | File |
|---|---|
| Loading while held, volley flag, mech shutdown | `packages/sim/src/simulation.ts` |
| `ManualOrders.alpha` / `overrideHeat`, merge, heat curve, withheld reasons | `packages/sim/src/combat.ts` |
| `Build.weaponGroups` | `packages/sim/src/types.ts` |
| `defaultWeaponGroups`, `normaliseWeaponGroups` | new `packages/sim/src/weaponGroups.ts`, exported |
| Group editing | `apps/web/src/components/ReadoutSheet.tsx` |
| Group row, Alpha, OVR, keys | `apps/web/src/components/BattleLiveScreen.tsx`, `BattleHud.tsx` |
| Shutdown banner, heat lines | `BattleHud.tsx` (`HeatColumn`) |
| OVR heat harness | a new mode on an existing sim script (e.g. `sim:hitrate`'s runner) |

## 7. Tests

- **Sim:**
  - Each firing class, held for longer than its cycle, fires on the first enabled
    tick.
  - Mixed guns released together produce shots with the same `tSec`, except the
    railgun.
  - Alpha fires each loaded gun exactly once. Unloaded guns ignore it. A repeated
    token does not re-fire.
  - The lockstep replay of an Alpha is bit-identical (extend `orders.test.ts`).
  - OVR lets a gun pass 115 °C, and a gun past 115 °C has wider spread.
  - A mech-wide shutdown zeroes firing and movement, emits both events and
    restarts below 110 °C.
- **Weapon groups:** default grouping is deterministic, stale instanceIds are
  dropped, and a gun appears in only one group.
- **Web:** `web:test`, `web:build` and `web:audit`. Drive a live fight at 390×844:
  - set a group to HOLD, then FIRE;
  - press ALPHA;
  - toggle OVR until shutdown;
  - screenshot each step and look at it.

## 8. Docs to update when shipped

- docs/07 §4: shipped.
- docs/19:
  - the opening volley;
  - OVR is player-only;
  - the railgun doesn't pre-dump.
- docs/17: the OVR heat measurement.
- docs/02: the loading rule and mech shutdown.
- docs/03: groups and Alpha.

## 9. The other two sub-projects

**2. Cockpit frame console.** Restyle the battle console as an MW cockpit:
- a dominant heat bar;
- the group panel, with a cooldown shown per gun;
- a damage diagram of the target;
- the range;
- the overhead map framed as the nav screen.

This reverses docs/14's "looked like a cockpit and told you nothing" rule
(§ around line 284–303). The reversal and its reason get written into docs/14 in
that spec. The reason: groups and heat now make cockpit instruments carry
decisions.

**3. MechWarrior weapon identities.** Lasers that burn over a duration and have
to be held on target, and missiles with lock-on, scatter across cells, and
possibly indirect fire. The parts exist today as instant charged shots (Ember,
Sear, Lance) and a salvo (Pepperbox). This needs its own brainstorm, because it
touches weapon curves, and docs/17 F1 says to read those before touching them.
