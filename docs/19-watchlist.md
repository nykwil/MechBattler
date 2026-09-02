# 19 — Watchlist

Things we are deliberately keeping an eye on. Not a backlog and not a bug list:
each entry is something that is *fine right now* but could bite, or a decision we
took knowingly and want to revisit with more evidence.

An entry leaves this file when it is fixed, or when we decide it is permanent and
write it down somewhere that isn't a watchlist. Keep the reason, not just the
symptom — the point of the file is that the next reader inherits the judgement,
not only the fact.

## Balance

**The baseline now includes component height's swing** (re-cut 26 Aug 2026,
deliberately, before the content-generation pass). The height rule had moved five
builds by 5+ points — `mule-laser-boat` +29, `vulture-skirmisher` +24,
`bastion-tank` −7, `vulture-sniper` −17, `mule-gunline` −27, correlation −0.586 →
−0.637 — and that is now the reference rather than a pending diff. **Nothing was
fixed by re-cutting**; the record of what moved and why is F5 in
`docs/17-balance-findings.md`, and F1 is still the open regression. The reason to
re-cut was that a stale reference would have mixed height's swing into every diff
the content pass produced, and the diff is the whole instrument.

**The swing is geometry, not budget.** `railgun-mule` is the build that actually
lost a part and it moved −4. `mule-gunline` kept every part and moved −27. Watch
whether height systematically pushes guns to outer lanes on narrow hulls, and
whether the flank exposure that buys is what is moving the numbers.

**Two report-only findings stand** from `npm run verify`: a dominant combination
on `mule-fever-cycle`, and `gyrostabilized` reading as a dead perk. Both predate
the height work.

**Rank peaks at 10 and declines after it** — measured 29 Aug 2026 by the first
`sim:breed` sweep, on all three chassis, and recorded as **F6** in
`docs/17-balance-findings.md`. It corroborates F2 by a completely different
method. Do not tune `ladderBudgetPerNode` from the k = 4 figure until the curve
stops declining: the number describes the peak as much as the player.

**The ladder's difficulty curve is a cliff, not a ramp** (measured 25 Aug 2026,
`game:balance -- 4`, post component height). Round 1 wins **0.897**, round 4
**0.238**, round 7 **0.000**, and no run reached round 10 or 12. Nothing was tuned
to cause it; component height is the obvious suspect and is unproven as one.

What changed since: the *target* is now a declining curve per checkpoint
(`balanceTargetWinRateByDepth`, 25 Aug 2026) rather than one flat 0.35–0.65 band
applied everywhere, because the old instrument called a winnable opening and an
unplayable depth the same kind of failure. Under the new target round 1 is in band
and **rounds 4 and 7 still warn**, which is the point — the finding survives, and
is now the only thing warning. No budget or content dial moved to get there.
The cliff itself is still unexplained and belongs to the next balance pass.

**`simContentHash()` differs between source and compiled runs.** Measured
26 Aug 2026: the same content hashes `5e2b472e` under `tsx` and `bd14455b` from
`dist`. The cause is benign — the fingerprint includes `apply.toString()` for
every modifier, and compilation strips the comments inside those functions — but
the hash is the multiplayer lock-in stamp (docs/11 M0), so a replay stamped from
a source run would not match one stamped from a build of the identical content.
Nothing depends on it today, and the fix (hash a normalised form, or the
modifier's declared fields only) is a change to a determinism contract, which is
not something to slip into an unrelated pass.

## Component height (shipped 25 Aug 2026, `502cb0f`)

**`railgun-mule` is a three-capacitor railgun now.** `W-RG` is `rect(2,5)` and
has no riser, so once the core cell, the cargo bay and the gun's own footprint
are accounted for, the Mule has room for exactly three two-level parts. The
fourth capacitor has no legal cell. Forced, not chosen — but if the railgun build
reads as weak, this is where to look first.

~~**`grid.ts` and `spatial.ts` each declare the placement-reason union.**~~ Fixed
25 Aug 2026: `SpatialPlacementReason` is declared once in `types.ts`, which both
can import without a cycle, and `PlacementError` composes it.

~~**Four test gaps.**~~ Closed 25 Aug 2026, and two of them said something. The
region seam and the riser ceiling behaved as designed. The precedence case does
have an answer worth knowing — a stacking failure outranks a ceiling failure,
because "it cannot stand on that" is the thing the player can act on. And the
fourth is gone rather than pinned: the inspector now says "nothing may stand
ahead" instead of "0 levels", so there is no backwards copy left to test.

## Uniques (added 26 Aug 2026)

**A unique sells for exactly what its stock part sells for.** Scrap value is
`tier x multiplier x integrity`, and a unique is an ordinary part underneath, so
the Assize fetches the same 13 scrap as any autocannon. That is arguably right —
the metal is worth what the metal is worth, and the value is the identity, not
the resale — but it does mean a player short of scrap can scrap a named piece
without the price ever telling them it was special. Left alone deliberately:
pricing rarity into salvage is an economy change and belongs in a balance pass,
not beside the content that introduced it.

**Nothing yet stops a unique being fed to the machinist's copy rules.** It cannot
take a second mod (the one-mod-per-part rule already refuses), so this is fine
today. It is listed because the interaction was reasoned about rather than
tested, and because a future mod-removal or reroll service would break it.

## Rank and the breeding tool (added 27 Aug 2026)

**Tier now does three jobs on a mod.** `ModifierDef.tier` replaced `rarity` and
`scrapCost`: it sets draw weight (`2^(1−tier)`), the machinist's price
(`tier × 15`), *and* how much rank the mod costs. The consequence is that "rare
but weak" and "common but strong" stopped being expressible — making a mod
scarcer necessarily makes it dearer in both scrap and rank. Parts already live
with exactly this coupling and it was accepted knowingly. Watch for the first
mod that genuinely wants to be common and strong; that is the signal to split
them again.

**A unique's variant roll and quirks are free rank.** `computeRank` prices a
unique at its underlying mod's tier, because that is what the rank formula says.
But a unique is *also* an extreme variant roll plus quirks, and none of that
costs anything. If uniques start dominating archive elites at their nominal
rank, this is why.

**The elite mod trim cannot always succeed.** An elite's mod is stamped after
the budget is spent, so generated fill is dropped to pay for it. When the
template alone fills the budget there is no fill left, and the alternative would
be deleting the opponent's own identity. Measured over 200 seeds: 95% of modded
cards land inside budget, 5% overspend by at most one mod's tier. Fine for now;
revisit if the ladder ever needs opponents to be exactly on budget.

**The noise band and `I2_MAX_SPREAD` are uncomfortably close.** At the default
40 confirm seeds the band is 6 points and I2 polices an 8-point spread, so I2 can
only just tell a real failure from sampling. A defensible I2 verdict needs
`--confirm-seeds 90` (band 4 points, ~2 min an elite). Watch for anyone quoting
a marginal I2 result from a default run — the report labels within-band
comparisons, but a 9-point spread at a 6-point band is still thin.

**Every threshold in `invariants.ts` is provisional.** I1 at 0.75/0.60, I2 at 8
points, the k-measurement at 0.5, and the descriptor bucket edges (range 45/100
m, weight 0.5/0.8 of rated mass). They were written down so the first sweep had
something to disagree with, not because they were measured.

**The bucket edges look mis-set already.** Across the whole canonical roster
nothing is `heavy` (the largest load factor is 0.74 against a 0.8 threshold) and
nothing is `long`-ranged, and six of seven are `redliner`s. So three of the
archive's eighteen cells may be unreachable by construction rather than because
no such build exists. Check this against a wide sweep before moving the edges —
it may equally be a fact about the catalog, which would be the more interesting
answer.

**A finding was once manufactured out of the confirm pass's own seeding**
(docs/17 F6, retracted 31 Aug 2026). The lesson kept rather than the fact: the
instrument's precision has to be measured before its readings are quoted, and
"the same input twice" is the cheapest check there is. The report now prints its
noise band above every table for exactly this reason.

**The screen saturates, and the tie-break is a patch over that.** A rank-6 build
beats all three screen-panel opponents 3/3, and so does a rank-20 one. A
decisiveness term (hull left, time taken, weighted 0.05) gives the search a
gradient, but the underlying fact stands: the canonical roster is not a hard
enough yardstick for a well-built mech at any rank above about 6. Related to
F2's inverted budget/win-rate correlation — `bastion-tank` is rank 25 and loses
to rank-6 builds. A harder panel would be a real improvement and is not one to
make casually, because the panel is also what makes reports comparable.

## What the corrected sweep left open (added 1 Sep 2026)

Three diagnoses, none of them acted on. Each is a decision, not a nudge — the
point of writing them here is that the evidence exists and the change does not.

- **The Bastion is charged for the autopilot's missing evasion verb.** F8
  measured +35 points on CH-9 at rank 16 from a strafe change alone. Do **not**
  fix this by raising the Bastion's strafe — lateral speed is the thing an
  assault biped trades for armour. The candidate fix is a second defensive verb
  (break line of sight, use hard cover, back off behind a hill) so a slow chassis
  has a play. Until then, read every I2 failure as part pilot.
- **CH-9 at rank 8 is broke, not slow.** The frame is 4 of the 8 points, so a
  rank-8 Bastion has almost nothing left to build with (19% ceiling, unmoved by
  the strafe probe). This is the known cost of D3 putting chassis into rank, and
  it is the argument for either a lower `chassisTier` spread or a rank floor
  below which heavy chassis are not offered. Do not confuse it with I2.
- **Long range cannot be occupied (F9).** No gun is authored to be best beyond
  80 m, and eight of nine chassis matchups close the distance regardless of
  build. Reviving W-RG needs one of: a reverse-speed pass, a kiting/LOS verb, or
  a long gun light enough for a Vulture. All three are design calls.
- **Cooling is inert below 115 °C (F10).** Temperature only reaches an outcome
  through fire-hold (115) and shutdown (130), so a cooling mod on a build that
  peaks at 80 °C is worth exactly zero — measured, bit-identical over 280
  battles. Before authoring any new cooling content, decide whether heat should
  have a gradient below the threshold. Today it does not, and that is why the
  one deliberate redliner is the dominant build.
- **`U-ACT` is a doorway nobody walks through.** Four mods — `coil-sprung`,
  `gyro-flywheel`, `hull-down`, `weaving-gait` — require it, and no canonical
  template fits one. Either U-ACT earns its 2 cells and 4 kW, or those four mods
  should hang off something that gets fitted. Worth settling before the content
  pass authors more mods behind the same door.
- **Check `appliesTo` before believing a zero.** An A/B that attaches a mod its
  `appliesTo` declines returns exactly +0.0, which reads identically to a mod
  that does nothing. This cost a full measurement pass. Any future mod harness
  should assert the attachment took.

## ~~There is no cooling model~~ — settled 1 Sep 2026: radiators now radiate

Closed. The decision taken was **make cooling real**: a radiator sheds from its
whole conduction component rather than from its own cells, the two radiator-loop
defects are fixed, and `computeHeatBalance` now quotes cooling at the fire-hold
threshold split into skin and radiators instead of crediting radiators
everything and the skin nothing. docs/17 F15 is the record. `tidecooler` is no
longer inert, so the `radiator` modifier channel is safe to author against.

What it leaves behind, and what to watch:

- **Cheap parts in an outlying region are armour, and nobody designed that.**
  Removing `mule-gunline`'s orphaned radiator cooled it by 42 °C and cost it
  7 points, because the part was a decoy soaking fire in a region that cannot
  threaten the core — it died in 90% of fights there against 3% in the body.
  Know this before the content pass authors more cheap utility parts; a 1-cell
  part on a sponson may be priced as cooling and bought as armour.
- **`mule-gunline` wants a rework, not a nudge.** At 8% it is the worst build in
  the roster, and the slide is explained rather than mysterious: F11 let its
  victims walk away and F15 took its decoy. Both changes were right. The build
  was standing on two accidents and now stands on neither.
- **Radiators are still region-locked.** A Bastion sponson radiator cools
  nothing unless the player plumbs a port with heat-transferring parts at both
  endpoints. That is the designed mechanic and it now has teeth, but no shipped
  template demonstrates it — all six orphans were relocated rather than plumbed,
  to keep mass and rank constant so the balance move stayed attributable. A
  template that teaches port plumbing is content work worth doing.
- **`RADIATOR_K` and `RADIATOR_CAP_KW` have never been tuned against a working
  channel.** Every value they hold was chosen while the channel delivered ~0, so
  6 kW per radiator is an inherited guess that now actually binds.

## `sim:breed` measures the search as well as the gear (added 1 Sep 2026, closed 2 Sep)

Four independent breaks each produced output indistinguishable from "dead gear",
and each was reported as a verdict before the next was found: the part was not in
the draw pool; completion could not finish it; placement order silently dropped
it; and the lock offered it without the capacitor it cannot fire without. docs/17
F16 is the record. All four now have tests.

**A single "dead gear" reading is not evidence about a part.** Before believing
one, check that a single copy of it — completed, from a lock containing what it
depends on, placed in any order — can score at all. The specific chain cannot
recur; the shape will, for the next part that depends on another part.

Once all four were fixed, dead gear collapsed from four parts to one (`U-RISE3`),
`W-SR` went 0 → 27 archive uses, `W-RG` 0 → 7, and the **long-range band filled
for the first time**. None of that was targeted; it is what happens when the
search can build what it draws.

This puts an asterisk on **F9**, which is what motivated cutting `W-SR` at all.
Its geometric half stands and is now demonstrated — every occupant of every long
cell carries `W-SR`, the gun cut to fit a light frame. Its "nobody wants the
railgun" half was the instrument.

## The Pinion scales on a frame it was not designed for (added 2 Sep 2026)

`W-SR` costs a Vulture an entire hardpoint, which is the whole of its design: one
arm, one gun, no second weapon. A Bastion has room for two or three and pays no
such price. Measured: `CH-9 rank 20 long/medium/cold` is a **two-Pinion Bastion
at 100%**, with a three-Pinion variant at 95%. I2 at rank 20 now reads CH-9 **72%
ahead of CH-2**, and CH-9's rank monotonicity got worse with it (rank 20 beats
rank 12 only 13%).

The constraint that gives the part its identity does not bind on the chassis it
was not designed for. Three answers, none taken:
- a per-build copy limit on the part (no such field exists for parts today —
  `maxCopiesPerBuild` is a modifier field);
- a placement restriction that only a hardpoint-shaped region satisfies, so big
  hulls cannot stack them;
- accept it, and let the Bastion be the frame that can field a battery.

Decide before the content pass authors more region-shaped parts, because the
question is general: **a part priced by the space it costs a small frame is
underpriced on a large one.**

## Still open after the 1 Sep decisions (added 1 Sep 2026)

- **I2 still fails.** The second defensive verb moved CH-9 a long way (F11) but
  parity spreads are 0.30–0.76 against a 0.08 threshold. What is left is not
  obviously the pilot any more, so the next investigation should not assume it is.
- **`mule-gunline` fell 39% → 16%** when the verb landed. It is a
  stand-and-shoot build whose victims can now leave. Whether it wants a rework or
  the verb wants tuning is a balance question and belongs in a balance pass.
- **`vulture-skirmisher` is over the 70% kill criterion**, replacing the two
  findings the verb closed. A fast frame with the lowest `moveJitterMult` in the
  game gains most from choosing its ground, which is not a surprise but is
  unbalanced.
- **The scout railgun scores 71% on a smell test.** `sim:try` is six seeds
  against seven templates. Do not treat that as a verdict; the breed sweep and
  the balance report decide whether the reshape overshot.
- **CH-9 at rank 8 is still partly broke** (34% after the verb, up from 19%).
  Better, not solved. The `chassisTier` spread question stands.

## Ammo stays a placeholder — on purpose (25 Aug 2026)

**No decision is being taken on ammunition for now.** `U-AMMO` remains in the
catalog and disabled: `ENABLED_PART_IDS` filters it out, `game:audit` fails if it
is ever enabled, `sim:diversity` reports it as a dead placeholder, and the mobile
gun chip shows no ammo count (there is no room for a fake number beside band and
arc at 390px).

The reason it is not urgent: the weapon classes are **already distinct enough**
without it. Declaring what each gun consumes to fire, and letting ballistic,
missile and chemical guns fire without the bus, separated them from energy and
cap-fed guns on power, heat and routing — the axes ammo was going to buy.

What stays live regardless: cook-off at 180°C, the `ammo-cookoff-risk` build
warning, and the `sacrificial-casing` modifier. What to watch: the dead-placeholder
finding will keep appearing in every diversity report, so read it as expected
output rather than a regression, and do not let a harness warning drive the design
call. The specced system is `01 §7`; the backlog entry is `07` Track C §1.

## The completer's reactor rule is worth 25 points on a heavy build (2 Sep 2026)

`assembleBuild` closes an energy gap with the smallest reactor that helps, one at
a time, and cannot upgrade to a bigger one when it runs out of cells. On
`CH-5 W-AV:3` that is the difference between 25% and 50% against the roster
(docs/17 **F21**) — it takes a 4-cell 25 kW `R-E25` with twenty cells free and a
9-cell 90 kW `R-C90` available.

Why it bites now rather than before: the demand is **locomotion**, not the guns.
`1.2 * massT * cruiseSpeed` means mass is the load, so the heavier the build the
harder the wall — and heavy builds are exactly the shape the archive has always
been missing. A dense part plus a greedy smallest-first reactor rule reads
identically to "the dense part is bad".

Not fixed deliberately: `sim:try` and the breeder share `assembleBuild`, so
changing the rule moves every score in every report. It wants to be its own
measured change with its own before/after, not a side effect of authoring a gun.

## `simContentHash()` depends on the compiler, not just the content (2 Sep 2026)

It hashes `m.apply.toString()`, and esbuild minifies and strips comments where
tsc does not — so the same catalog hashes `7c4c70e8` from source under tsx and
`29023729` from `dist`. Reports are all stamped under tsx and so agree with each
other; anything computed locally does not. Compare a report's stamp only against
another report's stamp (docs/17 **F20**).

Two sharper edges if anyone leans on it further: under tsc it is sensitive to
**comments inside a modifier's `apply` body**, and it does not include
`ModifierDef.tier` at all — so re-tiering a mod changes its draw weight, its
price and its rank cost while two reports either side of the edit still claim to
be comparable. Redesigning the fingerprint invalidates every stamp already
written, so it is recorded rather than changed.

## A content A/B on `sim:breed` is not currently possible (2 Sep 2026)

`MIDGAME_POOL.parts` is the draw domain, and `drawLock` consumes one `nextFloat`
per pick from a shrinking copy of it — so adding or removing a single id re-rolls
every lock at the same seed. Two runs either side of a new part are therefore two
different experiments, however carefully the seed, ranks, budget and workers are
matched, and the content hash will agree because `MIDGAME_POOL` is not in the
fingerprint.

This bit during the Anvil pass (docs/17 **F22**): `W-CB` read as 70 uses to 0,
which looks like a dominant new part deleting the carbine and was actually the
carbine never being offered. The part-usage half of that report was withdrawn.

The fix, when someone wants a real content A/B: keep the id in the pool for both
runs and gate it *after* the draw — filter it at genome construction — so the
locks are byte-identical and the only difference is whether the search may use
it. Until then, only **build-level** attribution is safe to quote: does the build
that fills the cell actually contain the part?

## `W-AV` is in 77 of 193 archive entries (2 Sep 2026)

The three-Anvil Mule reaches 98-99% at ranks 16 and 20, and the part appears in
40% of the archive. Recorded, not tuned — balance is its own track. It is the
same shape that made `W-SR` need a second pass, so it is the first thing to look
at when a balance pass next runs.

## Two dominant parts now crowd the archive (2 Sep 2026)

`W-AV` is in 77 of 193 archive entries, and the CH-5 three-`W-KL` build beats all
seven canonical templates on every seed (28/28). Both are recorded rather than
tuned, per the standing instruction — but the reason to look at them soon is not
fairness. A part that wins everywhere fills archive cells with itself, and the
archive is the instrument the next content pass measures against. Two of them is
a measurement problem before it is a balance problem.

For `W-KL` specifically the tradeoff is working and merely insufficient: peak
cell temperature reaches 125 °C against the 115 °C fire-hold, and its guns are
heat-gated up to 13.8% of ticks (docs/17 **F23**). The dial that matters is
therefore damage or cycle, not heat — raising the heat further just moves it
toward shutdown without changing who wins.
