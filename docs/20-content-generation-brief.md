# 20 — Content generation brief

**This document is a prompt.** Point an agent at it and say *"follow docs/20"*, or
paste the §2 goal and §5 loop into a fresh session. It exists so a content pass
starts from what the game measurably lacks rather than from whatever part
occurred to somebody.

Its bias is stated up front and is the owner's call: **interesting beats
balanced.** A part that creates a build nobody could make before is worth
shipping at the wrong power level. A part that is perfectly costed and changes
nobody's decisions is not worth shipping at all. Balance is a separate pass with
its own instruments (`docs/17`, `balance:report`), and it does not gate this one.

What is *not* negotiable is **reachability**. An interesting part that no player
and no search can ever assemble is indistinguishable from no part at all — and
this project has now shipped that mistake four separate ways in one afternoon
(§7). Interesting-but-unbalanced is a good outcome. Interesting-but-invisible is
not an outcome.

---

## 1. Read these first

- `CLAUDE.md` — the working agreement. Especially "never copy sim constants into
  UI code" and the `sim:try` section.
- `docs/17-balance-findings.md` **F16** — the four ways the instrument reported
  working gear as dead. Read it before believing any measurement in §5.
- `docs/19-watchlist.md` — open decisions. Two of them shape what you may author:
  the thermal model is settled (radiators work now), and "a part priced by the
  space it costs a small frame is underpriced on a large one" is open.
- `docs/01 §7` and `docs/04 §4c–4d` — the authoring contract: which fields a part
  and a mod must declare. `game:audit` warns on violations.

---

## 2. What "interesting" means here, operationally

Not a matter of taste. The archive already defines the design space, and empty
regions of it are the backlog.

`describeBuild` (`packages/sim/src/archive.ts`) labels every build on four axes:

| axis | buckets | rule |
|---|---|---|
| **range** | close / mid / long | midpoint of the ideal band; `<45 m`, `>100 m` |
| **weight** | light / medium / heavy | mass ÷ rated mass; `≤0.5`, `≤0.8`, above |
| **heat** | cold / redliner | sign of the heat margin |
| **kill** | damage / heat / power | which of the three the guns mostly do |

range × weight × heat is 18 archive cells. **A part is interesting if it fills a
cell that was empty, or lets a filled cell be won a different way.** That is the
goal function, it is measurable, and `sim:breed --json` reports it directly as
`emptyCells` and `coverage`.

Three softer signals, in descending order of value:

1. **It changes what the autopilot does.** The pilot picks a range by scanning the
   standing-exchange curve and has four verbs (weapons / move / throttle / face).
   A part that moves the peak of that curve, or makes repositioning pay, creates a
   different *fight*. A part that adds 8% damage does not.
2. **It makes a chassis want something it did not want.** Per-chassis identity is
   the point of three chassis. `W-SR` is the worked example: cut to the shape of a
   Vulture hardpoint, it made the scout the long-range frame.
3. **It creates a decision with a wrong answer.** Cost that binds — cells, mass,
   heat, a region, an arm — beats cost that is just a number.

---

## 3. The backlog, measured

**Re-measure before trusting any of this** — and compare a report's
`stamp.contentHash` only against *another report's* stamp, never against a hash
you computed yourself (`17` **F20**).

**The empty-cell backlog is closed, and the metric is retired — read `17` F52
before using this section.** After the 3 Sep pass `emptyCells` is one cell, and
that cell holds a **99%** build made of parts that already ship. Three of the four
cells empty during that pass held builds of 71-99% the search simply never
proposed; meanwhile *filled* cells hold builds that win 21% of their fights.
**Occupancy measures neither reachability nor quality**, so "fill the empty cells"
selects for what the search happened to try. Use `17` F52's replacement ordering:
a live-but-unpriced lever first, then a cost no part pays, then a dead lever
checked for a consumer — and empty cells last.

**Updated 2 Sep 2026, after the pass that produced `17` F28-F34.** The four cells
that stay empty across sweeps are `mid/heavy/cold`, `mid/heavy/redliner`,
`long/heavy/cold` and `long/heavy/redliner` — every heavy cell that is not close
range. **Do not author for them without reading `17` F34 first**, because three of
the four are not content gaps in any useful sense:

```
mid/heavy/cold        best reachable build   19%   <- may be a genuinely bad neighbourhood
mid/heavy/redliner    best reachable build   71%
long/heavy/redliner   best reachable build   95%   <- out of parts that shipped months ago
```

A 95% build already lives in `long/heavy/redliner` and the breeder never proposes
it. The cells are empty because of what the search explores, not because of what
the catalog contains — the third time in one pass that an empty cell turned out
to be the instrument.

The mechanism behind all four is worth knowing before authoring: **the weight
bucket is a load *fraction*** (`mass ÷ ratedMass`), so the cheapest way to be
"heavy" is to overload the *lightest* frame. Almost every reachable heavy build at
range is a Vulture carrying ballast, and an overloaded scout is slow, which at
range is fatal. That is why `W-CV` exists — not to reach the cell, which was
always reachable, but to make being heavy at range *sensible* on a frame where it
is not suicide.

The six-cell backlog this document originally carried was closed by two
parts and three search fixes, and the split is the lesson:

- **Two were real content gaps.** `close/heavy/*` wanted a dense part worth
  carrying (`W-AV`, `17` F17/F22); `long/*/redliner` wanted a gun that pays in
  heat rather than recoil (`W-KL`, `17` F23).
- **The rest were the instrument.** `long/heavy/redliner` was reachable at rank
  13 with parts that already shipped and simply never proposed (`17` F24).

So **the default assumption should be inverted**: an empty cell is more often a
search that cannot reach it than a part that does not exist. Run §7 — all eight
checks — before authoring anything.

**Use twelve locks or more before believing any dead-gear verdict, and read it
from `invariants.i3` rather than counting the gallery yourself.** Four locks give
twelve mod slots for a fourteen-mod catalog, so half the mods are never drawn and
the report cannot speak about them. At twelve locks every mod is offered, and
**every dead-gear verdict in this pass changed** (`17` **F27**): `U-ACT` and
`gyrostabilized` turn out to be taken, `U-TUR` and `U-SHELL` turn out to be dead,
and the dead-mod list is a different seven. `deadParts` and `deadMods` are
properties of the experiment before they are properties of the gear.

**The same applies to an empty cell.** An empty cell in a small sweep is weak
evidence of a content gap, so raise the lock count before authoring for one. At
twelve locks `emptyCells` has read **0** on some content hashes and **4** on
others; two runs at the same hash reproduce each other exactly, and two runs at
different hashes do not compare (F22). Treat the cell list as a property of the
draw domain until you have measured the best build that actually fits the cell.

**And be careful what a screen can see.** `screenFitness` is three battles at one
seed, sd 19.8 points — it separates builds only at about 40 points, so nothing
below that reliably influences selection (`17` **F26**). Gallery numbers are
fine; they come from `confirmFitness` at 40 seeds.

**Weapon spread** at the same report: 10 distinct weapons reach the archive,
`W-KL` 26%, `W-AV` 16%, `W-CB` 16%, HHI 0.146 — the widest spread on file.

## 4. The levers — what this engine can actually express

Author against these. Anything else is a new mechanic, which is a design decision
and needs asking about first.

**Geometry.** `shape` is a cell list, not a rectangle — `rows()` in `catalog.ts`
authors it as ASCII, the same way chassis masks are written. Rotation is
0/90/180/270 with no mirroring. A shape cut to a region mask is the strongest
identity tool available: it makes a part *belong* to a chassis without a single
special case. Regions, ports and location zones live in `chassis.ts`.

**Space.** `spatial`: `layer`, `stacksOn`, `height`, `clearsForward`,
`transfersHeat`, `thermalConductance`, `blocksPassiveCooling`,
`coveredHeatMultiplier`. Height and forward clearance mean a gun can be blocked
by its own hull — that is where risers and gimbals earn their place.

**Power.** Four ways a weapon can be fed, and they play differently:
mechanical (no draw at all), continuous, charged, capacitor-fed. Cap-fed is the
most interesting and the most dangerous: it is a *combination dependency*, worth
nothing without a reactor and a bank, and the search and the player both have to
be able to find that combination (§7).

**Heat, which now works.** As of 1 Sep a radiator sheds from every cell in its
conduction component (docs/17 F15), so cooling is finally a real system: thermal
mass, conduction, ports, the skin, and radiators are all live and all spatial.
The `radiator` modifier channel is no longer inert. Heat is the least-explored
working system in the game.

**Weapons.** `falloff` bands, `mountArcDeg`, `dispersionMrad`, `projectileSpeed`,
`salvoCount`, `recoilKnS`, plus `enemyHeatKj` and `capDrainKj` for guns that
attack a system rather than hit points.

**Mods and perks.** `ModifierDef` reads live physical context — `tempC`,
`speedMps`, `tile` — so a perk can be conditional on the fight rather than on the
build. Declare the condition in `isActive` beside `apply`, never re-typed in a
harness. `tier` is the only authored number: it sets draw weight `2^(1−tier)`,
the machinist's price, and rank cost, all three at once.

**Uniques.** Named bundles of part + mod + variant + quirks in `uniques.ts`. No
new rules, so this is the cheapest way to add identity — legendary metal, not
rules text.

---

## 5. The loop

Work one idea at a time, all the way through. Do not batch ten parts and measure
at the end; the measurements interact.

1. **Measure the gap.**
   `npm run sim:breed -- --locks 6 --budget 200 --workers 6 --json artifacts/gap.json`
   Read `emptyCells`, `coverage`, `invariants.i3`. Note the content hash.
2. **Write the hypothesis in one sentence** before authoring anything. *"A heavy
   build has no reason to exist, so: a part that converts mass into something —
   recoil absorption, armour that only works above 0.8 load, a reactor that scales
   with hull mass."* If you cannot state it in a sentence, the part is a stat bump.
3. **Author the smallest thing that could test it.** One part, or one mod. Numbers
   go in `catalog.ts` / `modifiers.ts` with a comment saying what they were sized
   against — the catalog's comments are the design record and reviewers read them.
4. **Register it** — §6, six places, non-negotiable.
5. **Play with it fast.** `npm run sim:try -- <chassis> <part>:<n>` is seconds.
   Twenty variations around one part is the right amount of exploration. **Read
   the `!` lines** — "wanted another Gill, but no perimeter cell is left" is the
   finding, and a stall is information.

   **Do not quote its score from a low seed count.** One identical build reads
   75/71/70/76/79/78% at 4/6/8/12/20/30 seeds — a 9-point spread with nothing
   changed (`17` **F30**). Six seeds is right for "does this assemble and what
   stalled"; **use `--seeds 20` or more for any number you intend to repeat.**
   A `hull-down` measurement of +7 at 8 seeds read 0 at 20, and a part was very
   nearly authored against it.
6. **Prove it is reachable** — §7. Do this *before* believing any verdict.
7. **Ask the instrument.** `npm run sim:breed -- --locks 6 --budget 200 --json ...`
   Did the empty cell fill? Did the part appear in `coverage`? Compare only
   against a run at the same content hash.
8. **Write down what happened**, including failures, in `docs/17`. A part that did
   not work is worth a paragraph — it stops the next pass re-authoring it.

Between steps 5 and 7, `assembleBuild()` and `evaluateBuild()` are exported from
`@mechbattler/sim` for scripted sweeps: one wish per variation in a loop is the
fast way to answer "which chassis wants this part?".

---

## 6. Registry checklist

A new part is not one file. Every one of these has failed on a real part; the
first four fail loudly on `npm run sim:test`, the fifth on `game:audit`, and the
sixth **fails silently and cost a 35-minute sweep**.

- [ ] `packages/sim/src/catalog.ts` — the part itself
- [ ] `packages/sim/test/weaponClass.test.ts` — the `EXPECTED` class map (weapons)
- [ ] `packages/sim/test/powerBudget.test.ts` — the power-predicate list
- [ ] `packages/sim/src/diversity.ts` — a verdict in `auditPartDifferentiation()`,
      saying what it competes with and why it is distinct
- [ ] `packages/game/src/content.ts` — an unlock route, and in
      `packages/game/test/game.test.ts` **both** the enabled-part count *and* a
      boundary case for the new challenge in `evaluates every authored challenge
      at its boundary`. That second one is easy to miss: the test indexes its
      fixture map by challenge id, so a new challenge fails with
      `Cannot read properties of undefined (reading 'won')` rather than
      anything that names the challenge.
- [ ] `packages/sim/src/breeding.ts` — `MIDGAME_POOL`, or the breeder can never
      draw it. Guarded by `breedingPool.test.ts` for weapons, reactors and
      capacitors; **nothing guards a utility part.**

Then `npm run verify` and `npm run game:audit` — the audit's `warnings` channel
names anything outside the authoring contract.

---

## 7. The reachability gate

**A single "dead gear" reading is not evidence about a part.** On 1–2 Sep four
independent breaks each produced output identical to dead gear, and each was
reported as a verdict before the next was found (docs/17 F16). Before concluding
anything about a part, check all four:

1. **Was it offered?** `invariants.i3.neverOffered` in the JSON. Never-offered and
   never-wanted look identical in the gallery and the coverage table.
2. **Can it be completed?** `assembleBuild({ parts:[{partId, count:1}] })` and read
   `issues`. A part that needs a companion — a capacitor, a riser, a port — scores
   zero alone, and every step toward it is downhill for a greedy search.
3. **Can it be placed in any order?** Assemble it listed first, middle and last.
   A part with few legal placements vanishes if something else lands there first.
4. **Did the lock contain what it depends on?** `assembleBuild` will not reach past
   the lock, correctly. A missing dependency does not restrict the part, it
   deletes it.

If a part fails any of these, you are measuring the instrument. Fix the
instrument, then re-measure.

**Five more, added 2 Sep 2026, because the gate above only asks about parts.**
An empty cell and a dead lever are claims about the *search*, and it failed three
more ways in one session:

5. **Can the search propose the shape at all?** Mods were enumerated onto
   one-part genomes only, and a one-part genome scores above zero only if that
   part is a gun — so no mod that rides a radiator, riser or plate was ever
   proposed on a build that could win, and eleven of fourteen mods had never
   appeared in any sweep (`17` **F19**).
6. **Can the gene travel to where the cell is?** Armour mutated by ±1 with a
   floor at 0, a reflecting random walk: 0 of 400 walks reached the eight plates
   `long/heavy/redliner` needs. The cell was reachable at rank 13 with parts that
   already existed (`17` **F24**). **Before authoring for an empty cell, sweep
   existing parts across the axis that cell sits on and check nothing already
   fills it.** That check costs a minute and would have saved a part.
7. **Is the completer choosing well?** It closes an energy gap with the smallest
   reactor that helps and cannot upgrade when cells run out — worth 25 points on
   one build, and it bites hardest on exactly the heavy builds the archive lacks,
   because the demand is `1.2 * massT * cruiseSpeed` and mass is the load
   (`17` **F21**).
8. **Does a mod have any enabled carrier?** An `appliesTo` that matches nothing
   scores `+0.0`, identically to an effect that does nothing (`17` **F18**).
   `game:audit` warns on this now.

9. **Is the cell empty, or merely unproposed?** Reachability is not enough — ask
   what the *best* build in that cell actually scores. Gate 6 says sweep existing
   parts across the axis; this says score what the sweep finds. `long/heavy/redliner`
   holds a **95%** build made of parts that shipped months ago, and
   `mid/heavy/redliner` a 71% one, and the breeder proposes neither (`17` **F34**).
   An empty cell containing a strong build is a search finding and authoring
   against it wastes a part. An empty cell whose best build measures 19%, like
   `mid/heavy/cold`, is at least honestly empty.

   The cheap version: `assembleBuild` a few dozen candidates into the cell, run
   `evaluateBuild` on the survivors at **20+ seeds** (F30), and look at the top
   score before writing any catalog entry. It costs a minute.

**And you cannot A/B a part on this harness.** `MIDGAME_POOL.parts` is the draw
domain, so adding one id re-rolls every lock at the same seed and the two runs
are different experiments — `W-CB` once read 70 uses to 0 and had simply never
been offered (`17` **F22**). Only **build-level** attribution is safe to quote:
does the build that fills the cell actually contain the part?

**The general form, which will recur:** any part whose value depends on another
part is invisible to a greedy search and hard for a player to discover. If you
author one, give it a legible failure path — a `validateBuild` fault or a
`computeHeatAdvice` hint that names the missing companion, the way
`cap-starved-weapon` and `radiator-orphaned` do.

---

## 8. Traps, all of them paid for

- **Never author a number the sim derives.** Read it from the sim or derive it
  from frames and events. The battle diagnostics substituted constants for five
  different derived values and each was found only while fixing the last.
- **A modifier channel can be inert.** The `radiator` channel did nothing for a
  year and every mod authored on it was dead on arrival. Before authoring against
  a channel, swing its constant to zero and to ten times its value and confirm
  something moves.
- **`appliesTo` declining reads as `+0.0`.** A mod that was never legally attached
  measures identically to a mod with no effect. Assert the attachment took.
- **A part priced by the space it costs a small frame is underpriced on a large
  one.** `W-SR` costs a Vulture an entire arm and a Bastion nothing much; a
  two-Pinion Bastion hits 100%. Open on the watchlist — read it before authoring
  another region-shaped part.
- **`tier` is capped at 4** and does three jobs at once (draw weight, price, rank).
  "Rare but weak" is not currently expressible.
- **Edits are not live until vite rebuilds**, and `dist` must be rebuilt before a
  parallel sweep — the sweep refuses to start if source is newer, which is correct
  and will kill a running experiment if you edit mid-sweep.

---

## 9. What not to do

- **Do not balance.** Do not tune a number to move a win rate, do not re-cut
  `artifacts/balance-baseline.json`, and do not block on a balance harness — they
  are all report-only. Record swings in `docs/17`; leave fixing them to a
  deliberate balance pass.
- **Do not invent mechanics without asking.** New fields on `PartDef`, new
  modifier channels, new chassis rules, and anything touching screens with no
  prototype (front door, run panel, salvage, scrapyard) are design decisions.
  Geometry, numbers and combinations of existing levers are not — author freely.
- **Do not delete a finding to make a report green.** A stall, a dead part and a
  failed hypothesis are all results.

---

## 10. Report like this

Per idea, short:

> **Hypothesis.** Heavy builds have no reason to exist (7 of 189 archive entries).
> **Authored.** `U-BAL`, 4 cells, 400 kg, absorbs recoil in proportion to hull mass.
> **Reachability.** Offered ✓ · completes alone ✓ · any order ✓ · no dependency.
> **Measured.** `close/heavy/cold` filled at 61%, CH-9 only. Coverage 14.
> **Verdict.** Keep. It is the first reason to be heavy.
> **Cost.** `bastion-tank` −7 since baseline, not tuned, recorded in docs/17.
