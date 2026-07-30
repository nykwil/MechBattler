# 15 — Mobile port: state, verification, and the one open decision

*Written Jul 30 2026, on branch `mobile-first`. Records what was ported, how each
surface was verified, what deliberately diverges from the prototypes, and the one
decision still outstanding. Read `CLAUDE.md` first — it carries the working rules
this document explains the reasoning behind.*

## 1. What happened, in the order it happened

The mobile UX existed as three published artifacts, reviewed and agreed. Doc 14
described that design in prose. §3–§12 were then implemented **from the prose**,
which produced an app that satisfied the spec while looking almost nothing like the
artefact anyone had actually looked at.

The prototypes were recovered from their published pages into `docs/prototypes/`,
and the interface was re-done as a **port of their own CSS and markup**. That is
the version in the branch.

The lesson is cheap to state and was expensive to learn: **a design doc describes a
design; it is not the design.** Where doc 14 and a prototype disagree, the
prototype wins, because it is the thing that was reviewed.

## 2. Where the design lives now

| File | Role |
|---|---|
| `docs/prototypes/mobile-builder.html` | Workshop design. Source of truth. |
| `docs/prototypes/mobile-battle.html` | Battle design. Source of truth. |
| `apps/web/src/styles/shell.css` | The builder prototype's own stylesheet, verbatim. |
| `apps/web/src/styles/battle.css` | The battle prototype's own stylesheet, scoped under `.battle-app`. |
| `docs/14-mobile-design-system.md` | The reasoning, and §12's two sim findings. Not authoritative on appearance. |

Both stylesheets are kept **verbatim** so they stay diffable against the
prototypes. Do not reformat them or sweep their values. Corrections to their
behaviour live in `App.css`, commented with why.

`battle.css` is scoped because both prototypes define `.app`, `.topbar` and `.btn`
with different rules; flat imports would let import order decide the winner. A test
pins the scope.

## 3. Verification state

Every surface has been looked at and driven at a true 390×844 viewport, using
`scripts/drive.mjs` (`npm run web:shot`). Tests alone were never sufficient — see
§4.

Measured across workshop, battle, report, salvage and the Balance Lab — re-run in one
sweep after the driver gained condition-based waiting, so these results are current
rather than accumulated:

| Property | Result |
|---|---|
| Horizontal overflow | none; nothing renders past the viewport edge |
| Tap targets | nothing under 44px |
| Rendered contrast | every text run clears AA against its *composited* background |
| Accessible names | every interactive element named; void plate cells inert |
| Console | no errors, warnings or exceptions |
| Focus rings | real Tab produces a 2px outline on every control reached |
| Sheet snaps | 96px / 55vh / 88vh exactly, as §8 specifies |
| Reduced motion | all animation collapses; indicators settle visible, sheets still appear |
| Cell size | Vulture 44, Mule 44, Widow 44, Bastion 40 — §5's table and its one exception |
| Production bundle | workshop renders and places correctly minified; dev views inert |
| First load | 80.05 kB CSS / 329.71 kB JS; battle and lab chunks load on demand |

| Surface | Reached by | State |
|---|---|---|
| Workshop | `?view=workshop` | Ported and driven: arm, aim, rotate, place, detach, discard |
| Parts sheet | tap Parts | Ported, tabbed by category |
| Part detail | tap a placed part | Ported; the only route to Detach |
| Readout sheet | tap the readout bar | Five tabs: vitals, faults, power, bench, run |
| Intel | tap the action bar strip | Ported |
| Chassis | tap the topbar chassis control | Ported |
| Battle | `?view=battle` (dev) | Canopy, console, gun chips, Evade |
| Report | `?view=report` (dev) | Ported console; playback scrubber labelled |
| Salvage | `?view=salvage` (dev) | Harmonised, not ported — no prototype exists |
| Front door | `/` | Harmonised, not ported — no prototype exists |
| Balance Lab | `?view=balance` | Untouched desktop tool, by decision |

The three dev views are gated out of production by `resolveView`. `salvage`
especially: it calls `startCustom`, which overwrites the persisted run, so shipping
it would let a URL destroy a player's campaign.

That gating is verified against the built bundle, not just the source: serving
`apps/web/dist` and requesting `?view=battle`, `?view=report` and `?view=salvage`
lands on the front door every time, with no battle shell and no wreck overlay. The
production bundle was also driven through a placement — arm, place, "Placed", mass
1.80t to 2.15t — because until then every check in this document had been run against
the dev server, and the deploy serves `dist`.

## 4. What the port got wrong, and how each was caught

Recorded because the pattern is consistent and worth internalising: **the visual
port was the easy part.** Every defect below was behavioural, invisible in a
screenshot, and invisible to tests written against my own implementation. All were
found by diffing against the prototype's *source*, or by driving the app.

| Defect | Consequence | Found by |
|---|---|---|
| `.sheet.open` instead of `.sheet.on` | Every sheet translated 101% off-screen — the entire navigation model dead | class-coverage test |
| Old header above a `100dvh` shell | Readout and action bar pushed off the bottom of the screen | first screenshot |
| `.battle-app` had no positioning | Whole battle screen rendered below the workshop, invisible | screenshot |
| Report rendered `BattleHud` unscoped | Console fell back to raw text | screenshot |
| Detach only reachable via a readout tab | The one action on a selected part had no route | driving it |
| No keyboard cursor on the plate | Detach unreachable by keyboard entirely | reading the prototype's `keydown` |
| Ghost origin at the tapped cell | Multi-cell parts landed offset from the finger, defeating tap-then-confirm | reading the prototype's `click` |
| `nudge`/`rotate` clamped the origin, not the footprint | Parts walked or rotated off the chassis | reading the prototype |
| All 22 parts in one list | Radiators ~1900px down a scrolling sheet | a driver tap that missed |
| `<button>` inside `<button>` in salvage | Invalid HTML; the click may not arrive | reading the console |
| `--ink-faint` on `--surface-raised` | 4.26 contrast, below AA, on sheet labels | contrast audit |
| Ported `--cell: 40px` overrode §5's formula | Every plate cell 40px, under the 44px floor the design sets itself | measuring rendered boxes |
| `font:` shorthand missed by two sweeps | 10px text in front door and salvage, under the 11px floor | driving two unvisited screens |
| Multi-value and shorthand spacing missed | 62 declarations off the scale | grepping for what the sweep could not match |
| Enemy gun chips were handler-less buttons | 28px focus stops that do nothing | tap-target measurement |
| Report transport under-sized | 24px buttons, 24px tabs, 16px scrubber | tap-target measurement |
| Enemy name in `--signal-red` | 4.38 rendered, under AA, using a token §4 marks UI-only | rendered-contrast measurement |
| Unfilled threat marks in `--line-bright` | 1.87, under even the 3:1 graphical threshold | rendered-contrast measurement |
| Three copies of the occupancy map | UI owning logic the sim exports | reviewing the diff |

**My own tooling produced six false positives**, each of which nearly had me "fix"
working code:

- a 390px PNG cropped from a 500px layout, read as clipping;
- a scrim read as failing to cover, when it covered;
- `--tapText` matching a container instead of its child (tapping *Faults*);
- `--tapText` matching a shorter unrelated element (tapping *Widow* hit "Junkyard
  Widow", which looked like a chassis-selection bug);
- a scroll race making a tap silently miss, which looked like an invisible ghost;
- an accessible-name scan not excluding `aria-hidden` subtrees.

Two rules come out of that. Measure before believing a screenshot — and sanity-check
each instrument before treating its output as evidence about the app. Every tool here
has been wrong at least once.

The complementary rule, from §4's table: a rule correctly declared is not a rule in
effect. `--tap-min` was in the stylesheets and not in the rendering. The type scale
was adopted for the syntax I had searched for. Contrast passed at token level and
failed composited. Verify outcomes, not declarations.

## 5. Deliberate divergences from the prototypes

- **No desktop layout.** The prototypes are phone designs; the builder's `.device`
  rule is a bezel mock for its review page. Above 768px the shell holds a 560px
  column and centres it. This supersedes doc 14 §11's docking rails, which
  described the prose design.
- **Void plate cells are `<span role="gridcell" aria-hidden>`**, not buttons. The
  prototype uses buttons; a row's children must all be gridcells, and roleless
  buttons in a grid are invalid ARIA. Faithful to its layout, not to that.
- **The readout sheet has five tabs**, not the prototype's `build | bench`. The
  extra three carry what doc 14 §14 identified as must-keep from the desktop right
  rail: the speed envelope, the fault list, and `PowerPriorityList` — which is the
  only brownout-order control in the app, so losing it would remove a mechanic.
- **`HEAT`/`PWR` gauges retained** in the battle console. See §6.

## 6. The console, and what is left of the decision

The console is now the prototype's: the `.dmg` damage widget, then Core / Evade /
Mass as `.cbar` rows, then the `.gun` chips. **Option 2 was taken** — the widget was
added and the app's `HEAT`, `PWR` and `CAP` gauges were kept below it, because
dropping them removes information the prototype never had to display. The capacitor
gauge in particular is how a railgun or Surge build reads whether it can fire, which
doc 14 §12 discusses directly. Nothing was lost, and the choice is reversible.

The widget fades each cell by wear, as the prototype's does. That looked to need a
sim change at first — `MechFrame` has no per-part HP and `MechReport.partsFinalHp` is
end-of-battle only — but `shot` events carry the damage dealt to each part along the
penetration path, so the remaining fraction at any tick is derivable from the event
stream with no sim change at all. One gap: heat and cook-off destroy parts without a
`shot` event, so those show as destroyed rather than fading first.

Still genuinely open: the run panel and scrapyard, which have no prototype at all
(doc 14 §15) and are harmonised rather than designed. And the `FLANK`/`FLEE`/`FACE`
verb chips, which the prototype renders as an `.orders` row with a segmented
throttle — ours works and is legible, but it is not that.

## 7. Tooling

`scripts/drive.mjs` (`npm run web:shot`) drives Chrome over CDP. It exists because
`--screenshot` cannot do two things that mattered: Chrome enforces a 500px minimum
window width, so a phone screenshot is a crop rather than a phone; and nothing can
be tapped, which is why every sheet was off-screen for a day without anyone
noticing.

```bash
npm run web:shot -- 'http://localhost:5160/?view=workshop' /tmp/shot.png \
  --w 390 --h 844 --tap '.actionbar .btn-primary' --tapText 'Gill' --key Enter
```

`--tap`, `--tapText`, `--key` and `--media` interleave in order; `--eval` reports
any measurement. It prints viewport, overflow and console diagnostics beside every
image. Read those lines — the console one found a bug on its first run.
