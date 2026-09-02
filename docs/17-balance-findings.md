# 17 — Balance findings

Standing record of what is known to be wrong with balance, why, and what was
measured rather than assumed. **Balance is worked on as its own pass, separate
from feature development** — so none of the harnesses fail a build any more
(`--strict` restores the gate when you are deliberately balancing). What
replaces the gate is `artifacts/balance-report.md`, regenerated on demand and
diffed against a committed baseline, so a swing shows up in review instead of
turning a build red during unrelated work.

This file is hand-maintained. The generated report links here for causes.

---

## F1 — The four-band falloff reshape deleted both damage floors

**Status:** open. Cause identified, not fixed. This is the big one.

**Measured** 2026-08-18 by bisect, four points, same harness at each
(`balance.ts` and `harness.ts` unchanged since `553dd37`, so the comparison is
sound):

| point | r(budget, win) | bastion-tank | out-of-band | exit |
|---|---|---|---|---|
| `da6c47f` — before both suspects | −0.286 | 48% | 7 | **0, passed** |
| `bede033` — falloff + facing | −0.599 | 23% | 11 | 1 |
| `fe265c3` — collision + movement | −0.599 | 23% | 11 | 1 |
| `87ed5f3` — HEAD | −0.599 | 23% | 11 | 1 |

**All of it is `bede033`.** `fe265c3` moved nothing — not one point on any
build — despite an earlier note naming it as a co-cause; that attribution was
inspection, not measurement. Nothing since has moved balance either, including
the whole effect-system unification.

### What changed

`bede033` replaced `{rangeStart, rangeEnd, multAtEnd, rangeMin, multAtMin}`
with `{min, idealMin, idealMax, max}`. The critical detail is that
**`multAtEnd` was a floor, not an endpoint**: past `rangeEnd` a weapon kept
dealing that fraction at *any* range. `multAtMin` was the near-side equivalent.
The new curve goes to zero at both ends.

So every weapon lost a large share of its curve area (integrated 0–250 m):

| gun | retained | | gun | retained |
|---|---|---|---|---|
| W-RG | 62% | | W-SC | 43% |
| W-CB | 55% | | W-BR | 41% |
| W-AC | 53% | | W-MG | 41% |
| W-LAS / W-ION | 52% | | W-RKT | 38% |

Mean fight length went 60.5 s → 72.0 s. Judges decisions barely moved (26 → 27),
so fights still end decisively; they just take longer.

### What the data does *not* say

Two tempting explanations were tested and are too weak to carry the result:

- **Reach.** "Short-range builds lost" correlates at only **r = 0.45**.
  `vulture-skirmisher` reaches 180 m and still lost 20 points.
- **Retention.** "Whoever kept the most curve won" is better at **r = 0.52**,
  but `mule-skirmisher` has the joint-lowest retention and *gained* 8 points.

**No single factor explains the redistribution.** That matters practically:
there is no one-dial fix, and a straight revert would undo a curve redesign
that was presumably intended.

### Options, none chosen

1. Restore floors in the new four-band shape — a `minMult`/`maxMult` per weapon.
   Closest to the old behaviour without reverting the redesign.
2. Re-tune damage upward to compensate for the ~50% average area loss.
3. Accept the lower-damage curve as intended and re-tune the outliers only.

---

## F2 — Budget is anti-correlated with win rate

**Status:** open, and a consequence of F1 rather than an independent fault.

`r = −0.599`. `mule-gunline` wins 66% on a budget of 6; `bastion-tank` wins 23%
on a budget of 25. **The ladder generates opponents as `budget = f(node)`**, so
on this data a run gets *easier* as it progresses, which is backwards.

Worth re-measuring after any F1 fix before treating it as its own problem: the
baseline before `bede033` was −0.286, so the relationship was mildly negative
even when balance passed.

**A claimed corroboration was withdrawn.** On 29 Aug the first `sim:breed` sweep
appeared to find the same effect independently; on 31 Aug that turned out to be
its own measurement noise. See **F6**. F2 stands on its original evidence, and
is *not* currently corroborated by a second method.

---

## F3 — The autopilot's movement repertoire is narrow

**Status:** open, unquantified as a *cause*. Supporting observations only.

- Throttle is **86.4% cruise**, 11.4% flank, 2.2% stationary, over 167,926 ticks.
- Hulls touch in **1 fight per 200** — the autopilot holds its preferred standoff
  and essentially never closes to contact.
- Mechs are under 1.5 m/s **15.3%** of ticks, so builds and perks that reward
  standing still are not dead, but are rarely exercised.

This was *suspected* as the root cause of F1's damage before the bisect, and the
bisect does not support that — the regression is fully explained by the commit,
not by autopilot behaviour. Keep as a candidate for *why* short-range builds
cannot recover, not as the cause of the drop.

---

## F4 — Mechanical firing moved the archetype triangle

**Status:** noted, not chased. Feature work, recorded here so it is not
rediscovered as a mystery.

Making ballistic/missile/chemical weapons fire without the bus (`SIM_VERSION`
2.14.0) moved `tank-vs-sniper`:

```
                        before   after
fast sniper vs gunline    55%      58%
gunline     vs tank       82%      82%
tank        vs sniper     53%      43%   <- triangle no longer holds
full armor (16 plates)    53%      43%
8 plates removed          60%      45%
```

The rock-paper-scissors triangle wants every leg above 50%, and `tank vs
sniper` is now below it. Expected direction: ballistic builds no longer pay
reactor load, which frees budget for everyone carrying guns, and the sniper
benefits more than the tank does.

`GOLDEN` did **not** move, and that is not evidence of safety — its fight sheds
nothing in 1121 ticks, so it cannot observe a rule about brownouts at all. The
rule is pinned by `test/mechanicalFire.test.ts` instead, which builds the
shortage deliberately: on a 25 kW bus a machine gun fires 101 shots and a laser
0; swap in a 90 kW reactor and the machine gun fires the same 101 while the
laser goes to 4.

## F5 — Re-laying the stock builds for component height moved five of seven

Measured 2026-08-25 on `feat/component-height`, against the 2026-08-19
baseline. Nothing about a weapon curve changed; what changed is *where the
parts sit*. Every stock template in `templates.ts` was re-laid in `7ca70de`
so that no gun fires through its own hull, and `railgun-mule` lost a fourth
capacitor outright — after the re-lay there was no legal 2-cell run left for
it, so it is now a three-capacitor railgun.

| build | baseline | now | delta |
|---|---|---|---|
| mule-laser-boat | 42% | 71% | +29 |
| vulture-skirmisher | 47% | 71% | +24 |
| railgun-mule | 53% | 49% | -4 |
| mule-skirmisher | 45% | 47% | +2 |
| bastion-tank | 23% | 16% | -7 |
| vulture-sniper | 74% | 57% | -17 |
| mule-gunline | 66% | 39% | -27 |

The two things worth noticing:

- **The swing is not where the content loss is.** `railgun-mule` is the build
  that actually lost a part and it moved -4, inside the noise band for 20
  seeds. `mule-gunline` kept every part it had and moved -27. So this is a
  *geometry* effect — exposure, arcs, which cells are exterior, what sits in
  front of what — not a budget effect.
- **The correlation got slightly worse** (-0.586 → -0.637). F2 is unchanged
  as a finding; height did not cause it and did not fix it.

**Re-baselined 26 Aug 2026**, deliberately, as the closing step of the
decisions pass before content generation. The reasoning: the reference was the
19 Aug cut, so every future diff would have mixed height's swing with whatever
new content did, and the diff is the only instrument that makes a swing visible
in review. The swing above is therefore now *baked into* the reference — it is
not fixed, and this table stays as the record of what moved. F1 is untouched and
still open.

The re-cut moved nothing else: correlation is -0.637 either side of it, and the
regenerated report reads "None. Every build is within noise of the reference"
because the reference is now the same measurement.

## F6 — RETRACTED. The declining ceiling curve was measurement noise

**Status: withdrawn 31 Aug 2026, one day after it was filed.** The claim was
wrong and the fault was in the instrument, not the content. It is kept here
rather than deleted because the way it failed is the useful part.

**What it claimed.** That the best win rate found at each rank peaked at 10 and
declined to 18 on all three chassis — CH-2 86→81, CH-5 100→95, CH-9 71→57 — and
that this corroborated F2 by an independent method.

**Why it was wrong.** `sim:breed`'s confirm pass called
`confirmFitness(build, result.rank, …)`, passing the **rank** as the battle
seed. So the same build measured at two ranks was measured on two different
sets of battles. In the sweep's own data, lock 0's CH-9 elite at rank 10 and at
rank 18 are *the identical build* — `1xR-C40 5xW-MG` — and they were recorded at
43% and 66%. Nothing about the mech changed. Only the seed did.

That breaks the project's own rule, the one `screenFitness` follows and has a
test for: a seed must derive from the candidate, never from where it was found.

**How big the noise was.** The same build, measured at four seeds:

| Build | confirm-seeds 3 | confirm-seeds 8 |
|---|---|---|
| CH-9, 5x W-MG | 29 / 48 / 33 / 33% — **19 pts** | 27 / 36 / 32 / 29% — 9 pts |
| CH-5, 6x W-MG | 71 / 76 / 81 / 57% — **24 pts** | 71 / 77 / 79 / 68% — 11 pts |
| CH-2, 3x W-MG | 86 / 86 / 81 / 81% — 5 pts | 77 / 86 / 75 / 79% — 11 pts |

Every decline F6 reported — 5, 5 and 14 points — is **smaller than the noise of
the measurement that produced it.** Seven opponents at three seeds is 21
battles, and 21 battles cannot resolve a 5-point difference.

**What survives.** Nothing about the rank curve. The rest of the sweep's
findings do not depend on cross-rank comparison and stand until re-measured:
`W-RG` was offered and never wanted; eleven of eighteen archive cells were never
filled, with no long-ranged build anywhere; I2's chassis spread at rank 6 was 81
points, which is an order of magnitude clear of the noise band. **F2 is
therefore not corroborated** — it stands on its original evidence alone, and the
sentence added to it on 29 Aug has been withdrawn.

**What changed as a result.**

1. `confirmFitness` derives its seed by hashing the build, so an identical build
   measures identically wherever it appears. Cross-rank comparison of the same
   mech is now exact rather than noisy.
2. Confirm seeds are no longer a number chosen for speed.
3. **The report prints its own noise band**, because a table of percentages with
   no error term is what made this mistake writable. A difference smaller than
   the band is not a finding.

**The lesson worth keeping.** The tool was built specifically to stop content
being authored against a wrong reference, and its first output was a wrong
reference stated with a table and three decimal places of confidence. The
instrument's own precision has to be measured before its readings are quoted —
and "the same input twice" is the cheapest check that exists.

## F7 — Rank works. Chassis parity does not, and the Mule is the outlier

**Status:** open. Measured 31 Aug 2026 by `sim:breed`, 2 locks x 3 chassis x
ranks 8/12/16/20, budget 120, 40 confirm seeds, **noise band +/-6 points**,
content hash `ee3d4f83`. This is the run that replaces the retracted F6, on a
fixed instrument.

**Rank buys strength, then saturates. It does not invert.** Best win rate found:

| Chassis | rank 8 | 12 | 16 | 20 |
|---|---|---|---|---|
| CH-2 | 55% | 83% | 83% | 83% |
| CH-5 | 84% | 90% | 97% | 97% |
| CH-9 | 19% | 64% | 64% | 70% |

Every rise is far outside the band; every plateau is flat within it. **There is
no declining curve** — that was F6's artefact. The question `docs/19` asked of
Sigma-tiers is answered for now: rank means something.

**I1: 17/21, with 9 pairs excluded as mirror matches.** All four real failures
are on CH-5, which is also the chassis that saturates highest — a frame that is
already at 97% has no room left to demonstrate monotonicity, so these are
close to a ceiling effect.

**I2: 0/8, and this is the finding.** CH-5 is **65-70 points** ahead of CH-2 at
every rank, and 56-61 ahead of CH-9. That is ten times the noise band, and it
held under every rank tested. The ordering is **CH-5 >> CH-2 > CH-9**: the Mule
dominates, and the *largest* frame is the worst.

Charging the frame for its capacity (`chassisTier` 1/2/4, 31 Aug) did not fix
this and made CH-9 worse at low rank — a "rank 8 Bastion" is 4 tiers of parts in
a 56-cell hull, and it measures 19%. Capacity is evidently not what the Mule is
winning on.

**The hypothesis worth testing first is that this measures the pilot, not the
chassis.** The autopilot generates evasion by orbiting at `strafe` speed, and
strafe is 6.0 / 4.0 / 1.5 m/s across CH-2 / CH-5 / CH-9. The Bastion physically
cannot produce lead error, so it is hit by everything. That is `F3` — the
narrow movement repertoire — showing up as a chassis-balance result. If it is
the cause, I2 is currently unmeasurable rather than failing, because the sweep
is explicitly a test of correct *building* and this would be a fact about
*flying*.

**I3:** of 19 offered ids, `W-RG` was never wanted by any elite — the tier-4
railgun, the dearest weapon in the game — nor were `tidecooler`, `coil-sprung`
or `gyro-flywheel`. **No long-ranged build appeared anywhere**, on any chassis
at any rank, which is the same fact from the other side.

**k = 4** on all three chassis: a best-built rank-8 mech falls to a coin flip
against a best-built rank-12 one. Usable for `ladderBudgetPerNode` now that the
curve it sits on is sound, with the standing caveat that both sides are flown by
the same autopilot.

## F8 — I2 was partly measuring the pilot. Raising the Bastion's strafe moved it 35 points

F7 flagged the hypothesis; this is the test. The Bastion's `strafe` was raised
1.5 -> 4.0 m/s locally, nothing else touched, and the parity slice re-run.
The unmodified slice was run first as the control, because the ladder seeds each
rank from the previous one — dropping rank 12 makes rank 16 incomparable to the
full sweep, so the baseline report is *not* the control. Rank 8 reproduced the
baseline exactly, which is what makes the rank-16 comparison trustworthy.

| cell | control | strafe 4.0 | delta (best of 2 locks) |
|---|---|---|---|
| CH-2 @ 8 | 55/14 | 53/14 | −3 |
| CH-2 @ 16 | 83/16 | 80/14 | −2 |
| CH-5 @ 8 | 26/84 | 7/86 | +2 |
| CH-5 @ 16 | 76/88 | 59/99 | +10 |
| CH-9 @ 8 | 19/19 | 18/14 | −1 |
| **CH-9 @ 16** | **44/61** | **59/97** | **+35** |

Noise band ±6. Lock-0 parity spread at rank 16 fell 0.393 -> 0.218 and CH-9
stopped being the worst chassis. CH-2 — unchanged, and facing a *stronger*
bastion-tank in the panel — moved −2, so the effect is specific to the chassis
whose stat moved.

Two things this does **not** say. It is not a licence to give the Bastion a
Mule's legs: lateral speed is what the assault biped trades away for armour, and
erasing that erases the chassis. And it does not clear rank 8, where CH-9 did not
move at all (19 -> 18) — at rank 8 the frame is 4 of the 8 points, so the Bastion
is broke before it is slow. That is D3's known cost, not this.

The reading: the autopilot has exactly one evasion verb, orbiting at `strafe`
(F3). A chassis that cannot orbit therefore has no defensive play at all, so I2
charges the Bastion for a gap in the *pilot*. The same probe was already run on
CH-2 in Aug 2026 for the same reason and is written into `chassis.ts` beside its
speeds. The fix belongs in the movement repertoire, not the stat block.

## F9 — The long-range playstyle is structurally impossible, and W-RG is its casualty

The sweep found no long-ranged build in any archive cell. It is not a search
failure — the band cannot be occupied. Three facts close the chain:

1. **Only one gun reaches.** Effective dps (raw × falloff) at 120 m: W-RG 12.8,
   every other weapon ≤ 6.7; at 160 m W-RG 8.5 against W-CB's 2.2. So the railgun
   is not underpowered at long range, it *dominates* it. Note also that every
   weapon's ideal band tops out at 80 m, while the archive's long bucket starts
   at 100 m — no gun is authored to be *best* at long range.
2. **Nobody can hold the range.** Every chassis's reverse speed is below every
   chassis's forward speed except one pair. Eight of the nine matchups close, at
   1.0 to 7.8 m/s. Kiting is not a weak tactic here; it is unavailable.
3. **The one chassis that can hold range cannot carry the gun.** The single
   holding matchup is a Vulture backing away from a Bastion (rev 4.5 vs fwd 4.0),
   and `sim:try -- CH-2 W-RG:1` answers `asked for 1, fitted 0 — no legal cell`.

So W-RG is dead by geometry, not by tuning, and buffing its numbers cannot revive
it. Any fix is a design change — a rev-speed pass, a terrain/LOS verb for the
autopilot, or a lighter long gun a scout can mount — and belongs in a decision,
not a balance nudge.

## F10 — Two of the three dead mods are gated behind a part nobody fits; the third is inert below 115 °C

Diagnosed rather than buffed, per the standing rule that a part which never wins
may be unreachable rather than weak.

**`coil-sprung` and `gyro-flywheel` require a `U-ACT` Stride, and no canonical
template fits one.** Nor do `hull-down` or `weaving-gait`, which share the
requirement. Wanting one of these mods is therefore two decisions, not one: fit a
2-cell, 4 kW part that buys a capped 15% translation-speed boost — which the
overlap audit already calls a marginal deal on its own — and *then* mod it. The
mods are not weak; the doorway is.

**`tidecooler` fires often and is worth exactly nothing.** The explanation
below is *incomplete* — see **F13**, which found the real cause after the heat
gradient failed to revive it. Measured, not assumed:
across 280 panel battles its carrier stood in water for 23,895 radiator ticks
(10.1% of the fight), and the win rate was bit-identical to the last digit. The
cause is that temperature only reaches an outcome through a threshold — fire-hold
at 115 °C, shutdown at 130 — and the carrier peaks at 80.4 °C. Below 115 °C,
cooling is inert, so doubling a radiator on a build that never redlines is
worthless by construction. This generalises: it is the same fact that makes
`mule-fever-cycle`, a deliberate redliner, the dominant build. Cooling is only
worth rank to a build that spends heat.

**`gyrostabilized` is not dead, it is narrow.** Paired-seed A/B, 40 seeds ×
7 opponents, same seed set both arms: vulture-sniper +4.3, mule-laser-boat +1.4,
mule-skirmisher 0.0, bastion-tank −0.4, vulture-skirmisher −1.1, mule-gunline
−2.1, railgun-mule −9.3. It buys down motion jitter, which is 40–60% of total
dispersion for a precise gun and 4–18% for a brawler gun, and pays 15% weapon
mass — which is why it is worst on the heaviest gun in the game. It costs +3 rank
for at best +4 points, and that is the reason it is not chosen.

A note on method: the first A/B run was wrong. It stapled actuator-only mods to
weapons, and three mods returned exactly +0.0 because `appliesTo` silently
declined them. "No effect" is what a mod that was never attached looks like, so
check legality before reading a zero.

## F11 — The autopilot got a second defensive verb, and it moved I2 further than the strafe hack did

F8 identified the cause; this is the fix, and it changes the pilot rather than
any chassis stat. Three changes to `autopilotController`, each measured:

1. **The ground search reaches 60 m instead of 20 m** (`GROUND_SEARCH_CELLS`,
   eight compass bearings × three rings). At one tile it could only pick up cover
   a mech was already standing beside — useful to a Vulture, useless to anything
   slow.
2. **The trip is priced instead of gated on a flat +0.5.** `gain × horizon`
   against `what transit costs × how long transit takes`, so the same exchange
   arithmetic that picks the range picks the walk. Facing is held throughout;
   guns bear the whole way.
3. **A mech that cannot finish a charge stops making it.** The gap closes at my
   forward speed minus the enemy's reverse speed, both read from the sim. If that
   will not cover the distance inside the horizon, take the best ground at the
   range being imposed instead of crossing open ground forever.

Change 3 is the one that mattered, and it was found by measurement, not design:
the Bastion spent **99.4% of every fight with intent `close`**, mean range 43.6 m,
median 35 m still to walk, and never arrived. Its ideal range is ~10 m and the
faster mech simply would not allow it. Changes 1 and 2 alone were worth almost
nothing to CH-9 because they live in a branch that only runs once a mech is
*inside* its band — which the Bastion never was.

Against the F8 control, same locks, budget, seed and workers:

| cell | control | strafe 4.0 (F8) | second verb |
|---|---|---|---|
| CH-2 @ 8 | 55/14 | 53/14 | 59/15 (+4) |
| CH-2 @ 16 | 83/16 | 80/14 | 80/14 (−3) |
| CH-5 @ 8 | 26/84 | 7/86 | 24/66 (−17) |
| CH-5 @ 16 | 76/88 | 59/99 | 96/90 (+8) |
| **CH-9 @ 8** | **19/19** | 18/14 | **34/17 (+15)** |
| **CH-9 @ 16** | **44/61** | 59/97 | **67/88 (+26)** |

Note rank 8: the strafe hack could not move it at all (19 → 18) because a rank-8
Bastion is broke, not slow. The verb moved it +15 anyway, because cover costs no
rank. Lock-0 parity spread fell 0.393 → 0.296 at rank 16 and 0.700 → 0.511 at
rank 8 on lock 1, and CH-9 stopped being the worst chassis. **I2 still fails** —
spreads are 0.30–0.76 against a 0.08 threshold — which is what F8 predicted when
it said I2 was *partly* the pilot.

**Two long-standing report-only findings closed on their own.** `sim:diversity`
now reports `Dead perks: none` and `dominant perk combinations: none`;
`gyrostabilized` and `mule-fever-cycle` had both been standing findings since
August. Neither was targeted. Gyro stops being dead once holding ground is a real
option, and the fever redliner stops being dominant once its victims can take
cover.

**What it cost.** Across the template matrix, shots per side fell 147.2 → 133.6
with **zero silent sides** on either side of the change — mechs in cover fire
less, which is the trade being bought, not the silent-mech failure. The first cut
of change 3 *did* produce 5 silent sides, by letting a mech give up a charge from
outside its own weapon reach; it is now gated on `range <= maxReachM`, because
standing off where you cannot shoot is declining the fight, which is exactly what
the deleted `flee` branch used to do. `game:balance -- 4` reads 0.897 / 0.500 /
0.444 at rounds 1 / 4 / 7 — all three inside D2's bands. A new finding replaces
the two that closed: `vulture-skirmisher` is now over the 70% kill criterion,
which is unsurprising, since a fast frame with the game's lowest `moveJitterMult`
gains most from being able to choose its ground.

**The balance report moved more than anything since the port.** Six swings of
5+ points against the 26 Aug baseline, and they are the shape the verb predicts:

| build | baseline | now | delta |
|---|---|---|---|
| bastion-tank | 16% | 41% | **+25** |
| vulture-skirmisher | 71% | 78% | +7 |
| mule-skirmisher | 47% | 54% | +7 |
| vulture-sniper | 57% | 49% | −8 |
| mule-laser-boat | 71% | 63% | −8 |
| mule-gunline | 39% | 16% | **−23** |

The Bastion goes from the worst template in the game to mid-pack without one
number changing on the chassis. **F2 moves too**: budget-vs-win-rate correlation
is −0.145, against −0.637 at the baseline — most of "budget is anti-correlated
with win rate" was heavy builds being unable to fly themselves. The baseline was
**not** re-cut; the swing is meant to be visible.

`mule-gunline` at −23 is the bill and should not be waved through. It is a
stand-and-shoot build whose victims can now leave, and it is the template the
golden battle happens to use. Whether it wants a rework or the verb wants
tuning is a balance question, and balance is its own pass.

`SIM_VERSION` is 2.16.0 and the golden battle was re-pinned deliberately. The
reposition dials are now inside `simContentHash()`, which they should always have
been — a sweep run before and after a horizon change must not claim to be
comparable.

## F12 — Heat, the Stride doorway and the railgun's footprint, settled

Three decisions taken together, each measured on its own.

**Heat now costs something below the threshold.** `heatDispersionMult` widens a
gun's own cone from ×1.0 at ambient to ×1.5 at the 115 °C fire-hold, applied
inside `weaponSigmaMrad` so planning, shot resolution and the HUD cannot
disagree about the same shot — the mistake `BattleDiagnostics` already carries
two comments about. It bites where it was supposed to: across the template
matrix **47% of weapon-frames run above 45 °C**, at ×1.16 to ×1.47, and every
one of those was ×1.00 before. Shots per side and silent sides are unchanged
(134.0, zero), so this bought a gradient without buying a regression.

The motion term is deliberately untouched. A hot barrel is the gun's problem;
jitter is the frame's.

**The Stride doorway is open.** `coil-sprung`, `gyro-flywheel`, `hull-down` and
`weaving-gait` moved from `U-ACT` to any structural or utility fitting: legal
carriers per template went **0/7 to 7/7**. All four already write to mech-scope
channels, so the part they hang on was only ever a mounting point. `marsh-pistons`
stays on the Stride — its effect *is* locomotion through terrain and its tradeoff
names the fitting. Blurbs that said "servo mass" now say "carrier mass", because
they no longer know what they are bolted to.

**W-RG went from 2×5/1400 kg to 1×4/950 kg.** A Vulture's regions are a 1-wide
spine of four cells with a 2×2 bulge, so a 2-wide gun was not a tight fit there
but an impossible one, at any budget (F9). A 1×4 column fits that spine exactly.
The commitment did not go away, it moved off the cell budget: 950 kg is a third
of a 3.0 t rating, and 220 kJ a shot still demands a reactor and capacitors the
frame must also find room for.

The build the reshape exists for now exists. `sim:try -- CH-2 W-RG:1 R-C40:1
P-CAP:2 --no-armour` is a tier-10, 2.40 t Vulture that fits nothing but the gun,
its reactor and its caps, and scores **71%** against the canonical roster —
100% against `mule-gunline`, `vulture-sniper` and `bastion-tank`, 17% against
`mule-skirmisher`. It cannot sustain fire (−23.3 kW, ~5 s of capacitor) and runs
−11.0 kW on heat. That is the shape that was asked for: a light mech built only
to fire one gun, which beats what it out-ranges and dies to whatever reaches it.
`sim:try` is a smell test, not a verdict — six seeds against seven templates.

**What the instruments say after all three.** A 2-lock slice at ranks 8 and 16
(a slice, not the full sweep — read it as indicative):

- **I2 passes for the first time.** 1 of 4 cells, and the passing one is rank 16
  lock 0 at spread **0.043** against a 0.08 threshold. Every previous sweep was
  0 of 8 with spreads of 0.36–0.72. Rank 8 lock 1 is 0.086, a whisker outside.
- **W-RG is no longer dead gear.** It appears in the archive's part counts for
  the first time; the reshape did what F9 said was needed.
- CH-9 @ 16 reads 77, against 44 in the F8 control — the best figure the Bastion
  has recorded.
- I1 holds 5/6.
- `tidecooler` is still dead, which F13 explains and no heat model can fix.
  `coil-sprung` and `gyro-flywheel` are still listed dead, but on two locks that
  is weak evidence — the doorway only just opened.

The balance report settles to **three** swings against the 26 Aug baseline, down
from six after the verb alone: `bastion-tank` 16% → 43% (+27), `mule-gunline`
39% → 12% (−27), `vulture-sniper` 57% → 48% (−9). The gunline is the bill for
all of this and it is getting worse, not better; it is on the watchlist.

## F13 — The radiator does not radiate, and no radiator mod can ever matter

> **Superseded in scope by F14.** F13 is correct about `U-RAD` and about the
> `radiator` channel being inert. F14 measured the rest of the model and found
> the radiator is not the problem — there is no cooling model to speak of at
> all. Read F14 before acting on this.

Found by the heat gradient failing to do what it should have. With heat finally
carrying a continuous cost, `tidecooler` was still worth **exactly +0.0** on all
four of its carriers. So the water condition was never the problem.

The test that settled it: drop the condition entirely and give the carrier a
**permanent** radiator ×2. `mule-laser-boat` 62.1% → 62.1%. `mule-gunline`
20.0% → 20.0%. A radiator-scaling mod cannot move anything, ever, under any
heat model.

The cause, instrumented over 7,613 radiator ticks:

- the radiator's **own cells sit at 25.87 °C**, against a 25 °C ambient (max 29.03);
- its throughput averages **0.0755**, and is **exactly zero on 48.6% of ticks**;
- meanwhile the guns feeding it average 49.2 °C and peak at 83.5 °C.

Radiation is priced on the radiator's own cell temperature — `RADIATOR_K ×
radMult × (T − AMBIENT)` — and conduction from the hot cells to a perimeter
part never raises it above ambient. So the term is ~0, and scaling ~0 by two is
~0. **U-RAD is a heat pipe wearing a radiator's name**: removing it does raise
peak temperature (80.4 → 91.3 °C), but that is its `thermalConductance: 2`
doing the work, not its radiative area.

This is why F10's account of `tidecooler` was incomplete, and F10 now says so.

No fix is taken here. Making a radiator radiate — pricing it on the cells it is
connected to rather than on itself, or raising conduction so heat can actually
reach it — is a change to the thermal model, and the thermal model was not one
of the decisions on the table. It is on the watchlist as a decision, not a bug
to quietly patch, because every cooling part and every cooling mod in the
content pass depends on which answer is chosen.

## F14 — The heat model has no cooling. It has thermal mass, and a readout that names the wrong part

F13 said the radiator does not radiate. It is worse than that, and the shape of
the problem is not the radiator.

**Method.** Every number below is from the sim, not from reading it. The
constants were swung in the build artifact so the builds, seeds and fights stay
bit-identical and only the thermal channel moves; then the integrator was
instrumented to count kJ per channel, and the energy books were closed to prove
nothing was being lost off-ledger. They close to **-0 kJ** on every template, so
this is an accounting of a conservative model, not a hunt for a leak.

### 1. The radiator channel is not weak. It is inert.

Swinging `RADIATOR_K` across **zero to ten times** its authored value moves peak
temperature by at most **0.0003 °C**, and on three of five templates the fights
come out bit-identical. Zeroing `EXTERIOR_PASSIVE_K` — the one-line fallback
that gives every exposed cell 0.01 kW/°C for free — moves the same peaks by
**+14 to +24 °C**.

| | peak with the channel | peak without it |
|---|---|---|
| radiators (`RADIATOR_K` 0.06 → 0) | 72.44 °C | 72.44 °C |
| passive skin (`EXTERIOR_PASSIVE_K` 0.01 → 0) | 72.44 °C | 90.78 °C |

Two independent causes, both real:

- **Topology.** Conduction edges require the same region and Manhattan distance
  ≤ 1. Of the four canonical templates carrying a radiator, `mule-gunline` and
  `bastion-tank` have **0% of their heat able to reach it at all** — the
  radiator is in a different connected component from every heat source.
  `railgun-mule` reaches 45%, `mule-laser-boat` 100%.
- **Magnitude.** Even at 100% reachability the channel delivers ~0.1 kW,
  because radiation is priced on the radiator's *own* temperature and the only
  thing that warms it is a 0.06 kW/°C conduction edge. `RADIATOR_CAP_KW = 6`
  needs a 100 °C drop across a single cell boundary to bind. It never binds, so
  the cap is roughly 100× the achievable flux and the authored value is
  decorative.

### 2. Only a fifth of all heat is ever shed. The rest is stored.

Over 8 fights per template, kJ:

| template | deposited | shed passively | shed by radiators | stored |
|---|---|---|---|---|
| `mule-gunline` | 5383 | 855 (16%) | 0.00 | 4738 |
| `mule-laser-boat` | 5458 | 944 (17%) | 37.42 (0.7%) | 4692 |
| `railgun-mule` | 5433 | 1168 (21%) | 173.96 (3.2%) | 3735 |
| `bastion-tank` | 6194 | 882 (14%) | 0.00 | 5513 |

**Temperature in this game is governed by thermal mass, not by cooling.** That
is why the only dial that ever moved the thermal band was `thermalMassPerCell`
(1.0 → 0.7, Aug 2026, recorded in `thermal.ts`), why a heat sink works and a
radiator does not, and why `tidecooler` is inert. Nobody chose this; it is what
the numbers add up to.

### 3. The readout tells the player the opposite of the truth

`computeHeatBalance` credits `RADIATOR_CAP_KW` per `U-RAD` and nothing else. Its
own comment calls this "an honest capacity number for a gauge". Measured against
what the sim delivers:

| template | readout says | radiators deliver | skin delivers |
|---|---|---|---|
| `mule-gunline` | 6.0 kW | 0.000 kW | 2.03 kW |
| `mule-laser-boat` | 6.0 kW | 0.100 kW | 2.52 kW |
| `railgun-mule` | 6.0 kW | 0.357 kW | 2.40 kW |
| `bastion-tank` | 12.0 kW | 0.000 kW | 2.22 kW |
| `vulture-skirmisher` | 0.0 kW | — | 1.70 kW |

The gauge is not imprecise, it is **anti-correlated**: it credits 6 kW to the
part that does nothing and 0 kW to the exposure that does everything. A player
optimising the number they are shown fits radiators and buries hot parts inside
the hull, which is exactly backwards. It also explains why builds the workshop
condemns at "-9.0 kW heat margin" run all fight at 47 °C without trouble.

`auditPartDifferentiation()` carries the same claim — *"U-HS vs U-RAD: 1-cell
burst thermal mass vs 3-cell perimeter-only sustained dissipation"* — and the
second half of it is false.

### 4. Two defects in the radiator loop, currently invisible

Found by reading, and stated here so they are fixed with whatever fix lands
rather than rediscovered. Neither is measurable today because the channel
delivers ~0.

- `command.radiatorMult` is applied **twice** — once inside `raw` and again
  inside `ramAir` — so standing in water is 1.6² = 2.56×, not 1.6×.
- `ramAir` multiplies again **after** the cap is applied, so when the cap binds
  the delivered total is `RADIATOR_CAP_KW × ramAir`, which exceeds the cap by
  up to 1.5×. A cap that can be exceeded is not a cap.

### What is not decided here

Whether cooling *should* matter is a design question and it is the owner's.
Making the radiator work, and making the gauge honest, are different changes
and the second depends on the first. Both are on the watchlist. Nothing in the
thermal model was changed by this investigation.

## Non-findings, recorded so they are not re-investigated

- **`sim:diversity` is green.** Its only failure was a mismeasurement: the
  harness tested hull-down at 0.5 m/s where the perk fires at 1.5, reporting 2%
  activation instead of 37% and listing a live perk in `deadPerks`. Fixed by
  declaring `ModifierDef.isActive` beside `apply`. Do not cite diversity output
  from before 2026-08-18 as evidence of a balance problem.
- **Body collision (`fe265c3`) is innocent.** Measured, not assumed.
