# 15 — Mobile port: state, verification, and what is still open

*Written Jul 30 2026, on branch `mobile-first`. Records what was ported, how each
surface was verified, what deliberately diverges from the prototypes, and what is
still outstanding — see §9, which is the section to read first if you are picking
this up cold. Read `CLAUDE.md` first — it carries the working rules
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
| Cell size | Vulture 44, Mule 44, Bastion 40 — §5's table and its one exception |
| Production bundle | workshop renders and places correctly minified; dev views inert |
| First load | 81.5 kB CSS / 323.8 kB JS; battle and lab chunks load on demand |
| Run loop | front door → New run → Load → Launch → Fight · Live → report → Rematch, driven end to end at 390×844 |
| Salvage after a win | driven: win → report → wreck → take → strip → bench → fit → placed on the mech |
| Run over | driven: a searched-for core-kill seed ends the run and shows the memorial |
| Campaign loop | regression-tested by `npm run web:campaign`, with a proven negative control |

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
| `.playback` had no height of its own | It grew to 1105px inside a 900px parent and `overflow:hidden` ate the rest — the orders row half off screen, the ticker entirely below it, no page scroll to reach either | measuring desktop |
| Arena SVG painted over the console | Once the column was constrained the SVG kept its aspect height and overflowed its wrapper. Core and Evade were laid out, measured *inside* the console, and reported visible — they were underneath. A bounding box cannot see overlap; a hit test at the element's centre can | screenshot vs measurement disagreeing |
| `.cbar-v` fixed at 42px | Fits "100%", clips "999/999" silently, and Pwr is demand/supply with three digits available to each half | setting each box to its worst-case string |
| Instruments hardcoded their inputs | The spread and diagnostics fed `TRACKING_LAG_BASE_S`, catalog dispersion, an uncovered silhouette and a neutral target profile into `computeHitModel` — so they disagreed with the sim precisely on the builds and terrain fitted to change those terms. All four now read the same inputs the model does | reviewing my own new code |
| `frames.indexOf(frame)` | A linear scan of the battle per render, twice a frame — and identity-based, so a rebuilt array returns -1 and a moving mech silently reports 0.00 m/s | reviewing my own new code |
| Diagnostics truncated its own numbers | The prototype's two-column grid at 390px cut "4.43 mrad" to "4.43 mra" and hid the hit chance. An instrument that truncates is worse than none: a wrong reading looks real | first render of the port |
| Report's exit below the fold | On a run victory "Back to workshop" measured y=1062 in an 844px viewport. `.report-panel` scrolls, so it was reachable — but nothing said so, and mobile hides scrollbars, on the one screen a player *must* leave. Now pinned to the panel foot, as the workshop's action bar already is | driving the machinist milestone |

**My own tooling produced nine false positives**, each of which nearly had me "fix"
working code:

- a 390px PNG cropped from a 500px layout, read as clipping;
- a scrim read as failing to cover, when it covered;
- `--tapText` matching a container instead of its child (tapping *Faults*);
- `--tapText` matching a shorter unrelated chassis label on an opponent card,
  which looked like a chassis-selection bug;
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

### Battle screen, second pass

Requested after the port: cones now draw each weapon's mount arc out to its falloff
band and its minimum where one exists; rounds are streaks that stop at the hull,
with misses passing by and hits leaving an impact ring; the shot's real spread is
marked at the target as ±1σ and ±2σ from `computeHitModel`; the prototype's `ƒx`
diagnostics overlay is ported; power moved into the console bars; hover detail left
the layout entirely; and both viewports now end exactly at the fold.

Weapons gained an optional near-side falloff (`rangeMin`/`multAtMin`) — the far side
already existed. Rockets and the railgun have one; everything else is provably
unchanged at contact. `game:balance` is unmoved, because the starter carries neither.

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

One thing does not add up, and it should be understood before the blueprint is
changed. Fought head to head against the round-1 opponents it will actually meet --
every node-1 choice from 60 real runs, at that opponent's own battle seed and spawn
distance -- the starting blueprint wins **50 of 147, 34%**. That is at the band's
floor, not a sixth of it. `npm run game:balance` says 0.147 for the same round.

**The gap is explained, and it changes the diagnosis.** `game:balance` allows two
attempts per node (`balanceMaxAttemptsPerNode: 2`), cycling opponents. Losing runs
`settlePlayerDamage`, which *removes* parts at zero integrity — and the between-round
policy repairs integrity but cannot bring a destroyed part back. So the second
attempt is fought with a permanently diminished mech. Modelling exactly that policy:

```
attempt 1 (pristine):                 29/60 = 48.3%
attempt 2 (after losses, parts gone):  1/31 =  3.2%
blended round-1 rate:                 30/91 = 33.0%
```

So the starting blueprint is **not** too weak: it wins 48% of first attempts, in the
middle of the 0.35-0.65 band. What collapses the aggregate is the retry.

How much of that is the stripping rule specifically, measured by re-running the same
retries with the mech left pristine:

```
attempt 2, parts stripped: 1/31 =  3.2%
attempt 2, parts kept:     5/31 = 16.1%
```

So stripping is worth about thirteen points, and is not the whole story. Two other
things are mixed in and this method cannot separate them: the retry faces a
*different* opponent (the harness cycles them, so attempt 2 is usually the elite),
and the retry sample is by definition the seeds where attempt 1 was already lost,
which selects for bad matchups.

The honest summary is that a first fight is fair, a retry is not, and the permanent
loss of parts is a real but partial cause. Buffing the blueprint would treat none of
it.

(The model lands at 33%, not the harness's 0.147, because it plays one node rather
than whole runs. The mechanism is demonstrated; the exact figure is still the
harness's to report.)

`scripts/starter-odds.mjs` reproduces all of the above. It isolates one question: first
fight, pristine build, no run context. `game:balance` plays whole runs and is the
authority, so where the two disagree it is right and this is missing something --
most likely how the harness picks an opponent, or state carried into the fight. But
the gap is a factor of two, so "the starter is far too weak" may be the wrong
diagnosis, and tuning the build on the 0.147 figure could be tuning the wrong thing.

Odd enough to mention: elites (threat 3) came out *easier* than normals -- 42% of 31
against 32% of 116.

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

**Now driven: the core-kill loss.** Rather than hope for one, search for it: the
sim is deterministic, so a seed that produces a core-kill can be found and that
opponent injected into a live run. Seed 1's first node-1 opponent does it in 13.2 s.
Driven end to end — `status: over`, with a generated opponent core-kill cause,
and the memorial shown on the run tab, which was the one line that had never been
observed in a browser.

The original difficulty, kept because the reasoning holds for any rare outcome: Five further attempts with a mech stripped to guns and a
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


## 9. Open at close

Written when the working thread ended. Everything below is either a decision that is
not the implementer's to make, or a gap named deliberately rather than papered over.

### Decisions waiting on the owner

**1. Merge `mobile-first` into `main`.** 113 commits. It publishes to the GitHub
Pages demo and changes what desktop visitors see, so it was never done unasked.

**2. The retry economy** (§7). A first fight is fair — 48.3% against a stated band of
0.35–0.65. A retry wins one time in thirty-one. That is three separable calls:
whether a lost fight strips parts permanently, whether a node should be
re-attemptable in that state at all, and whether the retry should face a fresh
opponent (the harness cycles them, so it usually draws the elite).
`scripts/starter-odds.mjs` re-measures after any change. **The standing read that the
starting blueprint is too weak is wrong** — buffing it would treat none of this.

**3. Ammo on mobile.** The sim does not consume ammo (`diversity.ts` calls `U-AMMO` a
dead placeholder until Track C). A placeholder was asked for and exists in the gun
chip's hover blurb, but it does not fit on the chip itself beside band and arc at
390px — it clipped when tried. Recommendation: leave it off the chip until the sim
models it, rather than displace two real numbers with a fake one.

### Gaps named on purpose

- **Target part temperature in the diagnostics.** `targetProfileMultAt` passes
  ambient. The sim reads each part's own mean cell temperature and a frame carries
  temperature for weapons only. Exact for every modifier whose profile term does not
  vary with heat, which is all of them today; wrong the moment one does.
- **`foeBuild` is only wired in the live battle.** `BattlePlayback` passes a
  `BattleReport` as its view and `MechReport` carries no build, so a diagnostics
  overlay opened during replay would read a neutral target profile. The overlay is
  only reachable live today, so this costs nothing until someone adds the toggle to
  playback.
- **Desktop arena letterboxes.** The map is square inside a ~560px column, so a wide
  viewport leaves dead space either side inside the canopy. A consequence of capping
  the SVG height to stop it painting over the console — cosmetic, and widening it
  would mean inventing a desktop design, which docs/14 §15 says does not exist.
- **Run panel and scrapyard were never designed for mobile** (docs/14 §15). They are
  harmonised with the shell's tokens and driven, but nobody drew them.

### The two lessons worth carrying

**Screens passing tells you nothing about flows.** The mobile interface could not
advance the campaign at all — fighting from the intel sheet settled nothing, so a win
gave no purse, no salvage and no node — while every screen involved rendered
perfectly. `npm run web:campaign` exists because of it.

**An instrument must not hardcode what the model computes.** The spread and the
diagnostics substituted constants for fire-control lag, weapon modifiers, terrain
cover, target profile and target speed in turn — each found reviewing the fix for the
previous one. All five now read what the sim reads. This is a specific hazard of
building something to measure a model: attention goes to the output and the inputs
get quietly invented.
