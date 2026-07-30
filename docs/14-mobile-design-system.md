# 14 — Mobile Design System

*Written Jul 28 2026. **Implemented Jul 29–30 2026, and the authority has moved.***

*This document described the design in prose, and §3–§12 were implemented from it directly.
That produced an app that satisfied the spec while looking almost nothing like the artefact
that had been reviewed and agreed. The prototypes were then recovered to
`docs/prototypes/mobile-builder.html` and `mobile-battle.html`, and the interface was ported
from their own CSS and markup instead.*

***So the prototypes now win, not this document.** Where the two disagree, the prototype is
right — it is the thing that was actually looked at. `apps/web/src/styles/shell.css` and
`styles/battle.css` are the prototypes' own stylesheets, kept verbatim so they stay diffable
against the source. This document remains the record of the reasoning, and of the two findings
in §12 that the lost prototype's tests forced, but it is no longer the source of truth for
what anything looks like.*

*See `docs/15-mobile-port-status.md` for what was ported, how each surface was
verified, and the one design decision still open.*

*Superseded in detail: §5's per-edge-box-shadow note is now literal — the plate is the
prototype's CSS grid of buttons, not the old SVG. §8's readout bar, sheets, part rows, plate
views and intel strip all exist as the prototype's own components. §11's docking rails were
never built: the prototypes are phone designs with no desktop layout, so above `--bp-md` the
shell simply holds a 560px column and centres it.*

References: [design system](https://claude.ai/code/artifact/4c4606c8-0230-47cc-a7c4-8e3bc476e074)
(specimens at true scale), [interactive prototype](https://claude.ai/code/artifact/95216c5f-a92b-45b1-879f-998043c43b92)
(real chassis masks and catalog).

## 1. Why

The builder was desktop-only by construction. `App.css` hard-codes
`grid-template-columns: 268px 1fr 360px` — 628 px of fixed rails — and the whole builder
contains no `@media` rule. Beyond cramped, parts were unusable on touch:

- Rotate and delete existed **only** as `R` / `Delete` keypresses (`App.tsx` §keyboard).
- The stat preview was hover-only (`onMouseEnter` → `hoveredPartId` → `StatsPanel`).
- Mod and quirk explanations lived **only** in `title=` attributes.
- The SVG grid was bare `<rect onClick>`: no `tabIndex`, no role, no labels — unreachable
  by keyboard or screen reader.

## 2. Scope correction

The redesign brief described "arms, legs, torso, head" slots and a separate loadout screen.
**The game has neither.** `chassis.ts` defines each chassis as an ASCII silhouette
(`mask: boolean[][]` plus a reserved `coreCell`); `types.ts` makes every part a polyomino
with `origin` and `rotation`. Weapons are placed on the same grid as everything else, and a
part is powered by *where it sits* — connectivity to the core through `U-CON` conduits.

Mobile screens therefore are: **Plate** (grid placement), **Parts** (catalog sheet),
**Readout** (build vitals + bench), **Intel** (next match).

## 3. Token additions

Existing colour and font-family tokens are unchanged. Everything below is new, because none
of it existed — `tokens.css` had no spacing, type-scale, breakpoint, or z-index tokens, and
every size was hard-coded per component, often fractionally (9.5 / 10.5 / 11.5 / 12.5 px).

```css
/* Type — 8 steps, no fractions. Tight at the bottom where instrument data
   lives, opening up at the display end. Deliberately not a fixed ratio. */
--text-2xs:11px; --text-xs:12px; --text-sm:13px; --text-base:15px;
--text-lg:17px;  --text-xl:20px; --text-2xl:26px; --text-3xl:34px;

--space-1:4px; --space-2:8px; --space-3:12px;
--space-4:16px; --space-5:24px; --space-6:32px; --space-7:48px;

--tap-min:44px; --tap-comfortable:48px;
--bp-md:768px; --bp-lg:1080px;          /* replaces ad-hoc 680/760/900 */
--z-plate:0; --z-readout:10; --z-sheet:20; --z-overlay:30; --z-toast:40;
--radius-lg:12px; --radius-full:999px;   /* sm/md unchanged */
--dur-fast:120ms; --dur-base:200ms; --dur-sheet:280ms;
--ease-out:cubic-bezier(.32,.72,0,1);
```

**11 px is the floor and only for mono.** The current app ships 9 px mod chips and 9.5 px
meta text. Body text starts at 13 px; the base rises from 14 to 15.

## 4. Contrast audit — two tokens fail today

Computed WCAG 2.1, every foreground against every ground. AA is 4.5:1 for body text, 3:1 for
large text and UI boundaries.

| Token | inset | floor | panel | raised | Verdict |
|---|---|---|---|---|---|
| `--ink-primary` | 15.51 | 14.89 | 13.64 | 12.42 | AA |
| `--ink-secondary` | 7.24 | 6.94 | 6.36 | 5.79 | AA |
| **`--ink-faint` #616774** | **3.38** | **3.24** | **2.97** | **2.71** | **FAILS** |
| `--signal-amber` | 8.83 | 8.47 | 7.76 | 7.07 | AA |
| `--signal-blue` | 7.25 | 6.96 | 6.37 | 5.80 | AA |
| `--signal-green` | 6.78 | 6.51 | 5.96 | 5.43 | AA |
| **`--signal-red` #d64545** | 4.38 | 4.20 | 3.85 | 3.51 | **UI only** |

`--ink-faint` fails on every ground, and at 2.71 on `--bg-panel-raised` it is below even the
3:1 non-text minimum. It is used for `.eyebrow` and `.part-meta` — small uppercase mono, the
hardest text to read. **This is the worst accessibility defect in the current stylesheet.**

Fixes:

```css
--ink-faint:#868d9b;      /* was #616774. Smallest value clearing AA on all four grounds
                             (5.75/5.52/5.06/4.61). #767c8a and #7d8492 still fail on raised. */
--signal-red:#d64545;     /* unchanged — fills, borders, fault LED */
--signal-red-text:#ea6a6a;/* NEW — small red text (6.18/5.44/4.95) */
```

Also undefined but referenced today, silently falling back:

| Token | Referenced by | Now |
|---|---|---|
| `--ink-muted` | `.workspace-nav button` **colour**, BalanceLab | alias of `--ink-secondary` |
| `--surface-raised` | RunPanel | `#262b34` |
| `--bg-deep` | BalanceLab | `#08090c` |

`index.html` declares `theme-color: #11171d` while `--bg-floor` is `#12141a`; reconcile to
`--bg-floor`.

## 5. The plate

The grid is the hero: it takes the whole middle of the screen and earns that by size and
position, not by effects. **No glow, no rim shadow** — an earlier revision had both and they
were the only pure decoration on the screen. The background gradients on `body` and
`.centerpane` go too.

Cell size is `min(44px, availW ÷ cols − 1)` where `availW` is viewport minus 24 px plate-area
padding, 16 px plate padding, and 2 px border. Width is always the binding constraint:

| Chassis | Grid | 375 px | 390 px |
|---|---|---|---|
| Vulture CH-2 | 5×4 | 44 | 44 |
| Mule CH-5 | 6×6 | 44 | 44 |
| Widow CH-7 | 7×7 | 44 | 44 |
| Bastion CH-9 | 8×9 | **40** | **42** |

Three of four chassis hit 44 px. Bastion cannot — eight columns at 44 needs 352 px of grid
plus ~42 px of chrome, wider than the phone. A bounded exception, still a third larger than
the 30 px cells the desktop build uses.

**Size the plate against a fixed reserve, not the live action-bar height.** The action bar
grows a row when a part is armed; measuring the real container made every cell resize at that
moment and the grid jumped under the thumb.

**One part is one shape.** Cells of the same part share edges (`gap: 0`) and carry a single
outline around the silhouette — the job `.part-outline` does with boundary paths in
`GridEditor`. Draw it as per-edge box shadows, **not** one element laid over the top, so every
cell stays an independent tap target, focus stop, and accessible name. The visual grouping
must never cost the interaction grid. Shape previews follow the same rule.

## 6. Placement: tap, then confirm

Tapping a part in the sheet **arms** it; it does not place it. A ghost appears on the plate.
Tapping a cell moves the ghost. An explicit **Place** commits.

Rationale: a fingertip covers the cells you are aiming at, so drag-to-place fights the puzzle.
Tap-then-confirm keeps the target visible and gives a moment to back out. The decisive reason
is that **it is the identical model for keyboard and screen reader** — arrow keys nudge, Enter
places. One implementation serves touch, keyboard, and assistive tech, and closes the grid's
accessibility hole. Direct drag may be added later as an accelerator; it must never be the
only path.

Armed controls are exactly three: **Cancel · Rotate · Place**.

- No nudge pad. Tapping a cell already positions the ghost, so arrows were a second control
  doing one job — and fitting them forced the row to 36×26 px, breaking `--tap-min` in the
  component that documents it. Arrow *keys* still nudge; a keyboard has no cell to tap.
- **Place** is disabled while illegal, with the reason directly above it. A disabled control
  must never be a mystery.

## 7. Detach: one state, not two

A selected part offers exactly one action: **Detach**. The part comes off the plate and
returns you to the placement state holding it — move, rotate, place. Rotate-in-place and
remove-in-place do not exist; detach-then-rotate and detach-then-discard already do both jobs
in a state that exists anyway.

The part **keeps its identity** across the round trip, so re-placing is a *move*, not a copy:
it consumes no new instance, and integrity, modifiers, and variant ride along.

Because a detached part is already off the plate, backing out has nothing to return to — the
button reads **Discard**, not Cancel, and takes the danger style. *Open decision:* `Esc`
discards too and there is no undo. If that proves hostile in play, make Discard return the
part to its origin and add an explicit Remove.

## 8. Components

**Readout bar** — 56 px, persistent, never scrolls away. Mono `tabular-nums` so columns do not
shift as values change. Signal colour only when the value is actionable: a nominal power
margin is ink, not green, or green stops meaning anything. Deltas render on their own line so
a preview can never push the value out of the cell. Announces `role="alert"` when the fault
count rises — `BuildWarnings` currently announces new faults to nobody.

> **If a surface is tappable, something on it must say so.** The readout bar opened the gauges
> from the first revision, but had no caret and no label — it looked like a static strip and the
> first reviewer reported there was "no way to look at heat and power". A component rule, paid
> for in testing, not a nicety.

**Sheets** — snap peek 96 px / half 55vh / full 88vh; the plate stays visible at peek and half
so placement never loses context. `--radius-lg` on the top corners only. Handle 36×4 px inside
a 44 px drag zone. `role="dialog"`, `aria-modal`, focus moved in on open, focus restored on
close, Tab trapped. None of that exists in the current modals.

> Corrected in the build, after all three sheets shipped with no way out of peek or half.
> "The plate stays visible at peek and half" was read as *render no scrim there*, and a
> tap outside then landed on nothing. The scrim is present at every snap and is merely
> **clear** below full: the plate stays visible, and the tap still dismisses. Nothing on
> the plate is reachable behind an open sheet regardless — arming a part closes it.
>
> The handle is also a **close** control, not a snap cycler: in the prototype it is
> `id="s-close"`, labelled "Close parts". A tap closes; a drag still resizes. Making it
> cycle snaps left the sheet with no dismissal affordance a phone could reach, since Esc
> and a 24 px drag are not available to a thumb. The prototype wins (see CLAUDE.md).

**Part rows** — 56 px minimum, 32 px shape preview, name at 15 px, cost in 13 px mono.

**Plate views** — a segmented control (Parts · Power · Heat) recolours the plate; the same
three overlays the desktop app has as `overlay: 'parts' | 'power' | 'thermal'`, given a
permanent home. Power: green reaches the core, red is stranded, blue is the bus; inert
structure drops to a neutral so only the live network carries hue. The caption under the plate
states what the current colours mean — a legend you must remember is a legend that failed.
`aria-pressed` on every segment; `.chip.active` today encodes state in colour alone.

**Intel** — lives on the build screen, not a separate page, because the loop is *read the
opponent → move a radiator → read it again*. Making that a navigation costs the loop. A
permanent strip above Parts names the opponent and threat; tapping opens threat, chassis,
engagement range, confirmed parts, and any elite mod telegraph.

**Bench** — a tab in the readout sheet. The range table is the useful part: real falloff bands
across `SANDBOX_RANGES_M`, and when a weapon contributes nothing it reports **why**
(`range`, `power`) rather than printing a zero.

## 9. Colour, state, and motion

Four signals, one meaning each, everywhere: amber = hazard/selection/heat, blue =
power/schematic/conduit, green = connected/nominal, red = overheat/brownout/illegal. Never
decorate with a signal colour.

**Colour is never the only channel.** Unpowered parts are hatched as well as dimmed.

Single theme, deliberately: the workshop is a dark instrument panel and a light mode would be
a different product, not a preference.

`prefers-reduced-motion` must cover **all** animation. The current rule disables only
`.led-red`'s flicker and misses `fault-pulse`, `flash-fade`, `reject-flash`, and everything in
`BattlePlayback.css` — the fault indicator keeps pulsing for users who asked it not to. Wrap
hover styles in `@media (hover: hover)` so tapped controls do not keep a stuck hover state.

## 10. Copy

Errors name the cause and the fix. A control says exactly what happens. An action keeps its
name through the whole flow.

| Was | Now |
|---|---|
| `Invalid placement` | `Blocked — Furnace overlaps Jolt.` |
| `Press R to rotate before placing` | a **Rotate** button in thumb reach |
| `FAULT · unpowered part` | `Judge has no path to the core. Run a Bus between them.` |
| *(empty grid, no message)* | `Empty chassis. Start with a reactor — open Parts.` |

The sheet arms, the button says **Place**, the confirmation says **Placed**. Never "Submit",
never "Confirm". Mod and quirk explanations become tappable disclosures — `title=` is
unreachable on touch. Say `kW` and `t`, not invented jargon; the catalog's own machinist
vernacular wins.

## 11. Scaling up

Mobile-first, `min-width` queries only. At `--bp-md` the parts sheet docks as a left rail and
the readout becomes a right rail, so the current three-column desktop layout re-emerges from
the mobile primitives rather than being a second codepath. Keyboard shortcuts stay as
accelerators at every size.

## 12. Battle

Reference: [battle prototype](https://claude.ai/code/artifact/d2fb52ed-b862-4e6f-ada2-6e21c56694bd).

The desktop battle HUD is mouse-shaped in three ways that do not survive a phone:
**right-click** reverts move orders to auto, **hover** reveals what a weapon does, and weapon
hold/free is a click on a small slot.

The shell is the builder's, unchanged: topbar → hero → readout bar → command bar → sheet. The
arena is the plate; the gun row is the armed controls.

**The console is the mech's instrument panel; the glass above it is the windshield, and what the
windshield shows is an overhead map.** That split decides where everything goes.
`BattleHud.tsx` already calls the player's panel `.hud-cockpit`, so this is the app's own metaphor
made structural.

- **On the glass:** only marks that belong on a *map* — terrain, both mechs, your waypoint,
  per-gun reach envelopes, the target lock and range. Chamfered bezel and corner brackets frame it.
- **In the console:** every instrument — damage widget, core and hull bars, functional mass, the
  heat column, gun chips, and the movement controls.

A damage vignette on the glass was built and cut: it was justified as "edge of vision", but the
view is a map rather than the pilot's eyes, so a red rim there means nothing. Damage became a bar
with a number instead.

**Gridlines must be the terrain grid.** They were drawn every 50 m over terrain patches that sat
on no grid at all — a lattice that lined up with nothing. Terrain snaps to
`TERRAIN_CELL_SIZE_M = 20` and the lines mark exactly those cells, at roughly a fifth of the old
contrast.

The rule that keeps it from becoming the decoration cut in §5: **every mark on the glass must
carry information.** A heading tape was built and then cut for failing exactly that test — it
looked like a cockpit and told you nothing you could act on.

| Element | What it tells you | Where |
|---|---|---|
| Target lock + range | Distance — decides which guns are in `RANGE` | glass |
| Lock block | The target's core, functional mass, and heat | glass |
| Per-gun envelope | Which of your guns can reach (see below) | glass |
| Damage widget | Which of *your* parts are gone | console |
| Core bar | How close you are to dying, as a number | console |
| Hull bar | Structural HP remaining | console |
| Mass hairline | Functional mass — the timeout tiebreak only | console |
| Heat column | Headroom to shutdown | console |

**No ammo.** `U-AMMO` is in the catalog but disabled, and `audit.ts` enforces it —
*"U-AMMO must remain disabled until ammunition is functional"*; `diversity.ts` calls it a dead
placeholder pending Track C. Weapons are power- and heat-limited, so there are no per-gun counts
to show and inventing them would put a mechanic on screen that does not exist.

**Hull and mass are different numbers.** Hull is structural HP remaining. Functional mass is the
fraction of part *mass* still working, so losing the 650 kg Maul costs far more than the 100 kg
Gill. Mass gets a hairline rather than a headline because it changes exactly one thing: at
`combat.ts:1524` a battle that reaches the time limit is awarded to whoever has more of it.

**Per-gun reach envelopes.** Each weapon draws an annular wedge spanning its arc between
`rangeStart` and `rangeEnd`, tinted green when that gun can currently fire. Each gun chip also
carries the live range to target against its own band and the distance out of it, so `RANGE`
tells you *which way to move* rather than only that you cannot shoot.

**Heat runs vertical, the full height of the console.** What you need from heat is headroom before
cutout, and a column shows headroom at a glance in a way a horizontal bar does not — the taller the
thermometer, the finer the reading. Marks at 100 °C and the 130 °C shutdown line, with the risk in
words underneath: *seconds to cutout at the current rate*, not just a temperature.

**Nothing may resize with its text.** Every slot whose contents change is a fixed box — gun state,
range hint, clock, core and hull values, the Auto toggle, the heat readout, the lost-parts line. A
HUD that reflows as numbers tick cannot be read at a glance, and `tabular-nums` alone does not fix
it: *words* change width too.

Where the text could not fit the box, **the text changed**. `DESTROYED` was nine characters and
blew out a slot sized for `READY`; it is `DEAD`. The whole vocabulary —
`READY · RANGE · ARC · HOT · HOLD · POWER · DEAD` plus the cooldown — is five characters or fewer
and shares one 62 px slot, so the gun row can never shuffle. Fix the slot to the worst case, or
make the worst case shorter.

**The damage widget replaced the readout bar.** Core HP, functional mass and power draw were
abstractions *of* the mech; showing the mech says more in less space. It renders the chassis
silhouette with the player's parts in place, fading as they take damage and hatching red when
destroyed — so losing the Judge visibly takes the Judge offline and its chip flips to
`DESTROYED`. That requires damage to land on **parts**, not one structure pool. Tapping the
widget opens gauges and the log.

**Auto owns movement, throttle and facing.** One toggle, not three verbs. Auto on: the autopilot
has position, speed and facing, and the throttle and Face controls grey out. Auto off: they are
yours — tap where to go, or tap where you already are to stand still. There is no separate Hold.

**Tapping the map takes manual control.** A move order *is* taking the wheel; making the player
flip a switch first only to be told the switch is off earns nothing. The tap sets the waypoint and
releases the autopilot in one action.

**Face target** sits beside the throttle and greys out with it. Face on keeps the guns tracking the
enemy; face off points the mech where it is going, so retreating turns your guns away with you.
Measured over a fighting retreat: guns are locked out by `ARC` 0% of the time with Face on and 43%
with it off — the control changes the fight rather than labelling it.

### Movement and gunnery are the sim's, not an approximation

The prototype originally moved mechs at a flat 6 m/s in any direction. It now ports
`combat.ts` directly, because the model already existed there:

| Term | Source | Value |
|---|---|---|
| Directional ceiling | `maxSpeedInDirection()` | ellipse: `fwd`/`rev` along facing, `strafe` across |
| Mule speeds | `chassis.ts` | 6.0 fwd / 4.0 strafe / 3.0 rev |
| Throttle | `SPEED_FRACTION` | creep 0.30 · cruise 0.65 · flank 1.00 |
| Turn / accel | `chassis.ts` | 90°/s · 3.0 m/s² |
| Own-speed penalty | `MOVE_JITTER_MRAD_PER_MPS` | +0.3 mrad per m/s |
| Fire-control lag | `TRACKING_LAG_BASE_S` | 0.3 s (0.1 with a powered Abacus) |
| Hit model | `computeHitModel()` | `sigma = hypot(sigmaRad·range, crossing·(lag+tof))`, `pHit = erf(halfWidth / (sigma√2))` |

Three consequences the UI has to carry: **your own speed** costs dispersion, **the target's
crossing speed** costs lead (closing speed does not — only the component across the line of sight),
and **slow projectiles are dodgeable** while hitscan pays only the lag share.

A round's scatter *is* its miss: lateral error is drawn from `sigma`, and the shot hits if that
error falls inside the target's projected half-width. One number, not a visual plus a separate
dice roll.

**Keep the absolute penalty. It does not punish fast mechs.** This was raised as a concern and the
numbers settle it. Dispersion is *angular*, so it only becomes metres at range — which range-gates
the penalty for free:

| Cost of sprinting at 9 m/s (Judge, 1.5 m target) | 60 m | 100 m | 150 m | 200 m |
|---|---|---|---|---|
| Hit chance lost | **0 pts** | 2 pts | 12 pts | 20 pts |

A brawler closing to knife range pays nothing for its speed; a sniper who moves pays 20 points.
That is the archetype split you would otherwise hand-author, and it falls out of the geometry.
Fraction-of-max would flatten it, making every chassis equally accurate at full throttle and
severing speed from the accuracy trade entirely.

**Charging is punished by geometry, not by the speed penalty.** Crossing speed — the component
*across* the line of sight — is the dominant term in every exchange:

| Target crossing speed | 0 | 2 | 4 | 6 | 9 m/s |
|---|---|---|---|---|---|
| Shooter's hit chance at 100 m | 100% | 86% | 57% | 40% | 28% |

Charging puts all your velocity *along* the line of sight, so crossing is zero: you hand the
defender a stationary target and gain no evasion. Measured exchange (my hit% − theirs) at flank:
**−1 to −2 charging, +41 to +44 orbiting**, across every chassis except the Bastion, which cannot
orbit at 1.5 m/s strafe and is therefore a gun platform by construction.

If a fast chassis feels weak the lever is its **strafe**, not the penalty model — the Vulture can
only fight with 33% of its speed (3.0 of 9.0) while the Widow has 90% (4.5 of 5.0), which is
exactly why `opponents.ts` calls the Widow the one that "orbits inside its band." That is a content
change in `chassis.ts`, not a rules change.

**UI consequence: crossing speed must be on the HUD.** It is the biggest term in whether anyone
gets hit and it was invisible. Your own crossing now shows as an **Evade** bar in the console
(it is a defensive stat), and the target's crossing sits on the lock block, where it explains your
misses.

**The two speed penalties are asymmetric on purpose, and that is correct.** It was queried whether
penalising both the shooter's motion and the target's double-counts, or makes moving-vs-static
harder than static-vs-moving. Measured, Judge at 100 m against a 1.5 m half-width target:

| Scenario | dispersion | lead | sigma | hit |
|---|---|---|---|---|
| Both stationary | 0.40 m | 0.00 m | 0.40 m | 100% |
| I move 6 m/s, target still | 0.58 m | 0.00 m | 0.58 m | **99%** |
| I am still, target crosses 6 m/s | 0.40 m | 2.80 m | 2.83 m | **40%** |

Moving while shooting a static target is nearly free; standing still against a crossing target is
punishing. The asymmetry is physical: **your own velocity is known to your fire control and
compensable**, leaving only residual jitter, while **the target's must be predicted** across the
time of flight. They are different problems that both happen to involve speed, so this is not
double-counting.

**Open refinement — lag should use relative lateral velocity.** `lateralSpeedMps()` uses the
target's *absolute* velocity, so two mechs strafing in parallel are penalised exactly as much as two
strafing in opposition. For the time-of-flight share that is right: the round travels in the world
frame, so absolute target motion is what makes it miss. But the model lumps flight time together
with 0.3 s of **tracking lag**, and lag is about a turret following a changing *bearing* — which
parallel motion barely changes. Strictly:

- lead from time of flight → **absolute** target crossing *(as implemented)*
- lead from tracking lag → **relative** lateral velocity *(currently absolute)*

Small in magnitude, and it lives in `combat.ts` rather than any UI, so it is recorded here rather
than changed.

**The ƒx panel** toggles a diagnostic over the map: the speed envelope with current heading and
velocity drawn on it, then every term of the next shot — jitter, dispersion in mrad and metres,
crossing speed, time of flight plus lag, lead error, combined sigma, and the resulting hit chance.
Pause and step to see why a shot missed. It is a development instrument rather than a player
feature, but it earns its place: every number the fight turns on is otherwise invisible, and the
crossing-speed insight above came directly from being able to read them.

**Rounds have flight time and they miss.** Projectile speeds are the catalog's (Judge 600 m/s, Maul
400, Needle 900), so a shot visibly crosses the map and the streak trails its direction of travel.
Impacts scatter using each weapon's real dispersion rather than stacking on the target's centre;
spread grows with range, magnified ~10× to read at map scale. Damage still resolves at the moment
of firing as the deterministic sim does — the round is the visual, not the arbiter, and the burst
is drawn where it lands.

### Rendering rule: build once, update in place

Anything interactive must **not** be inside a subtree that re-renders every frame. Rewriting
`innerHTML` on an animation loop breaks touch outright: a `click` requires press and release on the
same element, and children destroyed between the two never pair. It also restarts CSS transitions
every frame, so a cooldown fill with a 200 ms transition never reaches its true width.

This bit the arena, the gun chips, the sheet, and the damage widget simultaneously. The fix is
structural: build each surface once, update text, classes and styles in place, put `pointerdown` on
a stable root, and mark decorative layers `pointer-events: none`.

**Derive the loadout from the build; never write it twice.** The prototype declared the armed
weapons in two places — the initial state and the rematch path. They drifted, so a fresh load armed
a Needle (60–180 m band) while a rematch armed a Maul (15–45 m). It surfaced as "the cones look
wrong on reload", but the deeper fault was that the damage widget mapped gun slot 1 to the *Maul*
part, so destroying the Maul silenced a chip labelled Needle. Weapon parts carry their slot index
and the gun list is derived from them, which makes the mismatch unrepresentable.

Two related traps:

- **Suppress transitions on first paint.** Bars animating from their initial HTML values to real
  ones reads as a lurch on load. Paint real values with transitions disabled, then enable them a
  frame later — on reset as well as first load.
- **Reset the frame clock immediately before starting the loop.** Timestamping at parse time means
  a slow cold load banks hundreds of milliseconds and the first frame runs a catch-up burst of
  simulation before anything is on screen.

The opponent's vitals sit *on* the glass beside the lock rather than in a strip above the arena: a
cockpit annotates what you are looking at, and it returns 44 px of height to the hero.

**Guns say why they are silent.** On desktop, `RANGE` / `ARC` / `HOT` are marks on a slot,
explained by a hover blurb you must go looking for. On touch that reason **is** the chip's
content — always visible, never hovered. The vocabulary is the sim's own:
`READY · RANGE · ARC · HOT · HOLD · POWER · DESTROYED`. `HOLD` is amber because it is the
player's decision; the rest are the mech's.

**No right-click, so name the verb.** Tapping the arena sets a waypoint. **Auto** returns
movement to the autopilot; **Hold** plants the mech. Three named buttons instead of one
overloaded gesture — and unlike right-click, the current mode is always readable.

**Pause is a first-class control**, at full size in the top bar rather than a spacebar. Orders
cannot be issued as fast by thumb as by mouse. The sim is deterministic and tick-based, so
pausing costs nothing; orders given while paused apply on resume.

**Enemy vitals** compress to one strip: core, functional mass, heat. Your own take the readout
bar (Core · Mass · Heat · Power) with capacitor and the event log behind **Details**.

Two things the prototype's own tests forced, worth keeping in the real implementation:

- **Damage must strip structure before the core.** Applying it straight to the 50-point core
  ended fights in 2.3 s. `functionalMassFrac` is a HUD meter precisely because the mech is
  dismantled before the core is exposed.
- **Threshold messages need hysteresis latches.** Temperature oscillates across 130 °C, so a
  naive crossing test filled the log with "back under 130°C" every second.

## 13. Prototype status

The three reference artifacts are published and current:

| Artifact | Covers |
|---|---|
| [Design system](https://claude.ai/code/artifact/4c4606c8-0230-47cc-a7c4-8e3bc476e074) | Tokens, contrast audit, component specs, all at true scale |
| [Builder prototype](https://claude.ai/code/artifact/95216c5f-a92b-45b1-879f-998043c43b92) | Plate, parts sheet, detach, overlays, intel, bench |
| [Battle prototype](https://claude.ai/code/artifact/d2fb52ed-b862-4e6f-ada2-6e21c56694bd) | Canopy map, console, gun chips, movement and gunnery model, ƒx panel |

The component library also lives in the **MechBattler Mobile** Claude Design project (13
components: five foundations, eight components).

**The battle prototype's source was recovered (Jul 29 2026)** and now lives at
`docs/prototypes/mobile-battle.html`. It was briefly believed lost when its scratchpad was
cleared, but the published page was refetched and the authored source extracted from it — the
prototype is hand-written HTML/CSS/JS with no build step, so what was recovered is the source,
not compiled output. Only the platform's frame-runtime wrapper was stripped. It opens standalone
in a browser and is editable again.

Read it as a **presentation prototype, not a second engine.** It re-implements the sim by hand:
`W` copies four weapons "verbatim from `catalog.ts`", and the movement/gunnery block is "ported
from `combat.ts`" — the ellipse speed envelope, angular dispersion, tracking lag, Box-Muller
lateral error. It is hardcoded to one chassis (CH-5 Mule) and four weapons (`W-AC`, `W-CB`,
`W-MG`, `W-BR`), with no builder, run, salvage, or persistence. Those constants are a snapshot
and will drift from `packages/sim`; the real implementation must call the sim rather than copy
it. The prototype's value is the interaction and layout design, plus the two findings in §12.

## 14. Right-rail audit — what the mobile design must absorb

*Added Jul 29 2026, before the desktop workshop layout is superseded.*

**Decision: one version, not two.** The mobile design supersedes the current workshop UI rather
than sitting beside it. Per §11 this is one responsive codebase — the three-rail desktop layout
re-emerges above `--bp-md` from the mobile primitives, so nothing is lost at width. Maintaining
two codepaths for the same screen was considered and rejected: every change would be made twice
and they would drift, which is exactly how `docs/prototypes/mobile-battle.html` ended up with a
hand-copied snapshot of `combat.ts`.

Branch `desktop-ui-snapshot` pins the pre-mobile UI at `34d57b5` as a reference. It is a
reading copy, not a maintained branch.

The 360 px right rail (`App.tsx`, `.layout` third column) holds six sections. Not all of them
have a mobile home yet, and not all of them deserve one:

| Right-rail section | Mobile home today | Status |
|---|---|---|
| `BuildWarnings` | Readout bar announces fault *count* via `role="alert"` (§8) | **Gap** — the fault list itself has no home |
| `PartInspector` | Selection sheet, detach (§7) | Covered |
| `StatsPanel` — mass, heat, power | Readout bar: Core · Mass · Heat · Power (§8) | Covered |
| `StatsPanel` — speed fwd/strafe/rev + turn rate | — | **Gap** |
| `StatsPanel` — burst DPS | — | **Gap** |
| `StatsPanel` — range bands, max range | Bench tab range table (§8) | Covered |
| `PowerPriorityList` | — | **Gap** |
| `TestBenchPanel` | Bench tab (§8) | Partly covered |
| `RunPanel` — scrap, bench, offers, fight | — | **Gap** (see §15) |

### Carry over

- **Speed (fwd / strafe / rev + turn rate).** The speed envelope is an ellipse, not a scalar —
  `combat.ts` derives max speed per heading from all three. A build that walks 6 m/s forward and
  3 m/s in reverse plays nothing like one that is symmetric, and dispersion is speed-gated, so
  this is a combat-relevant number, not trivia. Four values do not fit the 56 px readout bar;
  they belong in the readout sheet next to mass.
- **`PowerPriorityList`.** Decides what browns out first when supply fails. It is the only
  control for that behaviour anywhere in the app — dropping it removes a mechanic, not a
  display. Needs a mobile home; reorder by drag is a poor touch target, so this likely needs a
  move-up/move-down control rather than a straight port.
- **`BuildWarnings` list.** A count with no way to read the causes is not actionable.

### Deferred to the Bench page — backlog

Neither of these is dropped. Both belong on the Bench page (§15), a pre-match surface rather
than something competing for room on the build screen. Backlogged, not scheduled:

- **Burst DPS "(full capacitors, no heat yet)".** A best-case number true for roughly the first
  second of a fight. It should not sit in a persistent readout where it reads as *the* damage
  number — the bench range table measures the same weapons under real falloff and reports *why*
  a weapon contributes nothing. On a page you visit deliberately, framed against the falloff
  measurement, the optimistic figure is informative instead of misleading.
- **`TestBenchPanel` beyond the range table.** §8 claims the range table for the readout sheet;
  the rest of the bench moves to the Bench page.

### Explicitly out of scope

`BalanceLab` and Sandbox (`TestBenchPanel`'s sandbox mode) stay desktop-only and untouched.
They are dense analysis instruments — matrices, standings, diagnostics — and there is no value
in fitting them to a phone. They keep their current layout at every width.

## 15. Not yet designed

Salvage (`WreckScreen`, already has a 680 px breakpoint), the scrapyard and run map, and the
front door (`GameFrontDoor`, already at 760 px). All three are layout work the token system
now covers, rather than new interaction problems.

### Bench page — concept, backlog

*Captured Jul 29 2026. Intent agreed, not designed.*

A deliberate pre-match page — the place you go to **verify a build before committing to a
fight**, rather than glancing at numbers while placing parts. It is the one mobile surface
allowed to be dense, because you are standing still when you read it.

Absorbs everything the build screen should not carry: run verification, detailed stats, and
simulation against the coming opponent. Concretely, at least the drop candidates from §14
(burst DPS, the non-range parts of `TestBenchPanel`) plus the thermal/power bench diagnostics.

**The bench measures your build. It never predicts the outcome.** This is the page's defining
constraint, and it reverses the first draft of this section.

That draft proposed simulating the coming match — "does my build beat that". It was wrong, and
the reason generalises past this page:

- **If you know you win, the fight is ceremony.** You would only ever press Fight on a
  foregone conclusion, and watching a battle you have already resolved is not a game.
- **If you know you lose, the game is a gate.** Give up, or reroll until the answer changes.
- **It is worse here than in most games**, because `nodes.ts:41 ladderOpponents()` offers
  *several* opponents per node and elites carry `eliteBudgetBonus`. That choice is meant to be
  a risk/reward gamble — take the elite for better salvage, or the safe fight. An oracle
  collapses it into a lookup: simulate all of them, pick the one you beat. The decision the
  node exists to pose stops existing.
- **Our architecture makes the oracle nearly free**, which is exactly why the rule has to be
  explicit. The sim is deterministic and fast, and the Balance Lab already drives hundreds of
  headless battles. Nothing stops us from answering the question. We decline to.

So the bench answers *what does my mech do*, not *what happens next*:

- Heat under sustained fire — what shuts down, how soon, and what it costs.
- Power under load and brownout order, which is what `PowerPriorityList` (§14) controls.
- Real falloff bands per weapon, and when one contributes nothing, **why** (`range`, `power`).
- What is stranded, unpowered, or dead weight.

Opponent-relative figures are allowed only where **intel already told you** — §8 gives threat,
chassis, engagement range, confirmed parts, elite mod telegraph. Framing your measurements at
their stated engagement band is fair; it uses knowledge the player has. Simulating the fight is
not. Where intel is partial, the bench stays partial: a wrong expectation should come from
incomplete scouting, which makes intel worth having, not from bad arithmetic.

**Sandbox is the deliberate exception.** It sits outside a run, is explicitly labelled, and
already exposes the full catalog — free simulation there costs nothing, because no run is at
stake. The rule is about in-run play, and the app already draws this line: campaign prep shows
only unlocked equipment, active runs only installed and benched. The bench inherits that line.

Every figure must call `packages/sim` rather than restate it — see §13 for how the battle
prototype went wrong here.

Open questions: how much of the heat/power story fits before the page becomes the spreadsheet
it is trying to replace, whether any aggregate score is safe or whether all aggregates drift
toward being a win probability, and whether the desktop Sandbox should gain a mobile form now
that the split has a rationale rather than just being untouched.
