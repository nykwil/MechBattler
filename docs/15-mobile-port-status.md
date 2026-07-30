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
| Run loop | front door → New run → Load → Launch → Fight · Live → report → Rematch, driven end to end at 390×844 |
| Salvage after a win | **not driven** — see below |

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
| Handle repurposed as a snap cycler | The prototype's `id="s-close"` was the *only* close control; cycling it left peek and half with no way out | user report |
| Scrim rendered only at `full` | Nothing to tap outside a peek or half sheet — Parts, Next match and details could all strand you | user report |
| Placing did not disarm | The prototype's `place()` ends `S.armed = null`; a live ghost stayed on the plate and the next tap re-aimed a copy, so placing read as *copying* | user report |
| "Placed" toast inferred from part count | A count cannot tell a move from a new fitting, so every move claimed a placement | driving detach-then-place |
| `cbar-k`/`cbar-v`/`con-foot` at 9px | Core, evade and mass — the numbers the fight is read from — under the 11px floor, legend truncated mid-word | driving the battle screen |
| Gridlines every 25 m, verticals only | Drawn from the arena centre while terrain tiles are laid from the corner at `cellSizeM`, so the lines cut the tiles they bound — and with no horizontals it was not a grid | user report |
| `.gun-rng` and `.heatcol` never wired up | The prototype designed a range slot on every gun chip and a whole vertical heat column; both sat in `battle.css` unused while the port showed a blank half-chip and a horizontal bar | reading the prototype's CSS |
| Face carried a phantom fourth state | `MechFrame.faceMode` is `'target' | 'bearing'`; the control cycled four stops, so a two-way choice was unpredictable from its label. tsc proved the branch unreachable once the type was honoured | honouring the sim's type |
| Heat thresholds typed in the HUD | 115/130/150 were inline literals in the sim *and* re-typed in the UI, so a gauge marked 130 would have kept saying 130 after the sim moved it | drawing the heat marks |
| Projectile linger fixed at 0.22 s | Slow rounds are airborne far longer, so they vanished mid-flight; a round's window is its own flight time | drawing rounds |
| Driver forced `mobile: true` always | It sets `hover: none` whatever else you emulate, so **every desktop screenshot ever taken here had the app's `@media (hover: hover)` rules switched off** | building a hover-only element |
| Report's exit below the fold | On a run victory "Back to workshop" measured y=1062 in an 844px viewport. `.report-panel` scrolls, so it was reachable — but nothing said so, and mobile hides scrollbars, on the one screen a player *must* leave. Now pinned to the panel foot, as the workshop's action bar already is | driving the machinist milestone |

**My own tooling produced nine false positives**, each of which nearly had me "fix"
working code:

- a 390px PNG cropped from a 500px layout, read as clipping;
- a scrim read as failing to cover, when it covered;
- `--tapText` matching a container instead of its child (tapping *Faults*);
- `--tapText` matching a shorter unrelated element (tapping *Widow* hit "Junkyard
  Widow", which looked like a chassis-selection bug);
- a scroll race making a tap silently miss, which looked like an invisible ghost;
- an accessible-name scan not excluding `aria-hidden` subtrees;
- a Chrome profile shared by port number, so a stale mid-run state rendered over the
  workshop and was read as a layout bug, and a carried-over starter build made a
  "placed four cells" assertion read fourteen. Fixed: a fresh profile per run,
  removed on exit;
- `--tapText 'POWER'` matching nothing, because the label is uppercased by CSS and
  the DOM text is `Power` — which looked like dead tabs;
- clicking the centre of a full-snap scrim, which lands on the sheet in front of it
  (`elementFromPoint` returned `foe-head`) — read as a sheet that would not close.

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

## 7. A balance finding, surfaced by making the game reachable

Driving the campaign on a phone, the obvious first action — Load the provided
blueprint, Launch, Fight — lost three times out of three, core destroyed in 7 to 10
seconds each. That blueprint is not incidental: `legalStarterBlueprint` in
`packages/game/src/persistence.ts` seeds "Vulture Skirmisher" into every new profile,
so it is what a new player is handed.

This is **not** something the port introduced, and it should not be fixed here. The
game's own harness already measures it. `npm run game:balance -- 6` reports:

```
Round 1 match win rate 0.1346 is outside the target band
Round 4 match win rate 0 is outside the target band
No natural progression checkpoint reached round 7 / 10 / 12
```

The band it is outside is `balanceTargetWinRateMin/Max` in
`packages/game/src/content.ts`: **0.35 to 0.65**. So the game states an intent and
misses it by more than half. A larger sample (`-- 8`, 68 round-1 matches) puts the
rate at **0.147** — steady across sample sizes, so this is the real figure and not
noise.

The sample counts are the sharper number. Of those 68 round-1 attempts, **three**
reached round 4, where they won none; rounds 7, 10 and 12 were never reached at all.
The checkpoints exist at 1, 4, 7, 10 and 12, so four fifths of the ladder has never
been played by the harness, let alone balanced.

Two consequences worth separating. As a *design* question this is whether the
starting blueprint is meant to be survivable, which is a call for whoever owns the
balance targets. As an *engineering* question it is why the scrapyard, the machinist
milestone and the victory path all went unverified for the whole port: everything
past the first node sits behind a coin-flip weighted 6:1 against. That half is now
solved regardless of the design answer — `npm run web:campaign` decides the fight by
stripping the opponent's weapons, so those paths are reachable in three minutes.

So roughly seven of eight first fights are losses, and the cohort includes
`vulture-skirmisher` among its starters. Three losses from three is consistent with
that, not evidence of a new bug.

Two things make it worth writing down rather than leaving in a report nobody opens:

- These are **warnings, not failures**. `npm run verify` prints them and exits 0, so
  the gate stays green while the first-run experience is a sub-ten-second loss.
- The port changed who sees it. The campaign was previously hard to reach on a phone;
  now the shortest path from the front door ends in a fast defeat.

Whether that is intended difficulty, a tuning gap, or a starter-kit problem is a game
design decision. It needs someone who owns the balance targets, not a port.

### What is not driven, and why

**Resolved.** The victory path is now driven end to end and regression-tested by
`npm run web:campaign`. Stripping the opponent's weapons through the driver's
`--exec` makes the win decided, so the node takes about three minutes instead of
half an hour of retries. Driving it is what found the bug that mattered: fighting
from the intel sheet — the mobile path — settled nothing at all, so a win gave no
purse, no salvage and no node.

**Still not driven: the core-kill loss.** Losing ends the run, and that branch fires
— observed once, `status: over`, cause "Core destroyed by Copper Vulture Sniper".
But it cannot be forced. Five further attempts with a mech stripped to guns and a
reactor all ended in mission-kill or judges instead, which keep the node. The
`settleRunFight` unit tests cover the decision; what is unverified in a browser is
only the wiring that shows the memorial when the run ends that way.

The original note, kept because the reasoning still applies to the loss branch:

The wreck screen itself is verified via `?view=salvage`,
which runs the real `beginSalvage` and `createSalvageCandidates`, so the screen is
exercised — but the transition from a *won* battle into it is not.

Reaching it means winning a node fight, and §7 is why that is hard: the starter
blueprint wins about one first fight in eight. A driven attempt takes roughly three
minutes end to end, so hunting a win costs about half an hour of wall clock for one
sample. I stopped after six attempts, all defeats.

Options for whoever picks this up, in increasing order of soundness: keep retrying;
temporarily hand the player an overwhelming build, which verifies a path no real player
takes; or extract the report-close handler in `App.tsx` — currently a long inline
closure — so the victory branch can be unit-tested deterministically. The last is the
only one that stays true after the balance question in §7 is answered either way.

## 8. Tooling

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
