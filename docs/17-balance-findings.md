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

## F15 — Radiators now radiate, and the first thing that taught us is that an orphaned one was a decoy

F14 measured the model and left the decision open. The decision taken was **make
cooling real**, and this is what shipped and what it cost.

### The change

A radiator sheds heat from **every cell in its own conduction component**,
weighted by how far above ambient each is, still capped at `RADIATOR_CAP_KW`. It
used to price only its own cells, which conduction never warmed. Two defects
went with it: `command.radiatorMult` was applied twice (water was 1.6² = 2.56×)
and `ramAir` multiplied again after the cap, so the cap could be exceeded by up
to 1.5×. Both now fold into one `gain`, applied once.

The spatial game is sharpened rather than removed. A radiator with no path to
anything hot still does exactly nothing — but that is now a *legible* build
error: `computeHeatBalance` returns `orphanedRadiatorIds`, the workshop bar says
"1 Gill cooling nothing", and `computeHeatAdvice` raises `radiator-orphaned`
with the fix in it.

Measured on `mule-laser-boat`: **0.10 → 3.73 kW**, peak 72.4 → 62.0 °C, and
removing the radiator now costs **+11.4 °C** where it used to cost nothing.
`tidecooler` went from provably inert — bit-identical results under *any*
radiator strength — to a measurable −0.29 °C mean. It is still a small mod,
because it only fires in water and mechs stand in water 8.1% of the time, but
its channel is no longer dead on arrival.

### The gauge, which was the larger error

`computeHeatBalance` credited 6 kW per radiator and 0 kW for skin exposure, while
delivering 0.00–0.36 and 1.70–2.52 respectively. It now quotes **cooling at the
fire-hold threshold**, split into skin and radiators, which makes it a claim the
player can act on: if `heatInKw < coolingKw`, this build can never be forced to
stop firing. The reference is not decoration — `mule-skirmisher` reads 9.0 kW in
against 9.0 kW out and measures a peak of **115.5 °C**, which is the fire-hold
it is referenced to. The gauge now predicts the sim instead of contradicting it.

### Six shipped templates had a radiator plumbed to nothing

`mule-gunline`, `bastion-tank` (both), `probe-bastion-casemate`,
`probe-bastion-thermal` (both) and `bastion-hull-down`. The pattern is the
Bastion: sponsons are separate conduction regions with plenty of perimeter and
no heat sources, so that is where radiators went. All six were relocated rather
than plumbed, because relocation keeps mass and rank identical and so keeps the
balance move attributable.

### And relocating one made the build worse, for a reason worth keeping

`mule-gunline`'s radiator, moved from the left shoulder into the body:

| | peak | win rate | fight length | shots fired | integrity left | radiator destroyed |
|---|---|---|---|---|---|---|
| shoulder (orphaned) | 75.7 °C | 22.9% | 73.2 s | 75 | 21.6% | **90%** |
| body (connected) | 33.4 °C | 15.4% | 61.9 s | 66 | 39.0% | **3%** |

Cooling worked exactly as intended — 42 °C of it — and the build got *worse*.
The orphaned radiator was never cooling anything; it was **a decoy**. A cheap
25 HP part in an outlying region draws fire that cannot threaten the core, and
it bought the gunline eleven seconds and nine extra shots, which is worth more
to it than any amount of cooling because a mechanically-fired autocannon does
not care about heat until the 115 °C fire-hold it never reached.

Two things follow, and neither is a reason to undo the change:

- **Region-outlying cheap parts are armour.** Nobody designed that; it falls out
  of regions plus per-part hit allocation. It is worth knowing before the
  content pass authors more cheap utility parts, and it may be why several
  templates look the way they do.
- **`mule-gunline` needs a rework, not a nudge.** It is now the worst build in
  the roster at 8%, and the slide is cumulative and explained: the second
  defensive verb let its victims leave (F11), and the radiator fix took its
  decoy. Both changes were right; the build was standing on two accidents.

Balance is its own pass and does not gate this, so nothing was tuned to make the
number go back up. The baseline was **not** re-cut. Correlation of budget against
win rate improved −0.637 → **−0.043**.

## F16 — "Dead gear" and "gear the search cannot reach" are opposite findings, and I3 could not tell them apart

Two separate versions of this bit in one sitting, both while trying to answer a
simple question: is the new `W-SR` dead or dominant?

### First: never offered reads exactly like never wanted

The first full sweep reported `W-SR` in **0 of 494** gallery entries. That is what
dead gear looks like. It was the opposite: `MIDGAME_POOL` is a hand-written list
and the gun was not on it, so no lock could draw it. The report did say so — I3
prints "never offered by any lock" separately — but a part that was never offered
is invisible in the gallery and absent from the coverage table, so the two states
look identical everywhere a reader actually looks.

`breedingPool.test.ts` now fails if any enabled weapon, reactor or capacitor
cannot be drawn. Every other part in the catalog already passed, so the fence is
around exactly the hole this fell through.

### Then: the whole capacitor-fed weapon class was unreachable

With the gun properly offered, the sweep called it dead gear — along with `W-RG`.
Cross-referencing the archive against how each weapon is fed separates perfectly,
and not by tier:

| weapon | fed by | tier | archive uses |
|---|---|---|---|
| `W-CB` | mechanical | 3 | 86 |
| `W-LAS` | charged | 2 | 78 |
| `W-MG` | mechanical | 1 | 65 |
| `W-AC` | mechanical | 2 | 48 |
| `W-SC` | mechanical | 3 | 39 |
| `W-BR` | mechanical | 3 | 38 |
| `W-ION` | charged | 3 | 25 |
| **`W-RG`** | **capacitor-fed** | 4 | **0** |
| **`W-SR`** | **capacitor-fed** | 4 | **0** |

A tier-3 mechanical gun is the most-used weapon in the archive, so this is not
"expensive gear is bad". It is a **fitness valley**, and it measures exactly:

| build | fitness |
|---|---|
| `W-SR` alone | **0%** |
| `W-SR` + reactor | **0%** |
| `W-SR` + capacitor | 11% |
| `W-SR` + reactor + capacitor | **33%** |
| `W-RG` alone | **0%** |
| `W-RG` + reactor + big bank | **44%** |

Every single-part step toward a capacitor-fed gun is a loss. A hill-climbing
search starts at zero, sees no gradient, and never arrives — so the archive's
verdict was about **reachability**, not about the guns.

### The cause was a gap in the completer, not a property of the guns

`assembleBuild` closes gaps that `computeEnergyMargin` and `computeHeatBalance`
measure, and its header claims `validateBuild` too. It only ever added reactors
and radiators. `cap-starved-weapon` — *"capacitor-fed but its network has no
capacitors — it can never fire"* — was the one measured fault it ignored, so it
handed back a gun that could not shoot, and 0% was an honest score for it.

Completion now adds capacitors until the bank covers the largest single shot.
Banks accumulate, so it takes the largest that **fits** and loops, rather than
demanding one part cover the whole shot: the first cut asked for 260 kJ, found
only a 200 kJ Reservoir, could not fit its four cells beside a gun that eats a
whole arm, and gave up with five free cells and a two-cell Jolt available.

Both guns now assemble legally on every chassis: CH-9 79–82%, CH-5 13%, CH-2 11%.
The Vulture stays low because it has room for exactly one small bank and cannot
sustain fire — a real property of the frame, not a search artefact.

### Then two more links, found the same way

The completer fix rescued `W-RG` (0 → 4 archive uses) and left `W-SR` at zero,
which looked like a verdict on the gun. It was not. Two more independent breaks
sat behind it, each producing output identical to "dead gear":

- **Placement order.** `W-SR` has exactly two legal placements on a Vulture, so
  one capacitor dropped in the arm first makes it unplaceable — it fits when
  listed first or second in a wish and vanishes when listed last. Genomes carry
  parts in arbitrary order, so most genomes containing the gun silently lost it.
  `assembleBuild` now places the biggest footprint first, which is the principle
  its own reactor seeding already stated and had never applied generally.
- **The lock draw.** All three locks that offered `W-SR` contained **no
  capacitor**; both that offered `W-RG` contained one. That single fact is the
  entire reason one read as live gear and the other as dead. `assembleBuild`
  correctly refuses to reach past the lock, so a missing bank does not restrict a
  cap-fed gun, it deletes it. `drawLock` already seeds a reactor and a weapon so
  a lock is buildable at all; it now guarantees a bank alongside a cap-fed gun,
  for the same reason.

### The result, once all four were fixed

| | before | after |
|---|---|---|
| `W-SR` archive uses | 0 | **27** |
| `W-RG` archive uses | 0 | 7 |
| dead parts | `R-E60, P-CAP2, W-RG, W-SR` | **`U-RISE3`** |
| range buckets filled | `close`, `mid` | `close`, `mid`, **`long`** |

**The long-range band is occupied for the first time, and every build in it
carries `W-SR`.** The Vulture standoff build the gun was cut for exists in the
archive at `CH-2 long/heavy/cold`, 59%. Three of the six long cells are filled;
the three still empty are all `redliner`, which is coherent — a standoff build
that also runs hot is a combination nothing has yet wanted.

Dead gear collapsing from four parts to one was not targeted. It is what happens
when the search can finally build what it draws.

### What this does and does not settle

It does **not** say the long guns are balanced. It says the instrument can now
see them, and that every previous "W-RG is dead gear" verdict — including F9's,
which is what motivated cutting `W-SR` in the first place — was measuring the
search and the completer as much as the gun.

The general lesson is the one in the heading. I3 reports "offered but never
wanted", and that phrase quietly assumes the search could have wanted it. Four
independent breaks produced output indistinguishable from dead gear, and each was
reported as a verdict before the next was found:

1. the part was never in the draw pool;
2. completion could not finish it;
3. placement order silently dropped it;
4. the lock offered it without the part it depends on.

**A single "dead gear" reading is not evidence about a part.** Before believing
one, check that a single copy of it, completed from a lock that contains what it
needs, placed in any order, can score at all. All four checks now have tests, so
this specific chain cannot recur — but the shape will, for the next part that
depends on another part.

It also puts an asterisk on **F9**. "W-RG is dead gear" was the finding that
motivated cutting a new gun for light frames, and it was measured through all
four of these breaks. The geometric half of F9 stands — a 2-wide gun cannot fit a
Vulture at any budget, which is why `W-SR` exists and why it is the only thing in
the long cells. The "nobody wants the railgun" half was the instrument.

### Left open: the Pinion scales too well on a big frame

`CH-9 rank 20 long/medium/cold` is a **two-Pinion Bastion at 100%**, and a
three-Pinion variant at 95%. I2 at rank 20 now reads CH-9 **72% ahead of CH-2**,
and CH-9's rank-monotonicity failures got worse (rank 20 beats rank 12 only 13%).

The gun was cut to cost a Vulture an entire arm. A Bastion has room for two or
three of them and pays no such price, so the constraint that gives the part its
identity does not bind on the chassis it was not designed for. That is a content
decision — a per-build copy limit, a hardpoint-only restriction, or accepting it —
and it is not taken here.



## F17 — "Heavy" is empty because the catalog has no mass to spend, not because mass is punished

The content brief (docs/20 §3) recorded heavy builds as 7 of 189 archive entries
and read that as *mass is pure cost and buys nothing*. Half of that is right and
the diagnosis is wrong, which matters because it points at a different part.

### Where the heavy builds actually are

Splitting `artifacts/breed-wsr.json`'s gallery by chassis:

| chassis | light | medium | heavy |
|---|---|---|---|
| CH-2 Vulture | 28 | 40 | **7** |
| CH-9 Bastion | 88 | 26 | **0** |

Every heavy build in the game is a Vulture, and the highest `loadFactor` reached
by any of the 189 is **0.84** against a 0.8 threshold. Nothing is heavy by much,
and the assault chassis is never heavy at all.

### It is a density problem

`weight` is `massT / ratedMassT`, so being heavy means filling cells with
kilograms. Ranked by mass per cell, the catalog is thin at the top:

| part | kg/cell | cells | what it is |
|---|---|---|---|
| `W-SR` Pinion | 183 | 6 | a whole Vulture arm |
| `U-ARM` Plate | **150** | 1 | pure soak |
| `W-RG` Longshot | 140 | 10 | fits nothing small |
| `W-BR` Maul | 108 | 6 | the close-range brute |
| *catalog mean* | *~90* | | |

A CH-9 needs 6.0 t of parts on top of 3.6 t of structure to reach 0.8. At the
catalog's mean density its 56 cells supply about 5.0 t, which lands at 0.72 —
short. It only crosses by spending cells on Plates, and **every heavy build in
the gallery carries three to seven of them**. So the price of being heavy is paid
in the same currency as being armed, and the search correctly refuses it.

The lever is therefore *a part that is dense **and** useful*, not a part that
rewards load fraction. Nothing in the sim reads load fraction except the speed
derate; there is no channel to reward it through without a new rule.

### The close/heavy cell has a second, sharper cause

`npm run sim:try -- CH-2 W-BR:2` stalls:

```
! W-BR: asked for 2, fitted 0 — no legal cell
```

`W-BR` is `rect(2,3)` and a Vulture hardpoint is two wide with tapered ends —
only two solid 2-wide rows. **The one close-range brute in the game cannot be
fitted to the one chassis that ever gets heavy.** `close/heavy` was not a
preference the search expressed; it was a shape that does not exist.

### The Vulture is a one-gun frame by geometry

Every 4-cell part in the catalog is a `2x2` — both small reactors, `P-CAP2` and
`W-RKT` alike — and the Vulture's body region is **one cell wide**, so no 2-wide
part can ever sit in it. That leaves exactly two 2x2 slots, one per arm, and the
reactor takes one. `sim:try -- CH-2 W-RKT:2 --no-armour` fits one pod and stalls
on the second with the frame otherwise empty. This is not a bug and it is worth
knowing before authoring anything 2-wide for a scout.

### Mass costs power and heat, not only speed

`derivedStats.ts:86` is `locomotionKw = 1.2 * massT * cruiseSpeed` and
`simulation.ts:610` adds `0.15 * massT` of locomotion heat, so mass has three
cost channels and the brief named one. `sim:try -- CH-9 W-BR:4` reports it
directly: *"26 more came back off — their mass browned the build out."*

There is a shape in this nobody has used. Cruise speed is
`base * loadFactor` and `loadFactor` is `rated/actual` clamped to `[0.4, 1.15]`,
so above load `1/1.15 = 0.87` the mass cancels:

```
locomotionKw = 1.2 * m * base * (rated/m) = 1.2 * base * rated
```

**Past 0.87 load, additional mass costs no additional locomotion power at all** —
the marginal power price of tonnage falls to zero almost exactly where the
archive's "heavy" bucket begins. Heat keeps climbing linearly; power does not.
That is an existing, unexploited reason to commit to being heavy rather than
hovering below the line, and it was found by reading the two formulas, not by
measuring. It has not been measured and no part uses it yet.


## F18 — One of the six "dead mods" has no legal carrier at all

`docs/20 §3` listed six mods as offered-but-never-wanted. Checking `appliesTo`
against the enabled catalog before believing any of them — §7's gate applied to
mods rather than parts — separates one out immediately:

| mod | attaches to | enabled carrier? |
|---|---|---|
| `tidecooler` | `isRadiator` | `U-RAD` ✓ |
| `gyrostabilized` | `isWeapon` | ✓ |
| `gyro-flywheel` | `isFrameFitting` | ✓ |
| `weaving-gait` | `isFrameFitting` | ✓ |
| `thermocouple-skin` | `category === 'capacitor'` | `P-CAP`, `P-CAP2` ✓ |
| **`sacrificial-casing`** | **`id === 'U-AMMO'`** | **none** |

`ENABLED_PART_IDS` is `Object.keys(PARTS).filter((id) => id !== 'U-AMMO')`, and
`MIDGAME_POOL` excludes it by declaration, so `sacrificial-casing` can never be
legally attached to anything. It is not a mod nobody wants; it is a mod nobody
*can take*. Per docs/20 §8 the two are indistinguishable downstream — an
`appliesTo` that declines scores `+0.0`, exactly like an effect that does
nothing — so `sim:diversity` has been correctly reporting a number that means
something else entirely.

This is F16's shape again, one layer up: **the instrument could not tell
"unwanted" from "unreachable", and the reader could not tell either.**

`game:audit` now warns when a modifier has no enabled part it can attach to. It
fires on exactly one mod today and nothing else, so the fence is around exactly
the hole. The `U-AMMO` / `sacrificial-casing` pair is deliberate — ammo is
deferred by owner call — so `game.test.ts` pins that one warning by name with
the reason instead of asserting the warnings list is empty. If ammo ever lands
the warning disappears on its own; if any other mod loses its last carrier the
assertion fails loudly.

**The remaining five are still unexplained**, and three of them (`gyro-flywheel`,
`weaving-gait`, and `gyrostabilized`) are movement mods that have not been
re-measured since the parts they ride on became fittable. `thermocouple-skin` is
live — `simulation.ts` §10b really does bleed cell heat back into charge — but it
pays off only on a capacitor-fed build, and the whole cap-fed class was itself
unreachable until F16 was fixed. None of those five should be touched before
they are re-measured at the current content hash.


## F19 — The seed enumeration could not propose a mod on a support part (headline corrected, see F25)

`docs/20 §3` listed six mods as *offered, never wanted*. Counting attachments in
`artifacts/breed-wsr.json` instead of reading the dead list says the problem is
twice that size:

**23 mod attachments across 189 builds, and only three distinct mods appear at
all** — `insulated-mount` (15), `fever-cycle` (4), `ram-bore` (4). The other
eleven of fourteen have zero.

> **Corrected by F25.** Counting gallery attachments conflates *never offered*
> with *never wanted*, which is the precise error F16 exists to prevent. A
> four-lock sweep draws three mods per lock and offers about half the catalog, so
> most of those eleven were never in a lock at all. The report's own
> `invariants.i3` had it right the whole time: **four dead mods, not eleven.**
> What survives below is the mechanism, which is proven by unit test and does not
> depend on the count.

### The split is exact, and it is not about strength

Partitioning every mod by whether its `appliesTo` accepts any weapon:

| attaches to a weapon | appears in archive | absent |
|---|---|---|
| **yes** (7) | `insulated-mount`, `fever-cycle`, `ram-bore` | `cold-bore`, `gyrostabilized`, `surge-gate` |
| **no** (7) | *none* | **all seven** |

Not one mod that cannot ride a weapon has ever been placed on a build. That is
not a preference the search expressed; it is a shape the search cannot make.

### The cause is in `enumerateGenomes`, not in the mods

`enumerateGenomes` (`packages/sim/src/breeding.ts`) builds the seed population
two ways, and only one of them carries mods:

```ts
// single-part genomes: mods enumerated
for (const modifiers of [undefined, ...legalModsFor(a, lock).map((id) => [id])])
  out.push({ chassisId, parts: [{ partId: a, count, modifiers }], armourPlates });

// two-part genomes: no modifiers at all
out.push({ chassisId, parts: [{ partId: a, count: 1 }, { partId: b, count: 1 }], armourPlates });
```

A single-part genome is only *viable* if the wish part is a weapon — the
completer adds reactors, radiators, banks and armour, but it never adds a gun,
and a build with no weapon surrenders by mission-kill about three seconds in.
So the only modded builds the seed population ever contains that can score above
zero are **one weapon, one mod**. Every mod that needs a radiator, a riser, a
plate, a capacitor or a servo to ride on can only reach a viable build through
mutation, starting from a population where it never appears.

That is F16's fitness valley in a different coordinate: not "each step toward
the combination is downhill", but "the combination is never proposed".

### Fixed, and measured

`enumerateGenomes` now emits, for each two-part pair, the bare pair plus the same
pair carrying one mod on one side — `1 + |mods(a)| + |mods(b)|` variants, at most
seven with `LOCK_MOD_COUNT` 3, so the enumeration stays inside
`DEFAULT_SCREEN_BUDGET`. One mod at a time rather than the cross product, because
this is a seed population and combining them is what `mutate` and `crossover` are
for.

Measured with the change stashed and unstashed, same seed, ranks, chassis, budget
and workers (`--locks 4 --seed 1 --ranks 8,12,16 --chassis CH-5 --budget 200`),
both at content hash `7c4c70e8`:

| | builds | mod attachments | distinct mods | which |
|---|---|---|---|---|
| before | 72 | 7 | 2 | `insulated-mount`, `ram-bore` |
| after | 74 | 10 | **3** | `insulated-mount`, `cold-bore`, **`gyro-flywheel`** |

`gyro-flywheel` is the result: it is one of the seven mods that could not ride a
weapon, and it had never appeared on a build in any sweep. One attachment in 74
builds is not a balance verdict and is not meant to be — it is the difference
between a shape the search cannot make and one it can. `cold-bore` going from
absent to six is the same effect on the weapon-attachable side, where the extra
pair genomes gave it somewhere to sit.

`emptyCells` did not move (9 either way, on a CH-5-only three-rank run that is
not comparable to a full sweep's six).

### It did not replicate at full scale, and that is the honest result

The table above is a CH-5-only, three-rank run. Repeating the count on a full
three-chassis, four-rank sweep (`artifacts/anvil-after.json`, 193 builds) says
something different:

```
mod attachments: 71 over 193 builds | distinct: 3 of 14
by mod: { insulated-mount: 57, ram-bore: 12, surge-gate: 2 }
still absent: all seven support-only mods, gyro-flywheel included
```

`gyro-flywheel`'s single appearance did not survive a larger sample, and
`insulated-mount` takes 57 of 71 attachments on its own. **Removing the
structural barrier did not make support mods competitive.** The fix is still
correct — `genomeMods.test.ts` proves the seed population could not previously
express the shape at all, and that is a fact about the code rather than about a
sample — but the claim it licenses is only *"now reachable"*, never *"now
reaching"*. Anyone quoting the 2 -> 3 result should quote this paragraph beside
it.

Two candidate reasons, neither measured: the enumeration change adds pair
genomes with a mod but screening still ranks them against unmodded pairs that
cost less rank, and `LOCK_MOD_COUNT` is 3 of 14, so most locks simply never draw
the mod in question. Do not author against a support-only mod until one of those
is tested.

### What this does and does not license

The eleven are **not** measured as weak. Seven of them are unmeasured, and any
verdict about them — including the "dead mods" line in `docs/20 §3` and
`sim:diversity`'s output — is a statement about the enumeration.

The four that *can* ride a weapon and still never appear (`cold-bore`,
`gyrostabilized`, `surge-gate`, and `sacrificial-casing` for the separate reason
in F18) are the only honest dead-mod candidates in the catalog, and only three
of those are real.


## F20 — `simContentHash()` is a content-*and-compiler* hash, so never compute it locally

`simContentHash()` decides whether two reports are comparable, and its
`modifierFingerprint` includes `apply: m.apply.toString()` — the *source text* of
each modifier's effect. Function text is compiler output, and this repo runs two
compilers:

```
dist   (tsc):  "(m, ctx) => {\n    m.scale('damage', 0.95);\n    ...
                // The jitter half was added Aug 2026, when raising ...
source (tsx):  "(m,ctx)=>{m.scale(\"damage\",.95);if(ctx.tempC<COLD_BORE_MAX_C){...
```

esbuild minifies and strips comments; tsc preserves both. So the **same catalog
hashes to two different values** — `29023729` from `packages/sim/dist`,
`7c4c70e8` from source under `tsx`. Reports are stamped by `scripts/breed.ts`,
which always runs under tsx, so reports remain consistent *with each other*.
Anything computed from `dist` does not agree with them.

This cost a real misreading during this pass: `artifacts/breed-wsr.json` stamps
`7c4c70e8`, a locally computed hash said `29023729`, and the conclusion drawn was
that the catalog had moved and the report was no longer comparable. It had not
and it was. The comparison that had already been made against it was valid.

**The rule:** compare a report's `stamp.contentHash` only against *another
report's* `stamp.contentHash`. Never compute `simContentHash()` yourself and
compare it to a stamp — the answer depends on how the code was compiled, not on
what the content is.

Two consequences worth knowing before anyone leans on this hash further:

- It is sensitive to **comments inside a modifier's `apply` body** under tsc, and
  not under tsx. Editing a comment can change the recorded identity of the
  content under one toolchain and not the other.
- It is not sensitive to anything about a modifier *outside* `apply`, `blurb`,
  `tradeoff`, `maxCopiesPerBuild` and `kind`. `tier` is absent, so re-tiering a
  mod — which changes its draw weight, its price and its rank cost all at once —
  does **not** change the hash, and two reports either side of that edit will
  claim to be comparable.

Redesigning the fingerprint would invalidate the stamp on every report already
written, so it is recorded here rather than changed.


## F21 — The completer under-sizes the reactor, and mass is what browns the build out

Found while exploring `W-AV`, and it is not about that part. `assembleBuild`
closes a measured energy gap by adding the *smallest* reactor that helps, one at
a time, and then has nowhere to put the next one:

```
$ npm run sim:try -- CH-5 W-AV:3
  1 x R-E25    Whisper (electric S)
  3 x W-AV     Anvil (breaching mortar)
  ! wanted another R-E25 — energy margin -2.4 kW, but no legal cell is left
  WARN  CANNOT SUSTAIN FIRE — demand exceeds supply by 2.4 kW
  vs the canonical roster — 25% overall

$ npm run sim:try -- CH-5 W-AV:3 R-C90
  1 x R-C90    Furnace (combustion M)
  ...
  power   +61.9 kW margin
  vs the canonical roster — 50% overall
```

Twenty cells were free. A 9-cell `R-C90` fits and delivers 90 kW; the completer
took a 4-cell 25 kW `R-E25`, came up 2.4 kW short, and could not upgrade because
its only move is to add another of the same. Naming the Furnace by hand doubles
the build's score, so the completer's reactor choice is worth **25 points** on
this build alone.

The reason the gap exists at all matters more than the gap. **The Anvil is
mechanical — it draws nothing.** The demand is locomotion:
`derivedStats.ts:86` is `1.2 * massT * cruiseSpeed`, so a 5.1 t build wants
about 42 kW to walk. Mass is the load. That is F17's third cost channel, and it
means *any* heavy build hits a power wall the completer cannot climb — the same
build shape the archive has always been missing.

So a dense part and a greedy smallest-first reactor rule interact badly, and the
interaction looks exactly like "the dense part is bad". It is not fixed here:
`sim:try` and the breeder share `assembleBuild`, so changing the reactor rule
changes every score in every report, and that wants to be its own measured
change rather than a side effect of authoring a gun. Recorded, and on the
watchlist.

Related, and also not acted on: `sim:try -- CH-9 W-AV:8` fits **two**. That one
is correct — `clearsForward` means only the front rank has a clear lane, so a
56-cell frame cannot simply stack guns — and it is the reason the Bastion
reaches heavy on armour rather than on guns.


## F22 — The Anvil fills the heavy cells, and the A/B that measured it was not an A/B

`W-AV` shipped to test F17's claim that heavy builds were missing for want of a
dense part worth carrying. It was measured against a control run with `W-AV`
removed from `MIDGAME_POOL`, same seed, ranks, budget, workers and instrument,
and the two reports carry the same `stamp.contentHash` (`dfc3e8a3`) because
`MIDGAME_POOL` is not in the fingerprint.

| | builds | empty cells | heavy builds | max load |
|---|---|---|---|---|
| control, `W-AV` not offered | 173 | 7 | **0** | **0.68** |
| with `W-AV` offered | 193 | 4 | **15** | **1.04** |

Three cells filled — `close/heavy/cold`, `close/heavy/redliner`,
`long/heavy/cold` — and none emptied. Builds now deliberately overload past 100%
of rated mass and win there, against a previous archive-wide ceiling of 0.84.

### The control was contaminated, and `W-CB` going to exactly zero is what showed it

`W-CB` fell 70 uses to **0**. A number that round is not a balance effect, and it
is not one here:

```
control lock 0: R-E25 U-RAD U-TC1 W-BR W-CB W-ION W-SC
after   lock 0: P-CAP R-E25 U-TC1 W-AV W-BR W-ION W-SC W-SR
```

**`MIDGAME_POOL.parts` is the draw domain.** `drawLock` consumes one `nextFloat`
per pick from a shrinking copy of that array, so adding one id to it re-rolls
every lock at the same seed. The carbine was never offered in the after run. The
same goes for `U-ARM` (0 to 16 uses), which appears in an after lock and in no
control lock.

So this half of the report is **withdrawn**: the part-usage deltas measure lock
composition, not displacement, and the `CH-2 mid/*` ceilings falling 66% to 1%
and 96% to 1% are the carbine leaving the locks, not the Anvil arriving. Nothing
was measured about what `W-AV` costs.

### What survives, and why

The heavy result is build-level rather than lock-level, which is what saves it:

- **11 of the 15 heavy builds contain `W-AV`.** The other four do not, and
  `U-ARM` — the previous densest part — is drawn in an after lock and no control
  lock, which plausibly accounts for them.
- The control was **not** starved of density. `W-SR` at 183 kg/cell, the second
  densest part in the game, was offered in two of its four locks, and it still
  produced zero heavy builds and never passed 0.68 load. 183 kg/cell was not
  enough; 250 was.

Directionally consistent with F17 and strong enough to keep the part. Not a
controlled measurement, and it should not be quoted as one.

### How to A/B a part properly, since this will recur

Any change to `MIDGAME_POOL.parts` re-rolls every lock. A real control has to
hold the pool identical and gate the part *after* the draw — leave the id in the
pool for both runs and filter it out at genome construction, so the locks are
byte-identical and the only difference is whether the search may use it. Until
that exists, a content A/B on this harness compares two different experiments,
and only build-level attribution (does the build that fills the cell actually
contain the part?) is safe to quote.

### The swing, recorded and not tuned

`W-AV` is in **77 of 193** archive entries, and the three-Anvil Mule reaches
98-99% at ranks 16 and 20. That is a large presence for one part, and it is the
shape that made `W-SR` need a second pass. Recorded per the standing instruction
that balance is a separate track; no number was moved to soften it.


## F23 — Reaching out cost no heat, and the Kiln is dominant with the cost working

Every `long/*/redliner` cell was empty. The cause is one line of the catalog read
sideways — **the two longest-reaching guns are also the two coldest:**

| weapon | ideal midpoint | sustained heat |
|---|---|---|
| `W-SC` Scald | 10 m | 7.50 kW |
| `W-RG` Longshot | 65 m | 5.00 kW |
| `W-AV` Anvil | 15 m | 3.00 kW |
| **`W-SR` Pinion** | **100 m** | **2.31 kW** |
| **`W-CB` Needle** | **47.5 m** | **1.33 kW** |

A long build was cold *by construction*, so the whole redliner column at range
had no occupant.

### The brief was a three-way corner nothing was even two of

Filling it needs one part to be long (ideal midpoint over 100 m), light (under
0.5 of rated mass) and hot — over about **10.8 kW**, which is what a bare Vulture
sheds through its skin with no radiator at all (measured, not assumed).

Light and hot pull against each other through the power system: heat comes from
energy, energy needs a reactor, and reactors are among the densest parts in the
catalog, so a *charged* long gun makes its own build heavy and cold. The way out
is the one the flamer already uses — a chemical gun that draws nothing and still
runs hot. `W-KL` is that at range: `line(3)`, 200 kg, no `draw`, 45 kJ a shot on
a 3 s cycle for 15 kW sustained, and **no `recoilKnS` at all**, because a
recoilless rifle vents its propellant backwards. The fiction and the numbers are
the same fact: it is the only gun in the catalog with real reach and no kick, and
the backblast is what it pays instead.

### The cell fills on every chassis, and the plate gene is what selects which

| build | plates | cell | load | margin |
|---|---|---|---|---|
| CH-2 `W-KL`:1 | 0 | **`long/light/redliner`** | 0.48 | −9.7 kW |
| CH-2 `W-KL`:1 | 2 | `long/medium/redliner` | 0.57 | −7.9 |
| CH-2 `W-KL`:1 | completer default | `long/heavy/redliner` | 0.87 | −2.5 |
| CH-9 `W-KL`:4 | 0 | `long/light/redliner` | 0.42 | −24.6 |

One part reaches all three of `long/light`, `long/medium` and `long/heavy`
redliner depending only on `armourPlates`, which is a gene the breeder mutates.

### Measured: the cell filled, and every build in it carries the gun

`artifacts/kiln-after.json`, 211 builds. Empty cells **4 to 2** —
`long/light/redliner` filled as designed, and `mid/heavy/cold` came with it.
What remains empty is `mid/heavy/redliner` and `long/heavy/redliner`.

Attribution is build-level, which is the only kind F22 leaves safe after
establishing that adding an id to `MIDGAME_POOL` re-rolls every lock:
**all 39 builds sitting in a `long/*/redliner` cell carry `W-KL`.** Not most —
all of them. The cheapest is `CH-2 r8: R-E25, W-KL` at 67%, which is the whole
brief in two parts.

Concentration was re-checked because `W-KL` reaches 108 of 211 entries, twice
`W-AV`'s share, and the answer is the opposite of the worry:

| report | builds | distinct weapons | top weapon | HHI |
|---|---|---|---|---|
| `anvil-after` | 193 | 8 | `W-AV` 23% | 0.146 |
| `kiln-after` | 211 | **10** | `W-KL` 26% | **0.146** |

The Herfindahl index did not move and the number of distinct weapons reaching the
archive went **up**, from 8 to 10 — the widest spread of any report on file. A
part that opens a new region of the space brings other parts with it.

### The heat cost is real — and it is not enough

This needed checking rather than asserting, because `computeHeatBalance` is a
static estimate at 115 °C and F14/F15 is the standing lesson that the gauge and
the sim can disagree. Running the CH-5 three-Kiln build against all seven
templates, four seeds each, and reading `hottestCellC` off the frames:

| opponent | peak °C | ticks a gun was heat-gated |
|---|---|---|
| `bastion-tank` | 125 | **13.8%** |
| `railgun-mule` | 125 | 6.9% |
| `mule-skirmisher` | 125 | 6.2% |
| `mule-gunline` | 118 | 1.1% |
| `vulture-skirmisher` | 120 | 0.2% |
| `mule-laser-boat` | 116 | 0.1% |
| `vulture-sniper` | 103 | 0.0% |

It crosses the 115 °C fire-hold in six of seven matchups and stops short of the
130 °C shutdown. **The tradeoff is live: the build really does have to stop
shooting.** And it wins **28 of 28** anyway.

So the mechanic bites and the numbers do not. Recorded, not tuned, per the
standing instruction that balance is a separate track.

### The "it crowds the archive" worry does not survive being measured

The first draft of this finding argued that two dominant parts degrade the
archive as an instrument, on the strength of `W-AV` appearing in 77 of 193
entries. That figure is share of *entries*, and most entries carry more than one
weapon, so it is not a concentration measure. The concentration measures say
almost nothing happened:

| report | builds | distinct weapons | top weapon's share of weapon slots | HHI |
|---|---|---|---|---|
| `breed-wsr` (before both) | 189 | 9 | `W-LAS` 19% | 0.137 |
| `anvil-control` | 173 | 8 | `W-SC` 23% | 0.142 |
| `anvil-after` | 193 | 8 | `W-AV` 23% | **0.146** |

`W-AV` at 23% is exactly where the previous top weapon sat, and the Herfindahl
index moved 0.142 to 0.146. **The archive is not measurably more concentrated,
and the instrument is not degrading.** The claim is withdrawn.

What remains is an ordinary balance swing, on a different measurement entirely —
fitness against the canonical roster, not share of the archive. It belongs to the
balance track and nothing here should be tuned for it.

(An intermediate reading of `peakC 0` across every matchup was wrong — the frame
field is `mechs[i].hottestCellC`, not a `cellTempsC` map, and a zero there meant
"read the wrong field", not "never got hot". Recorded because it is the same
class as every other instrument miss in this file.)


## F24 — The last two empty cells were not a content gap; the armour gene is a reflecting random walk

Before authoring anything for `mid/heavy/redliner` and `long/heavy/redliner`, the
§7 question: are they empty because nothing can fill them, or because the search
cannot reach them? Sweeping every one- and two-gun wish on every chassis across
plate counts 0 to 20 answers it immediately — **both are reachable with parts
that already exist**, at ranks well inside the breeder's own 8-20 range:

```
mid/heavy/redliner    CH-2  W-KL:1 + W-MG,  6 plates, load 0.81, rank 12
long/heavy/redliner   CH-2  W-KL:1,         8 plates, load 0.87, rank 13
```

So no part was missing. What was missing is a search that can propose eight
plates.

### The gene could not travel

`mutate` moved armour by exactly `+/-1` with a floor at 0. That is a reflecting
random walk, and over 400 walks from zero:

| mutations | walks reaching 8+ plates | best seen |
|---|---|---|
| 10 | 0.0% | 4 |
| 20 | 0.0% | 5 |
| 40 | **0.0%** | 7 |
| 80 | 4.8% | 13 |

Forty mutations is a generous budget for one gene and it never once arrived.

Selection makes it worse rather than better, which is the part worth keeping.
Every intermediate plate count is mass with no benefit until the build crosses
the 0.8 weight boundary, and crossing it does not itself pay — so every step
toward a heavy build is downhill. **That is F16's fitness valley in a third
coordinate**: not "each step toward the combination is downhill" (cap-fed guns),
not "the combination is never proposed" (F19's support mods), but "the far end is
reachable only by a walk that cannot get there".

### The first fix did not work, and its failure is the useful half

A quarter of the time the gene now resamples anywhere in 0-12 instead of
stepping, and `armourGene.test.ts` pins travel, the step's majority and the
floor — it failed at exactly 0 of 400 before. **In a real sweep it changed
almost nothing:**

| | builds | empty cells | heavy | max load | max plates |
|---|---|---|---|---|---|
| `kiln-after` | 211 | 2 | 13 | 0.85 | 3 |
| `armour-after` (wider gene) | 220 | **3** | 12 | 0.88 | **5** |

Empty cells went *up* — `mid/heavy/cold` emptied — and the archive's heaviest
build carried five plates against the eight the cell needs. The unit test
measured travel of one gene in isolation; it did not measure travel at the real
mutation rate under selection, and those are different quantities. The armour
branch is one of five mutation kinds and the resample a quarter of it, so a heavy
plate count arrives on roughly **2% of mutations** and then still has to meet the
right lock and chassis.

### It is not the fitness function either — the cell is worth 66%

Before trying a second lever, the obvious alternative hypothesis: perhaps the
search avoids the cell because builds there are bad. Walking plate count on the
build that reaches it, at rank cap 20 (screen fitness, not the confirmed number
the gallery reports):

| plates | rank | cell | screen, mean of seeds 1-8 |
|---|---|---|---|
| 0 | 5 | `long/light/redliner` | 33.6% |
| 2 | 7 | `long/medium/redliner` | 29.4% |
| 4 | 9 | `long/medium/redliner` | 65.9% |
| 6 | 11 | `long/medium/redliner` | 57.6% |
| 8 | 13 | **`long/heavy/redliner`** | **61.7%** |

62% is a perfectly good build, so the cell is not disfavoured. It is reachable,
admissible, worth having, and never proposed. And the step from zero to two
plates is **negative** — 33.6% to 29.4% — which is exactly where a walk starting
at 0 or 2 has nothing to climb, and slightly worse than nothing.

> **This table was published wrong and is corrected here.** The first version
> read 0.8% / 0.9% / 33.8% / 97.7% / 66.4% and described "a steeper response to
> armour than anything else in this file". `screenFitness` takes `(build, seed)`
> and had been called with one argument, so every value came from a single
> undefined-seeded run of a **three-battle** screen. The conclusion survives, the
> magnitudes were an artefact. See F26.

### The second fix: propose the shape

`ARMOUR_SEEDS` is `[0, 2, 8]` — the seed population now contains the eight-plate
build directly, for every wish and every pair. This is F19's lesson applied to a
number rather than a mod: when the search cannot climb to a shape, propose the
shape.

The widened mutation is kept rather than reverted. A reflecting walk that
measures 0 of 400 arrivals is a defect on its own terms, and it is annotated in
place with the measurement above so nobody reads it as the thing that worked.

**It worked, and it produced the predicted build exactly.**

| | builds | empty | heavy | max plates |
|---|---|---|---|---|
| `kiln-after` | 211 | 2 | 13 | 3 |
| `armour-after` (wider gene) | 220 | 3 | 12 | 5 |
| `armour-seeded` (`[0, 2, 8]`) | 221 | **1** | **16** | **8** |

```
long/heavy/redliner  CH-2 r16  99%  plates 8 | R-E25, W-KL, 8x U-ARM
```

That is the build the offline sweep named before the fix was written — `CH-2`,
one Kiln, eight plates, rank 13 — found by the breeder at 99%, plus a seven-plate
variant at rank 12 and `mid/heavy/cold` returning. The prediction, the fix and
the confirmation all agree, which is the first time in this file that a search
fix has been called in advance rather than diagnosed afterwards.

One cell of eighteen is still empty: `mid/heavy/redliner`. It is reachable —
`CH-2`, one Kiln plus a Stitcher, six plates, rank 12 — but it screens at
**33.1%** against the 66.4% of the cell next door, and six plates is two
mutation steps down from the nearest seed.

**It is deliberately left empty.** Adding 6 to `ARMOUR_SEEDS` would fill it, and
that is the reason not to: the seed list would then be fitted to a known answer,
and each value multiplies an enumeration already bounded by the screen budget.
The archive is a diagnostic, not a scoreboard. Driving it to zero by seeding the
shapes we already know are missing makes it worse at its actual job, which is
telling us about shapes we have *not* thought of. A cell that is reachable, worth
a third, and two steps from the seed population is a fair thing for the search to
miss.

Both change search behaviour, so reports either side are not comparable even at
an identical content hash — the same caveat `--workers` already carries.


## F25 — There are four dead mods, not eleven, and the report always said so

`docs/20 §3` and F19's headline both claimed eleven of fourteen mods reach no
build. That number came from counting mod attachments in the gallery, and it is
wrong in exactly the way F16 was written to prevent: **it conflates a mod nobody
took with a mod nobody was offered.**

`invariants.i3` in every report already separates them, and has since before this
pass began:

```
deadMods    : marsh-pistons, tidecooler, surge-gate, thermocouple-skin
neverOffered: ... cold-bore, gyrostabilized, hull-down, coil-sprung,
                  gyro-flywheel, weaving-gait, sacrificial-casing
```

Three taken, four offered and refused, seven never drawn. Three plus four plus
seven is fourteen.

### Why half the catalog is missing from any given sweep

`LOCK_MOD_COUNT` is 3 and a four-lock sweep therefore has twelve mod slots for a
fourteen-mod catalog, drawn with tier weighting and with repeats — `fever-cycle`
took three of the twelve in `armour-seeded`. **A four-lock sweep structurally
cannot measure the mod catalog**, and no amount of reading it harder will fix
that. A mod verdict needs enough locks that every mod is offered several times;
that is a parameter choice, not a finding about gear.

### What this changes

- The "largest untouched area in the game" claim in `docs/20 §3` is withdrawn.
  The honest dead list is **four**, and it is tractable rather than systemic.
- `U-ACT` is the one dead *part*, and it has been dead across every sweep in this
  pass. That is a better-supported finding than anything about the mods, because
  it was offered every time.
- F19's mechanism stands on its own: `genomeMods.test.ts` proves the seed
  population could not express a support-part mod on a scoring build, which is a
  fact about the code and needs no sample. Only its headline count was wrong.

The general lesson, which is now three for three in this file: **read
`invariants.i3`, never a count derived from the gallery.** The gallery cannot
distinguish absent from unavailable, and every time someone has recomputed
coverage by hand they have rediscovered that the hard way.


## F26 — `U-ACT` is not dead gear, and the screen cannot see it

`invariants.i3` has listed `U-ACT` as the one dead *part* in every sweep of this
pass — offered every time, taken never. Measured against the canonical roster
over 42 battles per shape, it is nothing of the kind:

| shape | without | with `U-ACT` | delta |
|---|---|---|---|
| `CH-5 W-LAS:2` | 26.2% | 52.4% | **+26.2** |
| `CH-9 W-BR:2` | 28.6% | 50.0% | **+21.4** |
| `CH-5 W-AV:2` | 28.6% | 47.6% | **+19.0** |
| `CH-5 W-AC:1` | 16.7% | 23.8% | +7.1 |
| `CH-5 W-AC:2` | 59.5% | 61.9% | +2.4 |

**Every shape improves**, by about 15 points on average. The Stride is one of the
better utility parts in the catalog and the archive calls it dead.

### The noise band, measured

`screenFitness` fights `SCREEN_PANEL_IDS` — three opponents, one battle each, at
one seed. On fixed builds across 24 seeds:

| build | mean | sd | min | max |
|---|---|---|---|---|
| `CH-5 W-AC:2` | 67.1 | 11.3 | 33.5 | 98.0 |
| `CH-2 W-CB:2` | 82.4 | 20.8 | 34.3 | 99.1 |
| `CH-9 W-BR:2` | 26.0 | **28.0** | **0.0** | **97.3** |
| `CH-5 W-KL:2` | 92.2 | 13.5 | 65.9 | 99.6 |
| `CH-5 W-AV:2` | 57.2 | 25.3 | 32.5 | 98.1 |

**Mean sd is 19.8 points**, and one build covers the whole scale from 0 to 97
depending only on the seed. A one-sample screen separates two builds only when
they differ by roughly **40 points**. Below that it is a coin flip.

### What this does and does not undermine

It does **not** undermine the gallery. Those numbers come from `confirmFitness`
at `--confirm-seeds 40`, which is a different instrument from a three-battle
screen. A build the report calls 61% is worth about 61%.

What it undermines is **which** build reached each cell. Selection runs on the
screen, so a cell's elite is the luckiest candidate seen rather than the best
one, and a part whose whole contribution is under 40 points cannot reliably
influence that choice. `U-ACT` at +15 is far inside the band.

The consequence for this file's most-cited invariant: **I3's `deadParts` and
`deadMods` cannot speak to any part worth less than about 40 points.** For gear
in that range, "offered but never wanted" means "offered, and the instrument
could not tell". `U-ACT` is the proof that this bites in practice.

**The rule: never quote `screenFitness` as a build quality.** Use `runBattle`
across the panel with several seeds, or `confirmFitness`, which is what the
gallery reports. F24's armour table was published from a miscall of exactly this
kind and is corrected in place.

Widening the screen buys fewer candidates per budget, so it is a real trade and
is recorded here rather than made. `U-ACT` is not tuned in response either: it
does not need a buff, it needs an instrument that can see it.


## F27 — Dead-gear verdicts are a function of sweep size, and twelve locks change all of them

Every dead-gear claim in this pass came from a four-lock sweep. Re-running at
**twelve** locks (`artifacts/mods-12lock.json`, seed 21, ranks 8 and 16, 263
builds) changes essentially every one of them.

### Mods: all fourteen offered, seven taken, seven dead

```
never offered : (none — all 14 were drawn)
taken (7)     : insulated-mount 19, ram-bore 16, gyrostabilized 6,
                cold-bore 3, fever-cycle 3, surge-gate 3, gyro-flywheel 1
dead  (7)     : marsh-pistons, tidecooler, hull-down, coil-sprung,
                weaving-gait, sacrificial-casing, thermocouple-skin
```

Twelve locks give 36 mod slots for a 14-mod catalog and every mod gets drawn, so
this is the first sweep in this pass that can speak about mods at all.

**Both earlier lists in this file were wrong.** F19 said eleven of fourteen were
untried; F25 corrected that to four dead and named `cold-bore`, `gyrostabilized`
and `surge-gate` among them. All three are taken here — `gyrostabilized` six
times. The true dead list is a different seven.

One genuine positive: **`gyro-flywheel` appears.** It is a support-only mod, it
had never reached a build in any sweep on record, and F19's enumeration fix is
what lets it. One use in 263 builds is small, but it is the shape working at
scale rather than in a unit test.

### Parts: `U-ACT` is not dead here either

`deadParts` is `U-TUR, U-SHELL` — and **`U-ACT`, the part F26 was written about,
is taken.** F26's measurement stands (it is worth about +15 points across every
shape tested), and this is the independent confirmation: with enough locks the
search does find it. Two parts that were never flagged at four locks are flagged
now.

So `deadParts` and `deadMods` are not properties of the gear. **They are
properties of the experiment**, and at four locks they are close to noise. Read
them only from a sweep with enough locks that every id is offered several times,
and treat any dead-gear verdict from a small sweep as unmeasured rather than
negative.

### `sacrificial-casing` was in `deadMods` and should not have been — fixed

It has no enabled carrier at all (F18), so it cannot be taken by construction.
`checkCoverage` knew what was *offered* but not what was *attachable*, so an
unattachable mod read identically to a refused one — the same conflation F16
fixed for parts, one level down.

`checkCoverage` now counts a mod as offered only when the offered set also
contains a part it can ride, which is the same rule F16's lock guarantee applies
to a capacitor-fed gun and its bank: a lock that draws a mod and no carrier has
not offered it in any useful sense. `coverageCarrier.test.ts` pins it, including
that the dead list does not quietly empty itself.

One thing this surfaced: `U-AMMO` is in `COVERAGE_EXEMPT_PARTS`, so
`sacrificial-casing` has no carrier even against the whole catalog. The honest
report is therefore "never offered" in every sweep, narrow or wide, rather than
only in narrow ones.

### And the archive filled itself

`emptyCells` is **0** at twelve locks, including `mid/heavy/redliner`, which F24
deliberately left empty rather than seed a value for. More locks explore more.
This does not tell us the new parts were unnecessary — `W-KL` is in every
`long/*/redliner` build by build-level attribution, and that is unaffected — but
it does mean **an empty cell in a four-lock sweep is weak evidence of a content
gap**, and the honest first response to one is to raise the lock count before
authoring anything.


## Non-findings, recorded so they are not re-investigated

- **`sim:diversity` is green.** Its only failure was a mismeasurement: the
  harness tested hull-down at 0.5 m/s where the perk fires at 1.5, reporting 2%
  activation instead of 37% and listing a live perk in `deadPerks`. Fixed by
  declaring `ModifierDef.isActive` beside `apply`. Do not cite diversity output
  from before 2026-08-18 as evidence of a balance problem.
- **Body collision (`fe265c3`) is innocent.** Measured, not assumed.

## F28 — Mount arc is an inert lever, so `U-TUR` is dead by construction

`deadParts` at twelve locks is `U-TUR, U-SHELL` (F27). Following docs/20's own
advice — an empty cell is usually the search, not the content — I went looking
for the search failure behind the Gimbal and did not find one. It is dead for a
reason no sweep size can change.

**Hypothesis.** `U-TUR` is dead because mount arc never binds: the autopilot's
`face` verb keeps the target on the nose, so +25° of arc is a payment for
something that is never scarce, and the Gimbal is therefore a `U-RISE2` that
costs 2 kW and 30 kg more.

### Measured, and it is not close

Two gates in `combat.ts` read arc: a weapon fires only while the bearing offset
is inside half its mount arc (`inArc`, ~1415), and dispersion takes a ×1.25
penalty past 75% of that half-arc (~2130). Both are live code.

Sampling every template pairing at three seeds — **195,746 frames**, offset
derived from frame positions and facing through the sim's own `datan2`:

```
bearing offset deg   p50 0.1   p90 0.2   p99 1.1   max 11.6
arc  20 deg (W-SR, the narrowest in the catalog): out of arc 0.00%
arc  30 deg: out of arc 0.00%   in the edge-dispersion band 0.01%
arc  90 deg: out of arc 0.00%   in the edge-dispersion band 0.00%
```

Per template, against the turn rate each build actually has:

| template | turn deg/s | mass t | offset p50 | p99 | max |
|---|---|---|---|---|---|
| vulture-skirmisher | 167.1 | 1.88 | 0.11 | 1.32 | 7.7 |
| mule-gunline | 99.6 | 2.77 | 0.06 | 2.38 | 11.6 |
| railgun-mule | 100.6 | 4.42 | 0.03 | 0.52 | 3.4 |
| bastion-tank | 48.7 | 7.09 | 0.05 | 0.84 | 8.9 |

**The mechanism is a rate race and it is not near.** Turn rate is 45–150 °/s by
chassis, scaled by load and CoG offset (`computeLoadScaledSpeeds`). The bearing
to a mech moving a few m/s at 40–160 m sweeps at a few °/s. The pilot wins by
an order of magnitude, so facing error is tracking noise — a tenth of a degree —
rather than a lag the geometry could ever open up.

**No authored number closes it.** Turn rate is chassis × load × CoG, so the
slowest build reachable in the game is the Bastion at 48.7 °/s, and it holds a
p99 of 0.84°. To make even a 20° gun clip its arc you need offsets above 10°,
which happen in 0.00% of frames. There is no part, mod or shape I can author
that makes arc matter; it needs a pilot that chooses to fight off-axis, or a
chassis an order of magnitude slower in the turn. Both are design decisions.

### What this changes

- `diversity.ts` rated `U-TUR vs U-RISE2` **distinct** on exactly this bonus.
  That verdict was reading a number that measures zero — F18's "`appliesTo`
  declining reads as `+0.0`" one level up, where the thing that never fires is a
  *part's* only differentiator rather than a mod's effect. Now `overlap-watch`,
  with the measurement in the evidence line.
- The chassis location zones that grant `weaponArcBonusDeg: 25`
  (`chassis.ts:230`) are advertised in the workshop — the action bar says
  "+25° location arc" while you place — and buy nothing. Left alone here: that
  is a UI honesty question, not a balance one, and it is worth deciding
  deliberately rather than as a side effect of this pass.
- `packages/sim/test/mountArc.test.ts` pins it. **Before authoring anything
  against arc — a narrow-arc gun, an arc mod, a new zone — make that test fail
  first.** If it still passes, the thing you authored cannot be felt.

**Verdict.** Not a content gap and not a search artefact: a dead lever. `U-TUR`
cannot be revived by anything docs/20 §4 licenses, and the honest options are to
give it a second job that is not arc, or to leave it as the catalog's worked
example of a part whose distinction does not exist. Recorded rather than fixed,
because both are the owner's call.

**Cost elsewhere.** None. No catalog number changed, so the content hash is
unmoved and every balance figure on file still compares.

## F29 — Armour was unreachable by every search that has ever run, and its shape is what decides whether it is usable at all

`deadParts` at twelve locks was `U-TUR, U-SHELL` (F27). F28 disposed of the
Gimbal. This is the Carapace, and the answer turned out to be two instrument
breaks and one content fact, in that order of importance.

**Hypothesis.** `U-SHELL` is dead because armour must cover one payload part
*exactly* — `checkSpatialPartPlacement` refuses a partial cover as
`footprint-mismatch` — so an armour part is only ever as useful as the number of
footprints it matches, and a 2-cell line matches almost nothing worth armouring.

### The content half, measured first

Over the 30 enabled parts, and over all four rotations:

```
U-SHELL (2-cell line): 4 coverable parts — U-ACT P-CAP W-MG W-CB
U-MANTLE (2x2)       : 6 coverable parts — R-C40 R-E25 P-CAP2 W-RKT W-AV W-SC
```

Legal placements over each canonical build's own parts:

| build | carapace | mantle |
|---|---|---|
| vulture-skirmisher | 0 | 1 |
| mule-gunline | 0 | 1 |
| mule-skirmisher | 1 | 1 |
| mule-laser-boat | 0 | 2 |
| railgun-mule | 3 | 1 |
| vulture-sniper | 0 | 1 |
| bastion-tank | 0 | 0 |

**Five of seven canonical builds have nowhere to put a Carapace at all.** The
payload-footprint histogram says why, and says what to author instead: 2x2 is the
commonest payload shape in the game at six parts — both small reactors, the
Reservoir, the pod, the Anvil and the flamer — and had no armour cut for it.

### Authored: `U-MANTLE`, and shape is the only variable

2x2, 360 kg, 120 HP, tier 2, `coveredHeatMultiplier` 1.25,
`blocksPassiveCooling`. Those are the **Carapace's own per-cell rates** — 90 kg
and 30 HP a cell, the same sealing penalty, the same tier — so the experiment is
the footprint and nothing else. It costs no free cell, which is the point: it is
the only way to buy HP on a full plate, and its whole price is mass and the heat
it traps. Over a reactor that price is real, and the completer shows the chain:
sealing an R-E25 on a Mule gunline flips heat balance to −0.3 kW and the assembler
answers with a Gill.

### The instrument half, which is the actual finding

Both `docs/20` §7 gates 2 and 3 failed, and they failed **for every armour part
that has ever existed** — the Carapace could not be assembled on any chassis in
any order, in any sweep on record. Two independent causes:

1. **`placeParts` refused `overlap`.** It called `checkPlacement` — the grid's
   flat occupancy check — and treated any error as a refusal. A cell that is
   already occupied is *exactly* where armour and risers go, and it is
   `checkSpatialPartPlacement` (layer, `stacksOn`, exact footprint) that decides
   whether a stack is legal. The workshop's own `PLACE` reducer has always
   tolerated `overlap` for this reason and deferred to the spatial check; the
   completer never did. So no armour was auto-placeable, anywhere, ever.
2. **The wish sort put armour first.** `assembleBuild` sorts biggest-footprint
   first, for `W-SR`'s reason: the part with least freedom must choose while it
   still has choices. Armour inverts that — it is a *dependent* placement and
   cannot go down before the thing it covers exists. Measured before the fix:
   placed when listed last, refused when listed first or middle, on all three
   chassis. Genomes carry parts in arbitrary order, so most genomes containing an
   armour part silently lost it.

After both fixes, gates 2 and 3 pass in all three orders on all three chassis,
and 372 assembled builds come back with zero `illegal-placement`. Tolerating
`overlap` is only safe because the spatial check is authoritative, and that is
asserted rather than assumed.

**This is F16's shape a third time.** Never-offered, never-completable and
never-placeable all read identically to dead gear, and this pass added a fourth
member of that family: *never-orderable*. `armourAssembly.test.ts` fences it for
every armour part in the catalog, so the next one cannot ship into the same hole.

### Two fences I got wrong first, which are worth keeping

The first version asserted armour "assembles alone". It does not, and should
not: assembling alone requires the seeded reactor to share the armour's own
footprint — true of the Mantle at 2x2, false of the Carapace's line. The second
asserted it assembles "on every chassis". Also false: the Vulture's hardpoint
ceiling refuses a Carapace over a Stitcher with `ceiling-exceeded`, which is the
height rule working correctly. Both were my assertions being wrong rather than
the code, and both would have been "fixed" by weakening the part. The fence now
asserts **order-independence**, which is precisely what the sort fix guarantees
and what the bug violated: before it, the three orders read `[0, 0, 1]`.

### The instrument fix alone rescues the Carapace

Same wish, six seeds against the canonical roster, one part different — build-level
attribution, which is the only kind F22 permits:

```
CH-5 W-MG:2                45%        CH-5 W-MG:2 U-SHELL:1     62%
CH-5 W-AC:2                71%        CH-5 W-AC:2 U-MANTLE:1    81%
CH-2 W-CB:2                98%        CH-2 W-CB:2 U-MANTLE:1    98%
CH-9 W-AV:1                31%        CH-9 W-AV:1 U-MANTLE:1    43%
```

A `W-CB:2 U-SHELL:2` Mule reaches 88% — a build that could not previously be
assembled by any tool in the repo. Six seeds is a smell test, not a verdict.

### The stall worth reading

```
! U-MANTLE: asked for 2, fitted 1 — no legal cell
```

A build has one reactor, so it has one 2x2 payload, so it has room for one
Mantle. A second needs a second 2x2 part — a Reservoir, a pod, an Anvil, a
flamer. That is the decision the part creates rather than a limitation: those six
parts are now also armour mounts, and choosing one buys a second place to put
120 HP.

### Cost elsewhere

`U-MANTLE` is `structural`, so it is a thirteenth carrier for the four
frame-fitting mods. They had twelve already, so it is not why they are dead —
worth recording because I had guessed carrier scarcity was the cause and the
measurement said otherwise.

The sweep verdict is below; everything above holds regardless of it, because it
is measured on the assembler rather than on the search.

### The sweep, and what may and may not be read from it

`artifacts/mantle-12lock.json`, same parameters as the F27 reference (12 locks,
seed 21, ranks 8 and 16, budget 200, 40 confirm seeds, 6 workers), 2418 s.

**The content hash moved — `60d47bd0` against the reference's `9dbea8e0` — so
per F22 these are two different experiments, not an A/B.** Adding one id to
`MIDGAME_POOL` re-rolls every lock at the same seed. Only build-level
attribution is quotable, so:

- **`U-MANTLE` is in 2 of 247 gallery builds.** Reachable and occasionally
  chosen. Small, and honestly small: at this sweep size that is presence, not
  strength.
- **`U-SHELL` is in 1.** It had appeared in **zero** builds in every sweep on
  record. The Carapace never changed; the completer did.
- **`deadParts` is empty**, for the first time in this file. The reference had
  `U-TUR, U-SHELL`. `U-TUR` reads 9 uses — the `overlap` fix frees supports and
  risers to be placed on occupied cells too, not just armour — but the hash moved,
  so that number is indicative and not a measurement of F28's verdict. **F28
  still stands on its own terms**: arc is inert whether or not the Gimbal gets
  picked as a riser.

### The swing, recorded and not tuned

**`emptyCells` went from 0 to 4, and all four are heavy:** `mid/heavy/cold`,
`mid/heavy/redliner`, `long/heavy/cold`, `long/heavy/redliner`. Gallery 247
against 263.

This is **not attributable to the Mantle** and I am not claiming it is. But it is
also not obviously a re-roll: four empty cells sharing one axis is a pattern, and
the `overlap` fix changed how *every* stackable part is placed, not only armour.
That is a broader change to the search than adding a part, and F24's warning cuts
both ways — heavy is exactly the axis the armour gene already struggles to reach.

**The experiment that settles it is now possible, and is worth running.**
`simContentHash()` covers `PARTS`, `CHASSIS`, `TEMPLATES`, the modifier registry
and the dials — it does **not** cover `assembly.ts` or `workbench.ts`. So a sweep
with the instrument fixes in place and `U-MANTLE` removed from the catalog and
the pool reproduces hash `9dbea8e0` exactly, at the same draw domain and the same
seed, and is a true A/B **of the instrument fix alone**. That is the one A/B this
harness can do, and it exists only because the fix is not content.

Not tuned, not baselined, and no balance harness was re-cut.

**Verdict.** Keep. The part is reachable, legal on six of seven canonical builds
against the Carapace's two, and creates a real decision — the only way to buy HP
on a full plate, paid for in mass and in the covered part's cooling. But the
honest headline is that **the instrument fix is worth more than the part**: it
un-deadened an existing part and a whole layer, and it had been broken for as
long as the armour layer has existed.

### The A/B, run — and it corrects two things I said above

`artifacts/assembly-fix-ab.json`: the instrument fixes in place, `U-MANTLE`
removed from the catalog and the pool, everything else identical. Content hash
**`9dbea8e0`, exactly the reference's**, so this is a true A/B and the only
difference between the two runs is `assembly.ts` and `workbench.ts`.

| | reference `9dbea8e0` | A/B `9dbea8e0` | Mantle run `60d47bd0` |
|---|---|---|---|
| `emptyCells` | `[]` | `[]` | 4, all heavy |
| gallery | 263 | 262 | 247 |
| `deadParts` | `U-TUR, U-SHELL` | `U-TUR, U-SHELL` | `[]` |
| noise band | 0.060 | 0.060 | 0.060 |

**Correction 1 — the instrument fix did not empty the heavy cells.** That was the
worry worth chasing, and it is answered: with the fix and no new part, `emptyCells`
is `[]`, exactly as before. The four empty heavy cells belong to the Mantle run,
and since its hash moved they are the re-roll or the part, which F22 says this
harness cannot separate. What matters is that they are **not** the fix.

**Correction 2 — the fix does not rescue `U-SHELL`, and I said it did.** The
commit and the paragraphs above claim the instrument fix "un-deadened an existing
part". At sweep level that is false: `deadParts` is still `U-TUR, U-SHELL` in the
A/B. The Carapace's single appearance in the Mantle run was at a different hash
and is not evidence of anything.

The two claims that survive are narrower and they are different claims:

- **Armour is now assemblable.** That is measured on the assembler directly — gates
  2 and 3 pass in all three orders on all three chassis, 372 builds with zero
  illegal placements — and it does not depend on any sweep.
- **The breeder still does not choose it.** Being placeable is necessary and not
  sufficient. `U-SHELL` remains dead for the reason the shape measurement gives:
  4 coverable parts, and no legal placement at all on five of seven canonical
  builds. The assembler was never its only problem, only its hidden one.

Two runs at the same hash and seed differ slightly (263 against 262 builds, and
`sacrificial-casing` classified as never-offered rather than dead). That is the
fix changing the search's path without changing its conclusions, and it is
exactly why the A/B was necessary rather than optional.

### The attributions, re-measured at 30 seeds

The figures quoted earlier came from 6-seed `sim:try` runs, which F30 below shows
are inside the tool's own noise. Re-run at 30 seeds, where it has converged:

```
CH-5 W-AC:2      78%  ->  86% with a Mantle   (+8)
CH-9 W-AV:1      25%  ->  36% with a Mantle   (+11)
CH-5 W-MG:2      42%  ->  58% with a Carapace (+16)
```

They hold. They were not defensible when I first quoted them, and they are now.

**Revised verdict on `U-MANTLE`.** Keep. Reachable, chosen twice in 247 builds,
legal on six of seven canonical builds against the Carapace's two, and worth
+8 to +11 by build-level attribution at 30 seeds. The instrument fix is a
genuine find and belongs to this pass, but it is a fix to reachability, not a
rescue: it is what makes an armour part *possible* for a search to hold, and the
shape is still what decides whether one is worth holding.

## F30 — `sim:try` has a 9-point noise band at low seed counts, and docs/20 sends you there by default

docs/20 §5 says to explore with `npm run sim:try` and read the `!` lines, and it
is right that this is the fast loop. But the score it prints moves on seed count
alone. One **identical** build, `CH-5 W-AC:2 U-ARM:1`, nothing changed but
`--seeds`:

```
seeds    4     6     8    12    20    30
        75%   71%   70%   76%   79%   78%
```

A 9-point spread with no content difference, converging around 78-79% by 20.
So **any attribution below about 10 points from a 6-seed run is unresolvable**,
and the default exploration loop is exactly where a small effect gets invented.

It caught a live hypothesis in this pass. `hull-down` measured **+7** at 8 seeds
on `CH-5 W-AC:2 U-ARM:1` — a plausible story about a good mod the breeder cannot
see, since F26 puts the screen's own band at 40 points. At 20 seeds the same
comparison reads **0**. The mod is not demonstrably worth anything on that build,
and a part would have been authored against a number that was noise.

This is F26 one level down: the screen separates at 40 points, and the tool you
use to decide what to screen separates at about 10 — but only if you ask it for
20 seeds, and the examples in docs/20 ask for 6 and 10.

**Use 20+ seeds for any comparison you intend to quote.** Six is fine for "does
this assemble, and what do the `!` lines say", which is what the brief actually
recommends it for.

## F31 — `tidecooler` cannot change the probability of the state it needs, because the pilot's water term is a typed constant

Third dead lever of this pass, and the third distinct mechanism. F28's arc is a
gate that never opens. F29's armour was a gate that opened but nothing could
reach. This one is a lever the *decision procedure* cannot see.

**Hypothesis, and it was wrong in an instructive way.** I started from "the pilot
has no terrain term, so a terrain-gated mod is a lottery". Measured, comparing
time-on-tile against the arena's own composition over 195k mech-ticks:

| tile | arena % | dwell % | ratio |
|---|---|---|---|
| hill | 5.79 | 11.35 | **1.96** |
| forest | 10.88 | 11.19 | 1.03 |
| open | 78.94 | 74.48 | 0.94 |
| water | 4.40 | 2.98 | **0.68** |

The pilot has a strong terrain preference: it takes hills at nearly twice their
share and **avoids water**. So the hypothesis was wrong, and the real question is
better — why does it avoid the tile the Tidecooler is about?

### The chain, and it breaks in two places

`exchangeAtPos` scores candidate ground by the standing exchange there, with
`terrainDpsMods` supplying hill range and forest cover. Water's cooling is not a
DPS term, so it enters as one line:

```ts
if (t === 'water' && runningHot) u += 2;          // combat.ts:1164
const runningHot = hottestC >= 100;               // combat.ts:1137
```

**Break 1 — the gate barely opens.** `runningHot` is true for **1.155%** of
mech-ticks, and on **one of seven** canonical templates. Six never reach 100 °C
at any point: peaks are 34, 58, 62, 62, 88 and 90 °C. Only `mule-skirmisher`
crosses it, 9.95% of its ticks, peaking at 116.

**Break 2 — and this is the real one — the incentive is a typed `2`.** It does
not scale with the mech's radiator count, with `WATER_RADIATOR_MULT` (1.6), or
with `tidecooler` itself. A mech carrying a Tidecooler values a water tile
*exactly as much* as one without it. The mod doubles the payoff of a choice whose
probability it has no way to influence.

That is CLAUDE.md's own rule broken where it matters most: "if you are drawing a
number the sim also derives, read it from the sim or derive it from frames and
events — never type it." The rule is written for instruments. Here it is the
autopilot — the decision procedure — standing a constant where the sim has a
derived quantity, and the constant is what makes a whole content lever inert.

### What this does and does not license

**Not authorable around.** Any water-keyed content — this mod, a wading radiator,
a bilge part — is dead on arrival by the same chain, because none of it can move
`u += 2`. There is no geometry, number or combination in docs/20 §4 that reaches
this. So `tidecooler` is not a content gap; it is waiting on a decision.

**The build it wants already exists in pieces.** Stand still, in water, redlining:
`hull-down` pays below 1.5 m/s (active 15.9% of ticks), water pays 1.6x radiator,
`tidecooler` would pay 3.2x. Three dead levers that all want the same behaviour
and one pilot that will not choose it. That is the interesting build this finding
is pointing at, and it is one constant away from being testable.

**Recorded, not fixed.** Making the water term derived changes pilot behaviour and
therefore every balance number on file, which is a bigger call than authoring
gear. Put to the owner rather than taken.

### Corrections to my own earlier reports in this pass

- I twice said "the pilot's move verb has no terrain term at all". **False** — it
  has `pickGround`/`worthRepositioning`, and the hill ratio of 1.96 is that
  machinery working well. The dwell numbers alone did not justify the claim, and
  I should have read `exchangeAtPos` before making it.
- The earlier note that water dwell is "incidental" is also wrong. 0.68 is not
  indifference; it is avoidance, and avoidance is a preference.

### F31 continued — the water term is derived now, and what that actually bought

Owner's call, taken 2 Sep: derive it. `combat.ts` now computes the bath's worth
instead of typing it.

```ts
// gone
let hottestC = 25; ... const runningHot = hottestC >= 100;
if (t === 'water' && runningHot) u += 2;

// now: two factors, both read from the sim
waterCoolingFactor()  // radiator channel in a water context vs the current one,
                      // x WATER_RADIATOR_MULT. Bare Gill 1.6x; Gill + Tidecooler
                      // 3.2x. This is what lets a *mod* move the decision.
waterGainDps          // (exchange with cones at ambient) - (exchange as they are),
                      // capped by that factor. Continuous, and zero on a cold
                      // mech -- which is the gate, derived, rather than 100 C.
```

**The canonical roster barely moves, which is the right outcome.** Terrain dwell
across every template pairing: water ratio 0.68 → **0.67**, hill 1.96 → 1.97,
forest 1.03 → 1.04. Those builds are cold, heat costs them nothing in dispersion,
so the bath is worth nothing to them and they correctly ignore it. A pilot change
that left every existing measurement alone is the cheapest possible version of
this fix.

**A hot mech now behaves completely differently.** `CH-5 W-KL:2 + Gill`, peak
117 °C, over the canonical roster: **17.5% of its time in water against a 4.4%
arena share** — a ratio of 4.0. The old constant produced 24.6% on the 6-seed
probe and the new one 25.5%, so the *seeking* was largely there before; what was
missing is below.

**The mod can move the decision now, and the movement is small.**

| | old (`u += 2`) | new (derived) |
|---|---|---|
| water dwell, no mod | 24.57% | 25.51% |
| water dwell, Tidecooler | 24.65% | 26.13% |
| **mod's influence** | **+0.08** | **+0.62** |

Eight times the influence, and still under a point. Honest reading: the mech was
already going to water whenever heat hurt, so there was little room for a mod to
increase the *incentive*. The fix removes the wrongness — a constant that no
content could reach — without by itself making the mod strong.

**Where the mod does pay is the physical effect, and it is large.** 20 seeds
against the whole roster, mean hottest-cell temperature *while wading*:

```
CH-5 W-KL:2   57.6 C  ->  45.4 C with a Tidecooler   (-12.2)
CH-9 W-KL:2   49.6 C  ->  40.5 C                     ( -9.1)
CH-2 W-KL:1   mod did not attach — the assembler placed no radiator it could ride
```

Win rate is unchanged on all three (95%, 91%, 47%) because these builds are
already saturated, so the cooling does not convert. **The mod is live and
measurable; whether it is worth a mod slot is a separate question this does not
answer.**

Note the CH-2 line. The probe reported `attached=n` and that is F18 working: a
mod that never legally attached measures identically to one that does nothing,
so the attachment is asserted rather than assumed. `coolantBath.test.ts` pins
both properties, including that assertion.

**Cost elsewhere.** `npm run verify` is green — 439 sim, 36 game, 209 web — and
reports *no* dominant perk combination, where docs/19 has long recorded one on
`mule-fever-cycle`. That may be this change or may be earlier work in this pass;
it is recorded, not investigated, and nothing was tuned or re-baselined.

### The sweep says the pilot fix changed nothing the breeder can see

`artifacts/coolant-derived.json` against `artifacts/mantle-12lock.json`, both at
hash **`60d47bd0`** — a true A/B of the pilot change, since `combat.ts`'s
controller body is not in the hash.

```
                 mantle-12lock      coolant-derived
emptyCells       4, all heavy       4, all heavy   (identical)
gallery          247                247
noiseBand        0.060              0.060
deadMods         ... tidecooler ... ... tidecooler ...   (identical)
coverage         U-RAD 11           U-RAD 13
                 tidecooler 0       tidecooler 0
```

**`tidecooler` is still dead.** The fix is real and measured — the mod's influence
on the decision went from +0.08 to +0.62 points of dwell, and it cools a wading
mech 9–12 °C — and none of that is enough to get it drafted.

**And the reason is one level up.** The breeder's builds are cold. Heat costs
them no dps, so a coolant bath is worth nothing to them, so a mod that improves a
coolant bath is worth nothing either. `tidecooler` is dead *downstream* of a
bigger fact: **nothing in this game wants to be hot.**

That is not a defeat for the fix — a constant no content could reach was worth
removing on its own terms, and it is what makes the next test meaningful. It is a
correction to the expectation. The prediction it sets up is explicit and testable:
**if heat ever becomes worth seeking, `tidecooler` should come alive without
being touched again.** F32 is that test.

**Also settled:** the four empty heavy cells are stable at this hash across two
independent runs, so they are a property of hash `60d47bd0` rather than run
jitter. With the earlier A/B ruling out the assembler fix, they belong to
`U-MANTLE`'s presence in the draw domain — the part or the re-roll it forces, which
F22 says cannot be separated. Recorded, not tuned.

## F32 — Nothing in the catalog pays above 100 °C, so the whole upper heat band is dead content

The hot band is 90–150 °C: dispersion climbing to ×1.5, fire-hold at 115,
shutdown at 130, HP damage at 150. Six of seven canonical templates never exceed
90 °C (peaks 34, 58, 62, 62, 88, 90); one reaches 116.

**Hypothesis.** The band is dead because every effect in it is a penalty, so
entering it is always a mistake, and "redliner" in the archive means "slightly
negative heat margin" rather than a build anyone chose.

**Measured, before authoring anything.** Evaluating every mod's `effectiveMults`
across 25–150 °C, exactly two vary with temperature at all:

```
fever-cycle   varies: cycleS            still varying above 100 C: NOTHING
cold-bore     varies: damage,dispersion still varying above 100 C: NOTHING
```

`fever-cycle` caps at 100 °C by construction (`Math.max(0.85, ...)`). `cold-bore`
switches off at 40. Every other mod, and every part, is temperature-blind. So
above 100 °C the catalog offers **nothing but costs**, and above 115 there is not
even a gradient — dispersion saturates and the guns are simply off. It is a cliff,
not a slope.

That is why `redliner` builds are accidents, why `tidecooler` has no customer, and
why the `redline` challenge's two unlock parts sit behind a condition almost
nothing meets.

### `annealed-bore`, and the prediction it got wrong

**Authored.** Tier 3, rides any weapon. Damage `+0.5%` per °C above 40 °C, and
the mount adds **1 kW of its own waste heat**. No cap is written: the fire-hold
threshold at 115 °C is the cap, which is what makes it a decision rather than a
curve — the bonus is largest exactly where the gun is about to stop firing, and
the heat it adds is what carries you there. Both channels (`damage`,
`extraHeatKw`) already existed and are consumed at shot resolution, so this is
numbers and combinations, not a new mechanic.

Sized against `fever-cycle`, the only other mod that pays for heat: same tier,
about +18% dps at 100 °C there against +35% damage at 110 °C here, in heat rather
than power. Deliberately smaller than the cone it widens — `heatDispersionMult`
reaches ×1.5 by fire-hold and the damage bonus reaches ×1.375, so it is a trade
and never a free upgrade. `annealedBore.test.ts` pins that inequality.

**Reachability.** Carrier: every weapon (`game:audit` clean). `MIDGAME_POOL.mods`
is derived from the registry, so it is drawable without an edit — the silent
sixth registration does not apply to mods. Attachment asserted on all twelve
probe builds rather than assumed (F18).

**Measured, 30 seeds, paired, attachment confirmed:**

```
build          peak C      mean C        win%
CH-2 W-KL:1   127 -> 128  102.9 -> 103.1   46 -> 58   (+12)
CH-5 W-AC:2    85 -> 101   42.8 ->  47.5   69 -> 71   ( +2)
CH-9 W-AV:1    57 ->  66   35.0 ->  38.4   21 -> 23   ( +2)
CH-5 W-KL:2   120 -> 121   66.1 ->  66.6   96 -> 97   ( +1)
CH-9 W-BR:2    58 ->  69   34.2 ->  37.6   29 -> 29   (  0)
CH-2 W-CB:2    58 ->  81   39.4 ->  49.5   95 -> 95   (  0)
```

**The prediction was wrong, and the way it was wrong is the finding.** I expected
a brawler's mod and a sniper's trap, on the reasoning that a wide cone is cheap
up close. What the data says is that **range barely matters and heat availability
is everything**: the only build it clearly pays on is `CH-2 W-KL:1`, a *long*-range
gun, and it pays because that build already lives at 103 °C mean and 127 peak. The
brawlers sit at 34–39 °C mean, where the bonus is a few percent.

And the carrier is a *frame* property as much as a gun one. Two Kilns on a Mule
run at 66 °C mean and gain +1; one Kiln on a Vulture runs at 103 °C and gains +12.
Same gun, opposite verdict, because the Mule has room to cool and the Vulture does
not. That is docs/20 §2's second signal — a part that makes a chassis want
something it did not want — arrived at from the wrong direction.

**What it does not do.** It rewards a build that was already hot; it does not by
itself make cold builds want to be hot. Every probe gained temperature (+1 kW
works) but none crossed from cold into the band. If the sweep leaves the archive
unchanged, that is the reason, and the honest next question is whether anything
short of a cooling *cost* can move a build across.

## F33 — `thermocouple-skin` is not dead gear either; it is live, weak, and conditional on two things that rarely coincide

Fourth dead lever examined, and the third that turned out not to be dead in the
way the report implies. Recorded because the brief says a failed hypothesis is a
result, and because it completes a pattern.

**The channel is live and it is not small.** `harvestsHeat` pulls
`THERMOCOUPLE_K × ΔT × efficiency` from the capacitor's own cells — 0.5 × 30 ×
0.5 = 7.5 kW at 30 °C above ambient. An early guess that capacitors cannot get
hot was wrong: `conductanceMult` defaults to 1 for every part, and
`transfersHeat` gates ports and coolant rather than the conduction grid, so a
capacitor heats by conduction like anything else.

**Placement is not the problem either.** The assembler puts the bank adjacent to
the reactor on CH-5 every time and on CH-9 sometimes; never on CH-2. So the
"wants to sit by the reactor" blurb is satisfied often enough to measure.

**Measured, 20 seeds, attachment asserted:**

```
build          mean stored kJ        mean C        win%
CH-2 W-LAS     21.30 -> 24.49  (+15%)  57.0 -> 55.8   12 -> 13
CH-5 W-RG       6.62 ->  6.89  ( +4%)  31.0 -> 31.1   20 -> 21
CH-5 W-LAS     48.80 -> 48.85  ( +0%)  48.8 -> 48.9    7 ->  7
CH-9 W-RG     116.04 -> 116.44 ( +0%)  39.7 -> 39.7   72 -> 72
```

It works, and the pattern is exact: **it pays only on a bank that is starved.**
Where the reserve already sits near full — 48.8 of 60, 116 of 200 — harvested
charge has nowhere to go and the mod adds nothing. Where the bank is empty it
adds 15% to mean stored charge and takes about a degree off the hull.

But a starved bank is usually starved for *power* reasons, not heat ones, and the
two conditions the mod needs — an empty reserve and a hot hull — rarely coincide.
Win rate moves by at most a point, inside the noise band.

**The pattern this completes.** Three of the six dead mods are dead for the same
upstream reason rather than for anything about themselves:

- `tidecooler` needs the pilot to value a coolant bath; it does not, because heat
  costs cold builds no dps (F31).
- `thermocouple-skin` needs a hot hull to harvest from; builds are not hot.
- `hull-down` needs standing still to be worth it; measured 0 at 20 seeds.

**None of them is a content gap.** They are all downstream of F32: nothing in the
catalog paid for being hot, so no build chose to be, so every mod keyed to heat
had no customer. `annealed-bore` is the first thing that pays above 100 °C, and
the prediction it sets up is now two mods wide: **if it moves builds into the
band, `tidecooler` and `thermocouple-skin` should improve without being touched.**
If it does not, the root is deeper than a missing reward and the next thing to
question is whether a build can reach the band at all while staying alive.

### The sweep: `annealed-bore` is taken 13 times, and the prediction it was carrying is wrong

`artifacts/annealed-12lock.json`, hash `f98aeecd`, same parameters. The hash moved,
so per F22 only build-level attribution is quotable.

```
                  annealed  coolant-derived
annealed-bore        13            0     <- build-level, quotable
tidecooler            0            0
thermocouple-skin     0            0
hull-down             0            0
emptyCells        4, heavy     4, heavy   (identical)
gallery             247          247
deadMods          4 mods       6 mods
```

**The mod is live and well taken.** 13 of 247 gallery builds carry it, which puts
it immediately among the most-drafted mods in the catalog — `insulated-mount`
sits at 19-20 and `ram-bore` at 16-21, and everything else is single digits. For
the mod itself the hypothesis holds: a reason to be hot was all that was missing.

**And the prediction recorded two commits ago is falsified.** I wrote that if
`annealed-bore` moved builds into the band, `tidecooler` and `thermocouple-skin`
should improve without being touched. They did not: both are still at zero, and
`hull-down` with them. `deadMods` did shrink from six to four, but the two that
left are `coil-sprung` and `gyro-flywheel`, neither of which is heat-keyed, and
`gyro-flywheel` left only by moving into `neverOffered` — draw luck at a new hash,
not a verdict.

**The reason is the onset, and it is a design error I can name precisely.** I
authored the bonus to start at 40 °C so it would be continuous. That makes it pay
*from warm*: a build sitting at 60-90 °C — which is most of them — collects
+10% to +25% damage without ever going near fire-hold. So the search takes it as
a mild damage buff on builds it was already going to make, and never has to
commit to the band. Measured directly on the probe builds: `CH-5 W-KL:2` spends
**0.1%** of its ticks above fire-hold and still takes the mod happily.

The thing it was supposed to create — a build that *chooses* 115 °C — exists on
exactly one frame, and only because that frame cannot cool: `sim:try` on
`CH-2 W-KL:1` reports "heat balance −9.7 kW, but no perimeter cell is left for a
radiator". There the trade runs the right way and is worth measuring:

```
                   >115 C ticks   shots/s   win%
CH-2 W-KL:1 plain      31.0%       0.23      46
CH-2 W-KL:1 anneal     32.9%       0.22      60
```

Its own +1 kW pushes it over the fire-hold threshold *more*, so it holds fire more
and fires less — and wins +14 anyway, because each shot lands harder. Fire less,
hit harder is exactly the decision this was for. It just happens on one build by
accident of geometry rather than by choice on many.

**Shutdown is still never reached.** 0.0% of ticks above 130 °C on every build
tested. So 115-130 is now inhabited, by one frame, and 130-150 remains dead.

**Verdict.** Keep — it is the most-taken thing this pass produced and the only
lever in the catalog that pays above 100 °C. But it does not do the job it was
authored for, and the reason is one authored number: **a heat mod's onset decides
whether it creates redliners or merely rewards warmth.** At 40 °C it is a stat
bump with a heat flavour. The experiment worth running next is the same mod with
its onset up near 90 °C, so that nothing collects it without committing — and
that is a re-author, not a tune, so it is recorded here rather than done
silently.

**Cost elsewhere.** Nothing measurable: `emptyCells` identical, gallery identical,
noise band identical, `verify` green, `game:audit` clean. Nothing tuned, nothing
re-baselined.

## F34 — The heavy cells at range are reachable and unwanted, so the gap is a reason and not a part

`mid/heavy/*` and `long/heavy/*` are the only cells that stay empty across
sweeps. They appear empty in all three runs carrying `U-MANTLE` and full in both
runs without it — but the hash differs between those groups, and F22 forbids
reading that as attribution. It is one draw domain against another, n = 1 each.

**Gate 6 first, as docs/20 §7 insists, and it settles the question.** Sweeping
every enabled gun × three counts × four ballast options across all three chassis:
**113 of 396 assembled builds land in mid/long + heavy.** The cells are trivially
reachable with parts that already shipped. So this was never a content gap in the
sense of "nothing can be built there".

**And the sweep shows why nothing wants to be.** Almost every reachable
mid/long-heavy build is a *Vulture* — the lightest frame — because the weight
bucket is `mass ÷ ratedMass`, so the cheapest way to be "heavy" is to overload a
scout. An overloaded scout is slow, and at range slow is fatal. Meanwhile every
heavy cell that *is* filled is close range, and for one reason: the only part
that makes a frame heavy by being worth carrying is the Anvil, and the Anvil is a
brawler's gun (F17/F22). **At range, mass has never bought anything.**

### `W-CV`, the Culverin — the Anvil's argument moved out to range

2×3, 900 kg, tier 4, 70 damage on a 6 s cycle, 3 mrad, ideal 70–140 m, and
**30 kN·s of recoil**. No draw, no companion part — deliberately not a
combination dependency (§7).

Recoil is the whole design and the sim already derives it: `combat.ts` kicks the
shooter by `recoilKnS / massT`, and that velocity feeds `weaponSigmaMrad`'s motion
term, so the kick widens the *next* shot's cone. **Mass buys accuracy without a
new rule to say so.** Measured, and it is self-correcting exactly as the Anvil's
comment predicts:

```
CH-9 W-CV:1 bare        load 0.58   kick 4.3 m/s
CH-9 W-CV:2 + 12 plate  load 0.94   kick 2.7 m/s
CH-5 W-CV:2 bare        load 0.75   kick 6.7 m/s
CH-5 W-CV:2 +  8 plate  load 0.85   kick 5.9 m/s
```

Adding armour makes the gun *more* accurate. That is the first time mass has paid
at range.

**Reachability.** Completes alone on CH-5 and CH-9, in all three wish orders.
**Refused entirely on CH-2** — a 2×3 does not fit a Vulture region — which is
deliberate and the same geometry gate `W-RG` uses. All six registrations done;
`weaponClass`, `powerBudget` and the enabled-part count all failed loudly first,
exactly as docs/20 §6 says they would.

**What moved.** `long/heavy/cold` is reached on both frames it fits: CH-5 at load
0.85, CH-9 at 0.94. `mid/heavy/*` and `long/heavy/redliner` are not — the
Culverin is cold (8 kJ/shot), so a redliner needs it paired with something hot.

### The swing, recorded and not tuned

`CH-9 W-CV:2 U-ARM:12` measures **99%** against the canonical roster at 20 seeds.
That is a dominant build and it is recorded here rather than nerfed.

**But the control matters and it is most of the story.** Same chassis, same
ballast, different gun:

```
W-CV:2  99%      W-KL:2  96%      W-RG:1  83%      W-AC:2  65%
```

A fortress Bastion is *already* a 96% archetype. The Culverin adds **+3** over the
best existing option, not 99 points of its own. The honest reading is that this
pass has surfaced a strong archetype rather than created one, and the thing worth
the owner's attention is the armoured Bastion, not only the new gun.

`verify` green (446 / 36 / 209), `game:audit` clean, nothing re-baselined.

### The other three heavy cells: reachable, strong, and still reported empty

Gate 6 again, this time on the cells the Culverin does *not* fill, and pairing
guns rather than sweeping them singly — a combination nothing proposes looks
identical to a combination that does not work (F19's lesson, one level up).
2,214 two-gun builds:

```
mid/heavy/cold        REACHABLE   CH-2 W-MG+W-LAS arm8
mid/heavy/redliner    REACHABLE   CH-2 W-MG+W-KL  arm8
long/heavy/redliner   REACHABLE   CH-2 W-CB+W-KL  arm8
```

**Every hit is on CH-2**, which is the same mechanism as before: the weight bucket
is a load *fraction*, so the Vulture is the cheapest frame to make "heavy".

The obvious next assumption is that those builds are junk, which is why the
breeder skips them. **It is wrong**, and this is the finding:

```
CH-2 W-MG+W-LAS arm8   mid/heavy/cold        19%
CH-2 W-MG+W-KL  arm8   mid/heavy/redliner    71%
CH-2 W-CB+W-KL  arm8   long/heavy/redliner   95%
```

**A 95% build exists in `long/heavy/redliner`, out of parts that shipped months
ago.** So that cell is not empty for want of content, and not empty because what
lives there is weak. It is empty because the search does not propose it — the
same class as F24, where `long/heavy/redliner` turned out reachable at rank 13
with existing parts and simply never offered.

`mid/heavy/cold` is the honest exception: its best reachable build measures 19%,
so that one may genuinely be a bad neighbourhood rather than an unexplored one.

**What this means for `W-CV`.** The Culverin's contribution is not "it filled an
unreachable cell" — nothing here was unreachable. It is that heavy-at-range was
only ever available by *overloading a scout*, and the Culverin makes it available
on a frame where being heavy is not suicide: CH-5 at load 0.85 and CH-9 at 0.94,
winning 86% and 99%. The cell was reachable; being heavy at range was not
*sensible*. That is a smaller and more accurate claim than the one I would have
made without gate 6.

**Recorded for the owner, not acted on:** three of the four "empty" heavy cells
hold builds of 71–95% that the breeder never proposes. If that is worth chasing
it is a search question — proposal, not content — and it is the third time this
pass that an empty cell turned out to be the instrument.

### The Culverin sweep: a successful gun that failed at its job, for a structural reason

`artifacts/culverin-12lock.json`, hash `5a3e6ae6`. Hash moved, so only
build-level attribution is quotable (F22).

**Build-level, and it is emphatic.** `W-CV` appears in **37 of 263** gallery
builds, coverage **53** — second only to `W-KL`'s 59, ahead of every other
weapon in the catalog. As a gun it is the most-adopted thing this pass produced.

**And it did not do its job.** `emptyCells` fell 4 → 2 (`mid/heavy/cold` and
`long/heavy/cold` filled), which looks like the intended result and is not:

```
long/heavy/cold   2 builds, both CH-2 W-SR R-C40 P-CAP     carrying W-CV: 0
mid/heavy/cold    1 build,  CH-2 W-LAS + 8 plates          carrying W-CV: 0
```

**Not one newly-filled heavy cell contains a Culverin.** They are Vultures with
ballast — precisely the builds gate 6 already showed were reachable, found by a
different draw domain. The cells filled; the gun did not fill them. Where `W-CV`
actually lands is `long/light/cold`, `long/medium/cold`, `mid/medium/cold`.

### Why it cannot fill a heavy cell, and it is the axis, not the gun

The weight bucket is `mass ÷ ratedMass`, and rated mass differs by a factor of
four:

```
CH-2 Vulture   rated  3 t   heavy needs > 2.4 t of parts
CH-5 Mule      rated  6 t   heavy needs > 4.8 t
CH-9 Bastion   rated 12 t   heavy needs > 9.6 t
```

Gallery weight buckets by chassis:

```
CH-2   light 28   medium 26   heavy 4
CH-5   light 59   medium 53   heavy 3
CH-9   light 66   medium 24   heavy 0
```

**The Bastion has zero heavy builds in ninety entries, and reads mostly *light*.**
The biggest chassis in the game can essentially never be "heavy", because heavy
means *overloaded* and a 12 t rating is very hard to overload.

So the Culverin — a gun designed so that hull mass tames its recoil, i.e. a
Bastion gun — **cannot contribute to a heavy cell by construction**. It was
authored against a goal function that its target chassis cannot reach. That is
not a fact about the gun and it is not a fact about the Bastion; it is a property
of the axis, and it is the fourth time this pass that the instrument turned out
to be the thing under measurement.

**What this means for docs/20 §2.** The weight axis does not express "this is a
big mech". It expresses "this frame is overloaded", and the largest frame is the
one that cannot be. One third of the archive's weight axis is effectively
unreachable on one third of the chassis, so "fill the empty cells" is a skewed
goal function — it systematically directs content at light frames carrying
ballast. Recorded for the owner; changing a bucket rule is a design decision.

**Verdict on `W-CV`.** Keep. It is drafted more heavily than anything else this
pass produced and it does what its comment claims — mass buys accuracy, measured
at 4.3 → 2.7 m/s of kick under twelve plates. But the cell it was authored for
was the wrong target, and the honest description is "a strong long gun that wants
a heavy frame", not "the part that fills `long/heavy/*`".

**Cost elsewhere, recorded not tuned.** At the new hash: `W-AV` 58 → 24,
`W-RG` 2 → 0 and now in `deadParts`, `annealed-bore` 13 → 4, `U-ARM` 71 → 112.
All of it hash-confounded and none of it attributable, but the Longshot going to
zero is worth a look in a deliberate balance pass. `verify` green, `game:audit`
clean, nothing re-baselined.

## F35 — A reward cannot make a build hot, and the stamp could not see the number that proved it

Two findings, and the second was only reachable because the first one failed.

### The onset experiment, pre-registered and falsified

F32 left an explicit next step: `annealed-bore` pays from 40 °C, so a build at
60–90 °C collects most of the bonus without approaching the band, and the onset
rather than the magnitude might be what decides whether a heat mod creates
redliners. Tested by moving the onset to 90 °C and the rate to 0.015 — **the peak
held identical at ×1.375 by fire-hold**, so the only variable was the shape.

```
build              plain   onset 40   onset 90
CH-2 W-KL:1  (103 C mean)    46%    58% (+12)   51% (+4)
CH-5 W-KL:2   (65 C mean)    95%    96% ( +1)   95% ( 0)
CH-2 W-CB:2   (39 C mean)    94%    94% (  0)   94% ( 0)
```

**Worse everywhere, including on the build that lives in the band**, and no build
moved into the band that was not already there. The reason is simple once seen: a
mech running at 103 °C mean collects on the curve *where it sits*, not at its
peak, and 90 °C onset gives ×1.195 there against the old ×1.315. Holding the peak
constant held the wrong thing constant.

**The general lesson, which is worth more than the mod.** A reward changes which
builds *take* a mod; it never changes which builds *run hot*. Heat is set by the
gun, the frame and the cooling — a damage mod touches none of the three, and its
own +1 kW is a rounding error against a Kiln's 15. If the upper band is to be
inhabited on purpose, the lever is cooling capacity or a survivable threshold,
not a bigger prize for being there. **Reverted**; the shipped mod is the 40 °C
version, which is drafted 13 times and honest about what it is.

### The stamp did not move, and that is a hole in every A/B in this file

Both variants — a change that halves what the mod is worth on the one build that
lives in the band — stamped **the same content hash, `5a3e6ae6`**.

`simContentHash()` hashes `PARTS`, `CHASSIS`, `TEMPLATES`, a modifier fingerprint
and a dial list. The fingerprint records `apply.toString()`, which captures the
*name* of a constant and never its value, and the mod thresholds were not in the
dial list. So `COLD_BORE_MAX_C`, `FEVER_CYCLE_MIN_C`, `HULL_DOWN_MAX_MPS` and
both `ANNEALED_BORE_*` constants were invisible to the stamp: **two materially
different games hashed identically.**

This is the mirror of F20. There the hash moved when the content had not
(source against compiled). Here the content moved and the hash did not, which is
the more dangerous direction — F20 costs you a false alarm, this costs you a
false *equality*, and every A/B in this pass rests on two reports sharing a stamp
meaning they describe the same game.

**Fixed**: the five thresholds are in the dial list. Verified deterministic —
onset 40 hashes `aa0a8f95`, onset 90 hashes `4d372e4c`, reverting restores
`aa0a8f95`.

**The rule this implies, for anyone authoring a mod:** any constant referenced
inside an `apply` body must be added to `version.ts`'s dial list at the same
time. The fingerprint will not catch it, and nothing else will either.

**Cost, and it is real.** The hash re-bases: identical content now stamps
`aa0a8f95` where it stamped `5a3e6ae6`. `artifacts/culverin-12lock.json` carries
the old stamp and describes exactly the content that now hashes `aa0a8f95`; that
mapping is recorded here because the stamp can no longer state it. Every other
artifact on file predates this and compares only among itself, which was already
true across content changes.

## F36 — Cooling was gated by one part's footprint, and making it available made heat *less* of a decision

Five attempts to make the upper heat band a choice had failed (F31–F33, F35), and
the diagnosis was that the band is a survivability problem. This is the test of
that, and it produced the opposite of the intended result — which is the finding.

**Hypothesis.** Hot builds exist only by accident, on frames that physically
cannot fit the one radiator in the catalog, so cooling is not a *choice*
anywhere and "redliner" is a geometry failure rather than a design space.

**Measured first.** The Gill is `line(3)` and `perimeterOnly`.

```
CH-2 W-KL:1   free perimeter cells: 1    radiators fitted: 0
CH-5 W-KL:2   free perimeter cells: 2    radiators fitted: 2, still -10.6 kW
```

The build that spends **31% of its life above the fire-hold threshold** has
exactly one free perimeter cell and needs three contiguous. The Mule has two free
perimeter cells and cannot use them because they are not adjacent. In both cases
the binding constraint is a *footprint*, not skin.

**And the catalog could not hold a second radiator.** "Radiator" was
`def.id === 'U-RAD'` in **eight** places — simulation, thermal, modifiers,
validation ×2, derivedStats, combat, workbench. That is the pattern `types.ts`
says `fireControlLateralMult` exists to have replaced. Owner approved a declared
field; `radiatorStrength` now carries it, the Gill declares 1, and the Gill's
derived heat margin is byte-identical before and after (`CH-5 W-AC:2`: power
+0.2 kW, heat +7.2 kW, both).

**Two of the eight sites were found late and both were quiet.** A grep for
`def.id === 'U-RAD'` missed `getPart(p.partId).id !== 'U-RAD'` in `derivedStats`
and in `combat`. The `derivedStats` one is the instructive failure: four Vents
placed legally on a build that could not fit a Gill and **the heat margin did not
move a single kW**, so the readout lied to the player and the completer never
counted the cooling it had just added. The symptom was a number that stayed
still, which is the hardest kind to notice.

**Authored.** `U-VENT`, "Vent (louvre)": 1 cell, perimeter-only, 45 kg, 12 HP,
tier 1, `radiatorStrength` 0.45. Deliberately the worse deal per cell — three
Vents are 1.35 strength for three cells against the Gill's 1.0 for three — so the
Gill stays correct wherever three in a row exist. What the Vent buys is not
efficiency but the ability to cool at all on a fragmented perimeter.

**Reachability.** Completes alone on all three chassis; order-independent
(3/3/3, 1/1/1, 1/1/1). `RADIATORS()` in the completer now tries strongest-first
and falls back, so a Vent is reached for when a Gill will not fit — without that,
the part would have been unreachable by every search, which is F29 exactly.

### It worked, and that removed the only redliner in the game

```
CH-2 W-KL:1   before   long/heavy/redliner   uncoolable, 31% of ticks above fire-hold, 46%
CH-2 W-KL:1   after    long/medium/cold      +5.6 kW margin, three Vents fitted, 54%
```

**The build got better by 8 points when it stopped being hot.** So the redliner
was never an archetype, it was a handicap — and `assembleBuild` treats a negative
heat margin as a fault to fix, so handing it a radiator that fits means it now
fixes builds it previously could not. **Making cooling available made heat less of
a decision, not more.**

That is visible in a canonical reference too: `CH-2 W-MG:2` was
`close/light/redliner` and is now `close/medium/cold`, and the descriptor distance
between the archive test's two reference builds fell 0.60 → 0.25. The test was
rewritten to assert the property on constructed descriptors rather than on
whatever the completer happens to produce, because it was measuring assembly
rather than the distance function, and any future cooling part would break it
again.

**Verdict.** Keep the part and the field — cooling is a design space now instead
of one shape, and eight hardcoded id checks are gone. But the heat thread's
conclusion is now the opposite of where it started: **heat is not an
under-rewarded choice, it is a state builds are in when they cannot help it, and
the completer removes it whenever it can.** Making the band a real decision needs
the completer to *want* to leave a build hot — which is a fitness question, not a
content one, and not mine to take.

**Cost elsewhere.** `verify` green (447 / 36 / 209), `game:audit` clean. Redliner
builds should become rarer across the archive; that is a prediction and the sweep
below tests it. Nothing tuned, nothing re-baselined.

### F34 addendum — the Culverin's mechanism, measured with a control

F34 claimed "mass buys accuracy" from reading the code path and measuring the
*impulse* (4.3 → 2.7 m/s of kick under twelve plates). It never measured the
accuracy. That gap is closed here, and the claim survives — but only because the
control was run.

One chassis, one gun, mass as the only variable, with a zero-recoil gun given the
identical treatment:

```
                       massT   kick m/s   shots   hit%
CH-9 W-CV x2  bare      5.75      5.22     1190   52.0
CH-9 W-CV x2  + 8       6.90      4.35     1166   52.6
CH-9 W-CV x2  +35      11.25      2.67     1042   55.6

CH-9 W-KL x2  bare      4.85      0.00     1542   69.9   <- control, no recoil
CH-9 W-KL x2  +15       6.94      0.00     1623   69.2
CH-9 W-KL x2  +37      10.29      0.00     1688   68.5
```

**Hit rate rises monotonically with mass on the recoil gun (+3.6 points across a
doubling) and *falls* slightly on the control (−1.4).** So mass by itself does not
buy accuracy — if anything it costs a little — and the difference-in-differences
of roughly five points is the recoil term, isolated. The mechanism is real and it
is modest, which is the honest size to quote.

**And the mod that looks made for it makes it worse.** `gyrostabilized` scales
own-motion aim jitter ×0.4 for 15% more weapon mass — apparently exactly the
Culverin's problem — and measures **96% → 90%** on `CH-9 W-CV:2` and 99% → 97% on
CH-5, at 20 seeds. Recorded rather than explained: the pairing that reads as
obviously correct is measurably wrong, which is worth knowing before anyone
bundles the two into a unique. That was the unique I was about to author, and
uniques.ts's own rule stopped it — a unique that is only *worse* than its stock
part is not identity either.

## F37 — `W-ION` cannot score well no matter how it is designed, because the panel it is measured against carries no capacitors

Ninth lever examined, and it is dead for a reason that is neither the gun nor the
search: it is the fitness function.

**Hypothesis.** `W-ION` is dead because `capDrainKj` attacks a subsystem almost no
build carries, so a system-attacking weapon is a counter with nothing to counter.

**The panel, measured.** `stamp.fullPanel` is seven canonical templates, and
capacitors are in exactly one of them:

```
vulture-skirmisher  0 caps      mule-laser-boat  0 caps
mule-gunline        0 caps      railgun-mule     3 caps, 180 kJ
mule-skirmisher     0 caps      vulture-sniper   0 caps
bastion-tank        0 caps
```

**And the win rates track it exactly.** `CH-5` with two guns, 20 seeds, against
each panel member, with `W-LAS` as the control — same chassis, same slot, an
energy gun with no system attack:

```
opponent             caps   W-ION   W-LAS
vulture-skirmisher     0      0%     20%
mule-gunline           0     10%     85%
mule-skirmisher        0      5%     70%
mule-laser-boat        0      0%     55%
railgun-mule           3     35%     50%
vulture-sniper         0      5%     25%
bastion-tank           0      0%     80%
```

The ion's best matchup by a factor of three is the only opponent with a bank to
drain, which is the identity working. It is also the *only* matchup where the ion
outperforms the laser's relative standing. Everywhere else it is 0–10% against
the control's 20–85%.

**So the design is legible and the gun is still bad**, because its ceiling is set
by panel composition rather than by its own numbers. Fitness here is "win against
these seven", so a counter-weapon's score is bounded by how much of the panel it
counters — one seventh — and even that matchup loses at 35%.

**Nothing I can author fixes this.** Rebalancing `capDrainKj` upward would make
the ion dominant against `railgun-mule` and still useless against six others; the
distribution would get more extreme, not more interesting. A counter in a fixed
metagame is either dead or degenerate, never a decision.

**What would**, and both are the owner's call:

- **A second capacitor-carrying template on the panel.** Two of seven is still a
  read on a niche, but it makes the ion a gamble rather than a coin already
  flipped. `railgun-mule` is the only cap-fed build on the panel and `W-SR`,
  `P-CAP2` and the whole cap-fed class exist to be built from.
- **Or a floor that lands on any target.** `W-SC` is the worked example of the
  other shape: `enemyHeatKj` 6 on a 0.4 s cycle is **15 kJ/s**, and every build
  has a thermal system to push on, so the flamer's system attack always does
  something. The ion's does not.

Recorded rather than acted on: changing the panel changes every fitness number in
this file, and it is a measurement decision rather than a content one.

## F38 — The pilot is in transit 93% of the time, so every mod keyed to standing or orbiting is keyed to 7% of the fight

**Hypothesis, and it was wrong.** I expected `weaving-gait` and `hull-down` to be
dead because they shift the payoff of a trade the autopilot already optimises —
orbit versus hold — so the pilot re-optimises and absorbs them. Measured on
`CH-5 W-AC:2 U-ARM:1`, 20 seeds:

```
mod             hold%  orbit%  close%  retreat%   win%
none              8.2     0.4    63.8      27.6     69
weaving-gait      8.8     0.2    62.3      28.7     69
hull-down         7.7     0.4    66.5      25.4     76
coil-sprung       7.2     0.9    62.8      29.0     71
```

The intent mix barely moves, so the pilot is *not* re-optimising around them. The
hypothesis is false. What the table shows instead is the real thing, and it is
much larger.

**Measured across every template pairing, 290,676 mech-ticks:**

```
move intent                    throttle
  close      50.97%              cruise      81.56%
  retreat    41.82%              flank       12.23%
  hold        6.21%              stationary   6.21%
  orbit       1.00%
```

**The pilot spends 92.8% of the fight travelling** — closing or giving ground —
and the stand-still-versus-orbit decision, which `combat.ts` computes with three
separate exchange evaluations (`holdU`, `orbitCruiseU`, `orbitFlankU`), governs
7.2% of it and picks orbit in **1.00%**.

### What this explains

- **`hull-down`** pays below 1.5 m/s. The mech is on a stationary throttle 6.2% of
  the time. Its condition is open for a sliver of the fight, and its measured
  effect is correspondingly unstable: **+7 here and 0 on the `sim:try` build**,
  at the same 20 seeds — build-dependent noise, not a verdict either way.
- **`weaving-gait`** pays above 4 m/s and reads **exactly neutral**, 69 against 69.
- **`coil-sprung`** buys down mech-wide move jitter, which applies while moving —
  93% of the fight — and it is the one of the three that left `deadMods` in a
  sweep. That is consistent, and it is the design rule this finding gives:

> **A mod keyed to a movement *state* is keyed to a sliver. A mod keyed to
> movement *itself* is on almost always.** Standing still and orbiting are 7% of
> the game between them; travelling is 93%.

### The larger question, for the owner

Stand-and-shoot essentially does not happen. That is why `MOVE_JITTER_MRAD_PER_MPS`
at 0.75 mrad per m/s is such a dominant accuracy term — nearly every shot in the
game is fired while moving — and it is worth deciding whether perpetual transit is
the intended shape of a fight. It is not a balance number and not a content gap;
it is what the four verbs actually do, and three mods were authored against the
7% rather than the 93% without anyone having measured the split.

Recorded rather than acted on: changing how much the pilot stands is a pilot
decision, and F31 showed how far those reach.

### F36 addendum — the prediction was wrong, and it narrows the finding

`artifacts/vent-12lock.json`, hash `11f62676`. Hash moved, so build-level only.

**`U-VENT` is drafted: coverage 12** in 267 gallery builds, beside the Gill's 12.
So the part is reachable and chosen, and the `radiatorStrength` refactor carries
it end to end.

**The recorded prediction — that redliner builds would get rarer — is false.**

```
redliner builds   108 (with Vent)   vs   110 (without)
emptyCells        mid/heavy/redliner, long/heavy/redliner   — identical
```

Unchanged. And the reason corrects something I over-claimed above: F36's heading
says the Vent "removed the only redliner in the game". It removed the redline from
**one build** — `CH-2 W-KL:1`, the one I had been measuring — and that build was
the only redliner among the seven *canonical templates*. In the archive, redliner
is **40% of all builds** (108 of 267) and always has been. It is not a rare state
the game struggles to produce; it is the normal state of a build that would rather
spend cells on guns than on cooling.

So the correct version of F36's conclusion is narrower and less dramatic. Cooling
being available does not make builds cold: the breeder takes the Vent when it is
worth cells and mass and declines it otherwise, which is exactly what a working
option looks like. What the Vent fixed is that on a fragmented perimeter there
was previously **no option at all** — the completer had to give up, and the
readout could not even see the cooling if you added it by hand.

**The heat thread's conclusion stands, on better evidence.** Heat is not an
under-rewarded choice. It is a *priced* choice that 40% of builds decline, and
five attempts to reward it more (F31–F33, F35) moved nothing because the price,
not the prize, is what they were declining.

**Swing, recorded not tuned.** `annealed-bore` fell 4 → 0 and is now in
`deadMods`; at two hashes ago it was 13 of 247. `W-CV` 53 → 32, still heavily
used. `U-HS` 3 → 8. All hash-confounded and none attributable, but the mod
going to zero is worth a look in a deliberate balance pass.

## F39 — The 93% lever has no headroom, so the part I was about to ask for should not exist

F38 established that the pilot travels 93% of the fight, which puts own-motion
jitter in nearly every shot. The obvious content that follows is a *part* that
buys it down: the only existing answers are mods (`gyrostabilized` per-weapon,
`coil-sprung` mech-wide), and they compete for the one-mod-per-part slot, so
"spend cells on stability" is a decision the game cannot express. That needs a
`PartDef` field, like `fireControlLateralMult` before it, and I was about to ask.

**Measured the ceiling first, and it is not worth a mechanic.** Stacking both
jitter mods approximates "shoot as if standing still". 30 seeds, whole roster,
attachment asserted:

```
build            gun mod         frame mod      shots   hit%   win%
CH-5 W-AC x2     -               -              24386   69.6    69
CH-5 W-AC x2     -               coil-sprung    24472   71.4    71
CH-5 W-AC x2     gyrostabilized  coil-sprung    24776   73.3    71

CH-2 W-CB x2     -               -              28438   77.3    95
CH-2 W-CB x2     -               coil-sprung    27996   78.7    96
CH-2 W-CB x2     gyrostabilized  coil-sprung    28649   78.4    97

CH-9 W-BR x2     -               -               5479   94.5    29
CH-9 W-BR x2     -               coil-sprung      5472   94.1    27
CH-9 W-BR x2     gyrostabilized  coil-sprung      5464   94.1    25
```

**The whole lever is worth about ±2 win points**, and on the Bastion it goes
*negative* — 29 → 25 with both mods fitted. Hit rate barely moves either: +3.7
points at best, −0.4 at worst, from a change that should be the difference
between shooting on the move and shooting from a standstill.

**Two reasons, and the second is the interesting one.**

- Hit rates are already high — 69% to 94% — so there is little room above them.
  A lever that applies to 93% of shots is still bounded by how many of those
  shots were missing.
- **The pilot prices jitter when it chooses speed.** Cheaper jitter makes moving
  cheaper, so it moves more and spends the gain. That is the absorption mechanism
  I hypothesised in F38 and failed to find for `hull-down` and `weaving-gait` —
  and it failed there for a good reason: those are keyed to *states* the pilot is
  barely ever in. Here, where the effect is always on and directly inside the
  exchange arithmetic, absorption is exactly what the Bastion row looks like.

**Verdict: do not author, and do not ask.** The field would be real work, a
permanent schema addition and five call sites, in exchange for a lever whose
measured ceiling is smaller than `sim:try`'s noise band (F30). Frequency is not
importance — I nearly authored a part on the strength of "it applies 93% of the
time" without ever asking how much it was worth when it applied.

**Cost elsewhere.** None: nothing was authored and no file changed but this one.

## F40 — Hit rate anti-correlates with winning, because what a slow frame pays for reach is measured in damage taken

Chasing a number left over from F39: `CH-9 W-BR:2` hits **94.5%** of its shots and
wins **29%** of its fights. That should not be possible unless accuracy is not the
thing.

**Hypothesis.** The Bastion loses despite near-perfect accuracy because it cannot
reach its band — it is the slowest frame in the game and 92.8% of a fight is
transit (F38), so a short-range gun means being shot for most of it.

**Measured.** Same chassis, two guns each, 20 seeds, whole roster, ordered by the
gun's maximum range:

```
gun     ideal band    max   shots/fight  hit%  dealt  taken  ratio  win%
W-BR         0-15      45         27.6  94.9    276    775   0.36    29
W-AV         0-30      60         13.4  81.0    190    745   0.26    21
W-AC        20-50     150        153.8  64.9    358    369   0.97    66
W-KL       90-160     300         23.6  67.7    425    153   2.78    91
W-CV       70-140     240         16.5  52.4    382     74   5.18    96
```

**Hit rate runs backwards.** The most accurate gun on the frame wins least; the
least accurate wins most. And the thing that actually moves is **damage taken**:
775 → 745 → 369 → 153 → 74, monotonic in reach. Damage *dealt* barely varies
(190–425). The Bastion is not out-damaged because it misses. It is out-damaged
because a short gun makes it spend the fight being shot on the way in.

**So hit rate is a misleading quality signal**, and it is the one a reader reaches
for first. Anything that measures a gun by how often it connects will rank
`W-BR` top of this table and it is last by every measure that matters.

**No content follows, and that is the verdict.** The obvious reading — "the
Bastion has no viable armament" — is false: `W-KL` already gave it 91% before this
pass began, and `W-CV` adds five points on top. The frame was served; what was
missing was anyone having written down *why* its close-range builds fail. They
fail for a reason that is structural and not fixable with a better brawling gun:
on a frame this slow, reach is a defensive stat.

**It also qualifies gate 9.** docs/20 §7's ninth check asks whether an empty cell
holds a strong build. The converse is equally true and this table is the evidence:
`close/heavy/cold` and `close/heavy/redliner` are *filled* cells, and what fills
them measures 21–29%. **The archive is a coverage metric and says nothing about
quality in either direction** — an empty cell can hold a 95% build (F34) and a
filled one can hold a 21% build. Read the fitness, never the occupancy.

## F41 — `U-DRIVE`, and speed buys shooting time rather than safety

F40 left a filled cell full of weak builds: `close/heavy/*` is occupied, and what
occupies it measures 21–29%. docs/20 §2 counts "lets a filled cell be won a
different way" as interesting, and F40 named the failure precisely — a Bastion
with a 45 m gun takes 775 damage and deals 276.

**Hypothesis.** Close-range builds fail on the slowest frame because they spend
the fight being shot on the way in, so the lever is time-to-contact, not more
armour — armour is mass, and mass makes the approach longer.

**Authored.** `U-DRIVE`, "Bound (sprint drive)": 2×2, 480 kg, 12 kW,
`speedMult` 1.35 against the Stride's 1.15. `resolveSpeedMultiplier` takes the
max rather than the product, so it supersedes a Stride instead of stacking, and
the decision is which to carry. The mass is what aims it: 480 kg against a
Vulture's 3 t rating is a load-factor event on a frame that is already fast;
against a Bastion's 12 t it is nearly free on the frame that cannot close. Same
self-selection the Culverin gets from recoil, from the other end.

**Reachability.** Completes alone on all three chassis, order-independent
`[1,1,1]` in every case. All six registrations; the enabled-part count failed
loudly first as usual.

**Measured, 20 seeds, whole roster, fitting asserted:**

```
build                fwd   dealt  taken  ratio  win%
CH-9 W-BR x2         4.6     276    775   0.36    29
CH-9 W-BR x2 +drive  6.2     337    702   0.48    46   (+17)
CH-9 W-AV x2         4.6     190    745   0.26    21
CH-9 W-AV x2 +drive  6.2     235    732   0.32    31   (+10)
CH-9 W-AC x2         4.6     358    369   0.97    66
CH-9 W-AC x2 +drive  6.2     393    321   1.22    74   ( +8)
CH-9 W-CV x2         4.6     382     74   5.18    96
CH-9 W-CV x2 +drive  6.2     397     45   8.81    99   ( +3)
```

**The gain is inversely proportional to the gun's reach** — +17 on the 45 m gun,
+3 on the 240 m one — which is the hypothesis exactly, and the first thing this
pass has authored that lands where it was aimed.

**But the mechanism is not the one I proposed.** Damage taken falls only 775 →
702, about 9%. Damage *dealt* rises 276 → 337, about 22%. So most of the win comes
from arriving sooner and therefore **shooting for longer**, not from being shot
less on the way. Speed buys shooting time more than it buys safety, and I would
have written the opposite without the two columns side by side.

### The wrong answer is real, and it costs 20 points

```
CH-5 W-BR x2         6.9     320    367   0.87    54
CH-5 W-BR x2 +drive  9.3     263    376   0.70    34   (-20)
```

On a Mule the Bound is a **trap**. `sim:try` says why without being asked: fitting
it takes the energy margin to −15.2 kW, and the completer answers with a second
reactor whose mass then browns the build out — "19 more [plates] came back off;
their mass browned the build out". A 6 t frame cannot pay 480 kg and 12 kW at the
same time, so it buys speed and loses power. That is docs/20 §2's third signal —
a decision with a wrong answer — and it is a 20-point wrong answer, which is the
size that makes a decision worth having.

**Verdict.** Keep. It does the job it was aimed at, on the frame it was aimed at,
and punishes the frame that cannot afford it. Note the honest limit: +17 takes
`CH-9 W-BR:2` from 29% to 46%, which is better and still losing. Close range on
the slowest frame is improved, not solved, and F40 says why — reach is a
defensive stat and no amount of speed makes 45 m into 240.

**Cost elsewhere.** `verify` green (447 / 36 / 209), `game:audit` clean. Nothing
tuned, nothing re-baselined. Sweep below.

### F41 addendum — the drive is drafted, and not for what it was built for

`artifacts/drive-12lock.json`, hash `e0cae51b`. Build-level only.

```
U-DRIVE coverage 7, in 6 gallery builds
close/* builds: 101, of which carrying U-DRIVE: 2
the six: CH-5 close/medium/redliner, CH-5 long/medium/cold, CH-5 close/medium/cold,
         CH-5 mid/medium/cold, CH-9 mid/light/cold, CH-9 mid/medium/cold
```

**It is taken, and it is not taken for the job it was designed for.** Two of 101
close-range builds carry it, and none of the six that do are `close/heavy`.

**The reason is that selection is comparative, and this is the lesson.** The drive
does exactly what F41 measured — +17 on `CH-9 W-BR:2` — but that takes the build
from 29% to 46%, and 46% does not survive a screen against builds at 90%+. A part
that rescues a losing archetype does not get drafted unless the rescue clears the
*competitive* bar, not merely the improvement bar. **Improving a bad build by 17
points is invisible to an instrument that keeps the best one.**

That is worth stating plainly for the next pass, because it applies to every
"fill this weak corner" idea: an archetype has to end up competitive, not just
better, or the search will never show you it improved. Hand-built probes and the
breeder answer genuinely different questions here, and both answers are true.

**Swings at the new hash, confounded and untuned.** `W-AV` 12 → 33, `W-BR` 20 → 6,
`U-VENT` 12 → 1, `U-ARM` 104 → 64, `W-CV` steady at 53. `emptyCells` back to four
from two. `deadParts` gains `U-RISEL` and keeps `W-RG`.

## F42 — `Winterbourne`, designed by measurement, and the three mods that measured as literally nothing

Uniques are what docs/20 §4 calls the cheapest identity available — part + mod +
variant + quirks, no new rules. This pass had already killed one unique before
naming it (F34's addendum: `gyrostabilized` on the Culverin measures −6), so this
one was measured component by component before any of it was written down.

**Every candidate mod, on a bare `CH-9 W-CV:1`, 20 seeds:**

```
mod              shots  hit%   dealt  taken   win%
none              1503  61.9     375    289     81
cold-bore         1479  61.4     390    215     92
ram-bore          1503  61.9     375    289     81
insulated-mount   1504  61.9     376    289     81
surge-gate        1503  61.9     375    289     81
```

**Three of the four are byte-identical to the baseline, down to the shot count.**
Overkill carry, insulation and surge priority are each conditional on a state a
cold long gun never enters, so they are not weak here — they are *exactly*
nothing. That is F18's "+0.0 reads like an effect that does nothing" seen at
whole-battle determinism, and it is a useful screening trick: **run the candidate
and diff the shot count. Identical means inert, and no amount of seeds will
separate it.**

`cold-bore` is +11 because the Culverin runs at **30.9 °C** and sits under the
40 °C threshold **100% of the time** — a long gun with an 8 kJ shot is the ideal
carrier for a mod that pays for being cold.

**The first cost was wrong, and by a lot.** `cold-bore + hot-running` with a
`cycleS ×1.2` variant measured **67% against the stock part's 80%** at 30 seeds.
Rate of fire is the wrong thing to tax: 2248 shots fell to 1910, the enemy lived
longer, and damage taken went 281 → 421. Costs that do not touch output work:

```
stock Culverin       80%
cold-bore only       88%
disp ×0.85, hp ×0.8  82%
disp ×0.85 only      86%
dmg ×1.1, hp ×0.75   82%   <- taken 196, lowest of any variant
```

**Shipped:** `cold-bore` + `hot-running`, variant `{damage 1.1, hp 0.75}`. Net
**+2 on stock** — a gift genuinely paid for rather than a straight upgrade — with
three tensions in one object: it hits harder, it dies faster, and `hot-running`'s
+1.5 kW heats it out of its own accuracy window a third of the time (measured:
100% → 67% of ticks below 40 °C).

**Reachability.** Assembles through the real wish path on CH-9 and CH-5 and is
recognised by `identifyUnique` as *Winterbourne*, which is how the workshop names
it. Refused on CH-2 — the Culverin's 2×3 does not fit a Vulture region, the same
geometry gate `W-RG` uses, inherited rather than restated. Uniques sit outside
`simContentHash()` and outside `MIDGAME_POOL`, so build-level measurement is the
only instrument that applies and no sweep is owed.

**Final measurement, 30 seeds, through the real path:**

```
stock Culverin   2248 shots  62.8% hit   377 dealt  281 taken   80%
Winterbourne     2009 shots  61.6% hit   383 dealt  196 taken   82%
```

**Verdict.** Keep. Fewer shots, slightly worse hit rate, marginally more damage
dealt, and a third less damage taken — because harder hits end fights sooner. It
reads differently from the gun underneath it, which is the whole point of the
layer, and it is +2 rather than +11 because the cost is real.

**Cost elsewhere.** `verify` green (447 / 36 / 209), `game:audit` clean. Nothing
tuned, nothing re-baselined, no sweep displaced.

## F43 — `ram-bore` writes to a channel nothing reads, and coverage cannot tell a good mod from a harmless one

**Hypothesis, and it was falsified before it got interesting.** F42's screening
trick — run the candidate and diff the outcome — suggested the machinist might
offer mods that are inert on their carriers. Checked exhaustively: across
**177 offered (mod, carrier) pairs**, evaluating `effectiveMults` over a grid of
temperature, speed and tile, **zero are statically inert**. Every mod the
machinist offers changes some number on every carrier it is offered on. Good news,
and it sharpens the question rather than answering it.

**Statically live is not dynamically live.** On an ordinary `CH-5 W-AC:2` build,
diffing full battle outcomes over 12 fights, **5 of 14 mods produce bit-identical
battles**: `tidecooler`, `gyro-flywheel`, `ram-bore`, `surge-gate`,
`thermocouple-skin`. The mod changes a number; the number is never consumed
because the build never enters the state.

Retried on carriers where each condition should actually arise:

```
thermocouple-skin  CH-2 W-LAS  live       starved bank (F33)
gyro-flywheel      CH-2 W-CB   live       fast turner, 167 deg/s
surge-gate         CH-5 W-RG   IDENTICAL  cap-fed gun that can brown out
ram-bore           CH-9 W-CV   IDENTICAL  70 damage a shot
ram-bore           CH-9 W-BR   IDENTICAL  40 damage a shot
```

### `overkillCarry` is written and never read

```
modifiers.ts:61   overkillCarry: number;              declaration
modifiers.ts:113  overkillCarry: 1,                   neutral
modifiers.ts:158  overkillCarry: {kind:'pooled', …}   knob spec
modifiers.ts:622  m.scale('overkillCarry', 1.5)       ram-bore writes it
(nothing, anywhere)                                    reads it
```

And the damage loop it is supposed to govern carries surplus at **100%** into the
next part in the stack and then into the chassis — there is no 50% carry anywhere
in the codebase. So `ram-bore`'s blurb, *"overkill penetration carries 75% instead
of 50%"*, describes a rule that does not exist. **The mod has been dead on arrival
since it was written**, and one of the five uniques — *Widow of Fell Ford* — is
built on it.

This is docs/20 §8's warning realised exactly: *"A modifier channel can be inert.
The `radiator` channel did nothing for a year and every mod authored on it was
dead on arrival."* Same shape, different channel, and the fence that was added
after the radiator case does not catch it — `game:audit` checks that a mod has a
legal **carrier**, not that its channel has a **consumer**.

### The instrument implication is the bigger half

**`ram-bore` is drafted 16–21 times per sweep.** A no-op mod is taken as often as
chance offers it, because it never hurts — so **`coverage` cannot distinguish a
good mod from a harmless one**, and a high count is not evidence that a mod does
anything. Every "this mod is taken, so it works" reading in this file is weaker
than it looks; the ones that survive are those with a measured effect beside them.

`surge-gate` is a different case and not dead: `firstPriority` **is** consumed, in
the brownout ordering at `simulation.ts:516`. It needs an actual brownout, which
none of the probe builds had. Unmeasured rather than inert.

**Not fixed, because the fix is a rules change.** Implementing the missing consumer
means base carry becomes 50% where it is currently 100%, which changes damage
resolution for every weapon in the game. That is a mechanic, not a number, so it
is the owner's call and is asked rather than taken.

## F44 — `ram-bore` re-authored onto a live channel, and it is a stat bump I stopped short of tuning

F43 established that `ram-bore`'s only effect wrote `overkillCarry`, which nothing
reads. Implementing the missing consumer is a rules change and was put to the
owner; moving the mod onto a channel the sim consumes is numbers, so that is what
was done.

**Now live**, confirmed with the same determinism oracle that caught it dead —
bit-diff over 12 fights, on four carriers, all four differ.

**The first cost did not bite.** `damage ×1.25 · dispersion ×1.35` measured **+3
to +15 on every carrier**, including the most precise gun in the game. The reason
is the same shape as F28: scaling a gun's own 3–8 mrad cone is swamped by the
motion term, `MOVE_JITTER_MRAD_PER_MPS × speed`, which adds ~3.75 mrad at cruise
regardless of what the barrel does — and F38 says the mech is moving 93% of the
time. **A cost applied to a small term inside a large sum is not a cost.**

**The second cost bites and is still outweighed.** `damage ×1.25 · +1.5 kW`:

```
build            mod        shots   hit%   dealt  taken  win%
CH-5 W-AC x2     none        16902   69.1     386    228    69
CH-5 W-AC x2     ram-bore    13642   73.4     441    174    85   (+16)
CH-9 W-BR x2     none         3863   94.9     276    775    29
CH-9 W-BR x2     ram-bore     3816   94.9     325    699    45   (+16)
CH-2 W-KL x2     none         2219   84.5     368    171    54
CH-2 W-KL x2     ram-bore     1808   83.8     390    140    66   (+12)
CH-9 W-CV x2     none         2308   52.4     382     74    96
CH-9 W-CV x2     ram-bore     2036   50.1     395     32    98   ( +2)
CH-2 W-CB x2     none        18942   76.9     472     76    94
CH-2 W-CB x2     ram-bore    15435   77.7     483     51   100   ( +6)
```

The heat cost is **visible** — shots fired drops 19% on the hot Kiln builds as
guns hold fire — and +25% damage outweighs it anyway.

**I stopped here deliberately.** Two iterations on the cost is exploration; a third
would be tuning a number to move a win rate, which the brief forbids. So the
honest verdict is recorded rather than engineered away:

**Verdict.** `ram-bore` is now a **stat bump with a build-dependent cost**, and by
docs/20 §2's standard that is the weaker kind of content — "a part that adds 8%
damage" is the example it gives of what not to ship. It is +2 to +16 depending on
how much thermal headroom the carrier has, which is a real gradient, but it is
positive everywhere and never a wrong answer. Shipping it anyway is the right call
under "interesting beats balanced" only in the narrow sense that a live mod beats a
dead one.

**The swing is large and deliberate, and it is the owner's.** `ram-bore` was
drafted **16–21 times per sweep while doing nothing**. Every one of those builds
now receives +25% damage on its carrier for free where it previously received
nothing. This is a catalog-wide power increase applied through the single
most-drafted mod in the game, and it will move essentially every balance number.
Not tuned, not re-baselined, recorded here.

**Also unblocked:** *Widow of Fell Ford* (`W-BR` + `ram-bore` + `overvolted`) still
assembles and is still named correctly, and is no longer built on a no-op.

`verify` green (447 / 36 / 209), `game:audit` clean.

## F45 — Fire control is the strongest lever in the catalog, and two of them can be worse than one

`types.ts` says of `fireControlLateralMult`: *"Declared here rather than named
inside combat.ts so a second fire-control part is a catalog entry, not an engine
change."* Before taking that invitation, measure what the lever is worth. 20
seeds, whole roster, 0 / 1 / 2 Abacus (sources multiply, so 1.0 / 0.4 / 0.16):

```
build            abacus  shots   hit%   dealt  taken  win%
CH-5 W-AC x2          0  16902   69.1     386    228    69
CH-5 W-AC x2          1  14348   84.1     443    177    86
CH-5 W-AC x2          2  13738   88.4     453    166    89
CH-2 W-CB x2          0  18942   76.9     472     76    94
CH-2 W-CB x2          1  14570   95.5     480     68    96
CH-2 W-CB x2          2  13534   98.8     452     72    90
CH-9 W-CV x2          0   2308   52.4     382     74    96
CH-9 W-CV x2          1   1944   70.0     408     27    99
CH-9 W-CV x2          2   1248   89.8     409     19   100
```

**One Abacus is +15 hit points and +17 win points on the Mule** — the largest
single-part effect measured anywhere in this pass, larger than any gun swap and
an order of magnitude larger than the whole own-motion jitter lever (F39, ±2).

**Why it dwarfs everything else.** F38: the mech is travelling 93% of the fight,
and both mechs are travelling, so almost every shot in the game is fired at a
*crossing* target. Leading error is therefore the dominant term in the hit model,
and `fireControlLateralMult` is the only thing that buys it down at the mech
scale. Own-motion jitter (F39) applies just as often and is worth ±2, because the
shooter's own speed is small next to the target's crossing speed at range.

**And two is not always better than one.** `CH-2 W-CB` goes 96% → **90%** with a
second Abacus, while hit rate still climbs 95.5% → 98.8%. Accuracy went up and
winning went down: the second computer costs a cell and 3 kW on a frame with
little of either, and above ~95% hit rate there is nothing left to buy. That is
F40's warning in a second dress — **hit rate is not the objective** — and it is
the diminishing-returns boundary a second fire-control part has to be designed
around rather than into.

**What this licenses.** A second fire-control part should not be a stronger Abacus
— two Abacus already exist and the stack turns negative. It should differ in what
it *costs*, because the Abacus's 3 kW is the binding resource on exactly the
builds that most want it (this pass has repeatedly measured `energy margin
-15.2 kW, no legal cell left for a reactor`). A part that buys the same lever with
heat instead of power is a direct substitution between the two resources this pass
has shown to bind, and that is the design being taken up next.

## F46 — `HeatProfile.idleHeatKw` is a second field nothing reads, so "a part that runs hot" is not expressible

F45 concluded that a second fire-control part must differ in what it *costs*, and
the design chosen was one that pays in heat rather than the Abacus's 3 kW — a
direct substitution between the two resources this pass keeps measuring as
binding. Checking the channel before authoring against it, which is F43's lesson:

```
types.ts:123   idleHeatKw?: number;   /** Continuous idle heat in kW while powered */
(nothing, anywhere)                    reads it
```

Every consumer of `def.heat` in the sim reads `heatPerShotKj` and only that —
`derivedStats` twice, `simulation` five times. `idleHeatKw` is declared, is
documented, is authored on no part, and is read by nothing.

**So a part cannot emit continuous heat at all.** The only continuous-heat channel
in the game is `extraHeatKw`, which is a *modifier* channel (consumed at
`simulation.ts:692`) — so `gyro-flywheel` and `annealed-bore` can make a build run
hot, and no catalog part can. That is a real hole in the levers docs/20 §4 lists,
and it is why "a fire-control computer that runs hot instead of drawing power"
cannot be written today.

**Second dead field this session, found the same way.** `overkillCarry` (F43) and
`idleHeatKw` are both declared, both documented, both unread, and both would have
been authored against if the channel had not been checked first. The pattern is
now firm enough to state as a rule:

> **Before authoring against a `PartDef` or `EffectiveMults` field, grep for a
> consumer outside the file that declares it.** A declaration, a doc comment and a
> knob spec are not evidence that anything reads it. Two of the fields in these
> types are inert, and neither is marked.

Neither is fixed here: implementing `idleHeatKw` adds a heat source to the sim,
which is a rules change and the owner's, exactly as `overkillCarry` is.

**The design adapts instead.** Cells and mass *are* expressible and *are* binding,
so the second fire-control part pays in footprint rather than heat: bigger and
heavier than the Abacus, and free of power. That keeps F45's substitution — the
resource this pass repeatedly measures as scarce is power, and a part that buys
leading accuracy without it is a genuine second answer rather than a weaker copy.

### F44 addendum — the archive cannot see a catalog-wide power increase

`artifacts/rambore-12lock.json`, hash `89d802b3`, against the previous run:

```
ram-bore coverage   21  (was 12)   <- now the most-drafted mod in the game
gallery             253  vs  253
top fitness        1.00  vs 1.00
median fitness     0.66  vs 0.66
emptyCells         4 heavy, unchanged
```

`ram-bore` went from doing nothing to +25% damage on its carrier and is drafted
nearly twice as often — and **the archive's fitness distribution did not move at
all.** Median 0.66 both runs, top saturated at 1.00 both runs.

That is worth stating because it is the opposite of a reassurance. The swing is
real: +16 win points measured at build level on two carriers (F44). The archive
cannot show it, because it keeps the best build per cell and those were already at
or near the ceiling — a mod that makes strong builds stronger has nowhere to go on
a scale that is already saturated.

**So `sim:breed` is not a power-creep detector.** It answers "what shapes are
reachable and what gear gets drafted", and it answers those well. It does not
answer "did the game get more powerful", and a reader comparing two galleries and
seeing an identical median would conclude nothing changed. The instrument for that
question is `balance:report`'s per-build diff against the baseline, which is
exactly what docs/20 §9 says not to re-cut and exactly why.

## F47 — `U-SIGHT`, a second fire-control part, and the completer hides the thing it was built to trade

**Hypothesis.** F45 showed fire control is the strongest lever in the catalog and
that *stacking* it is already the wrong answer, so a second fire-control part must
differ in what it costs, not in how much it gives. Power is what this pass keeps
measuring as scarce, so a version that draws nothing should be a real second
answer.

**Authored.** `U-SIGHT`, "Reticle (optical sight)": `line(3)`, 220 kg, 20 HP,
tier 2, `fireControlLateralMult` 0.55, **no draw**. Against the Abacus's 1 cell,
50 kg, 3 kW and 0.4. Worse per cell, worse per kilogram, weaker on the lever, and
the only one of the two that costs nothing to run. Sources multiply, so it stacks
with an Abacus rather than replacing it.

The heat-paying version would have been the sharper substitution and is not
currently expressible — `HeatProfile.idleHeatKw` is declared and read by nothing
(F46).

**Reachability.** Completes alone on all three chassis, order-independent
`[1,1,1]` in every case. All six registrations; the enabled-part count failed
loudly first.

**Measured, 20 seeds, whole roster:**

```
build            fitting   power kW  shots   hit%  dealt  taken  win%
CH-5 W-AC x2     none           0.2  16902   69.1    386    228    69
CH-5 W-AC x2     U-TC1          0.2  14348   84.1    443    177    86
CH-5 W-AC x2     U-SIGHT        0.7  15124   80.5    432    189    84
CH-2 W-CB x2     none           3.9  18942   76.9    472     76    94
CH-2 W-CB x2     U-TC1          1.7  14570   95.5    480     68    96
CH-2 W-CB x2     U-SIGHT        5.8  16594   90.3    474     76    96
CH-9 W-CV x2     none           0.2   2308   52.4    382     74    96
CH-9 W-CV x2     U-TC1          0.2   1944   70.0    408     27    99
CH-9 W-CV x2     U-SIGHT        0.5   1996   64.5    402     36    99
```

It works — +15 win points over nothing on the Mule, and it ties the Abacus on the
other two frames while giving up 4–6 points of hit rate. That is the intended
shape: a weaker computer that any build can run.

**But the trade it was built around does not show up, and the reason is the
completer.** The differentiating condition is a build too power-starved to run an
Abacus, and `assembleBuild` does not produce those — it answers a negative energy
margin by adding a reactor, so by the time a build is scored it can afford the
3 kW and the Reticle's advantage has been designed away. Look at the power column:
the Abacus costs CH-2 2.2 kW of margin and the Reticle *raises* margin, but only
because its three cells crowd out other draw, not because the build was ever short.

**Verdict.** Keep, with the limitation stated. It is a legitimate second answer
for a player building by hand under a tight reactor, and close to invisible to a
search that repairs power before it scores anything. That is the same shape as
F41's `U-DRIVE` — a part aimed at a condition the instrument removes — and the
second time this pass that **the completer's helpfulness erases the axis a part was
designed to trade on.** Worth remembering before authoring a third: *if the cost
your part avoids is one `assembleBuild` fixes for free, the breeder will never see
the point of it.*

**Cost elsewhere.** `verify` green (447 / 36 / 209), `game:audit` clean, nothing
tuned or re-baselined.

## F48 — The Mule's only chassis identity is arc, and arc is inert, so one frame in three has no working identity effect

F28 measured mount arc as an inert lever: over 195,746 frames the bearing to the
enemy has a median offset of 0.1° and a maximum of 11.6, against a narrowest
half-arc of 10° in the whole catalog. It noted in passing that the chassis
location zones granting `weaponArcBonusDeg: 25` therefore buy nothing, and left
that as a UI honesty question.

It is bigger than that. Every chassis has exactly one location zone, and the
effect vocabulary (`ChassisLocationEffectSpec`) has exactly three fields:

```
CH-2 Vulture  vulture-long-sight-hardpoints   12 cells   weaponRangeMultiplier 1.1   LIVE
CH-5 Mule     mule-articulated-shoulders      10 cells   weaponArcBonusDeg      25   INERT
CH-9 Bastion  bastion-heat-spreader-casemate  36 cells   heatMultiplier       0.85   LIVE
```

**The Mule's entire chassis-level identity does nothing.** The Vulture gets +10%
range on its hardpoints and `W-SR` is cut to the shape that claims it; the Bastion
gets −15% heat across its casemate. The Mule gets +25° of arc on a mech that is
already on target to within a tenth of a degree.

That is docs/20 §2's second signal — *"it makes a chassis want something it did
not want"* — failing at the chassis end rather than the part end. There is nothing
a part can want the Mule's shoulders *for*, so the geometry trick that gave the
Vulture its sniper identity cannot be repeated there. Both other frames have a
lever to build a part against; the middle chassis has none, which is some of why
it reads as the frame without a personality.

**And the vocabulary has no room to fix it without a decision.** Three fields
exist. Range is the Vulture's identity and heat is the Bastion's, so giving either
to the Mule makes it a copy of a frame that already has one. A fourth kind of zone
effect is a new chassis rule, which docs/20 §9 puts squarely in the ask-first
column.

**Recorded, not acted on.** The Mule's shoulders are a distinctive 5-cell concave
shape (`.## / ###`) that nothing in the catalog is cut for, so the *part* half of
the W-SR trick is available and cheap. It is worth nothing until the region it
fits is worth occupying, so authoring one now would be a part aimed at a bonus of
zero — which is the mistake F28 exists to prevent.

## F49 — `W-LNC`, the first hitscan gun that reaches, and a process mistake worth recording

**Hypothesis.** Lead error is the dominant accuracy term (F45: one Abacus is +17
win points, the largest single-part effect in this pass) because both mechs travel
93% of the fight (F38). Lead error scales with time of flight — and **every long
gun in the catalog is a projectile**. Nothing above 150 m is hitscan, so the one
property that makes lead error *zero* is unavailable exactly where it costs most.

```
gun     speed     ideal band   max     hit% (CH-9, F40)
W-SC    hitscan        0-20     45
W-LAS   hitscan       25-60    140
W-ION   hitscan       25-50    150
W-KL        700      90-160    300     67.7
W-CV        260      70-140    240     52.4   <- 0.54 s in the air at 140 m
W-SR       1400      70-130    280
```

**Authored.** `W-LNC`, "Lance (beam lance)": 2×2, 300 kg, tier 3, energy,
**hitscan**, 13 damage on a 1.2 s cycle, ideal 80–150, max 260, 14 kJ/shot
(11.7 kW sustained, between the Kiln's 15 and the laser's 4.5). Chip damage that
never misses for want of leading, against a long band of guns that all hit hard,
slowly, and behind a crossing target. It pays in heat rather than power on
purpose: F47 showed the completer repairs a power deficit before anything is
scored, so a power cost is a trade that gets designed away, while heat is a cost
40% of builds decline (F36).

**Reachability.** Completes alone on all three chassis, order-independent
`[1,1,1]`. Two do not fit a Vulture — a 2×2 gun twice over is more than that frame
has — so it is a Mule and Bastion gun by geometry. All six registrations;
`weaponClass` and the enabled-part count both failed loudly first.

**Measured, 20 seeds, whole roster:**

```
build          heat kW  shots   hit%  dealt  taken  win%
CH-5 W-LNC x2     10.1   6854   76.0    456     66    99
CH-5 W-KL  x2      9.8   2885   71.5    430     83    95
CH-5 W-CV  x2      8.9   2528   50.6    395     21    99
CH-9 W-LNC x2     31.0   7342   74.1    458    104    96
CH-9 W-KL  x2     23.4   3308   67.7    425    153    91
CH-9 W-CV  x2     13.8   2308   52.4    382     74    96
```

**The hitscan premium is real and is the size the theory predicts**: +4.5 to +6.4
hit points over the Kiln at comparable range, and **+22 to +24 over the Culverin**,
whose 260 m/s slug spends half a second in the air. Damage dealt rises with it,
+26 to +33 over the Kiln, and shots fired more than doubles — it is the chip gun it
was designed as.

**Win rate barely moves, and that is the instrument.** 99 / 96 against 95 / 91:
these builds are already at the ceiling, so a real mechanical advantage reads as
+4. F44's addendum said the archive cannot see a power increase on a saturated
scale; this is the same saturation one level down, in the probe. **Hit rate and
damage dealt are the honest signals here and win rate is not**, which is F40's
warning pointing the other way for once.

### The process mistake

I started the `U-SIGHT` sweep and then edited `packages/sim` under it, which
CLAUDE.md explicitly warns kills a running experiment. It survived — the workers
run the compiled `dist` and I did not rebuild it — but the main process computes
`stamp.contentHash` from source, so **that report's stamp may describe content its
workers never measured**. Treat `artifacts/sight-12lock.json`'s hash as unreliable
and its coverage numbers as pre-`W-LNC`. The rule exists for a reason and I broke
it while writing up a finding about checking things before believing them.

**Cost elsewhere.** `verify` green (447 / 36 / 209), `game:audit` clean, nothing
tuned or re-baselined.

### F49 addendum — the stamp survived, and why

The caution in F49 was warranted and the risk did not materialise. The sweep
stamped `fd14516c`; the source with `W-LNC` in it hashes `1f115c99`. They differ,
so the stamp was computed from the module state loaded at process start — Node's
module cache means `catalog.ts` was read once, at import, before the edit. The
report is internally consistent: pre-Lance stamp, pre-Lance workers, and `W-LNC`
is absent from its coverage table as it should be.

**Keep the rule anyway.** It held by a property of the module loader rather than
by design, and a sweep that reloaded or a `dist` rebuild mid-run would have
produced a report whose stamp lied. The rule costs nothing; the failure it
prevents is silent.

### F47 addendum — the Reticle is drafted *more* than the Abacus, and my prediction was wrong

`artifacts/sight-12lock.json`, hash `fd14516c`:

```
U-SIGHT  coverage 14
U-TC1    coverage  9
```

F47 concluded the Reticle would be *"close to invisible to a search that repairs
power before it scores anything"* — that the completer's habit of answering a
power deficit with a reactor would erase the axis the part trades on. **It is
drafted more often than the part it was designed as an alternative to.**

The mechanism I missed is that **repairing power is not free.** The completer does
add a reactor, so no build is ever left browned out — but a reactor costs *cells*,
and a 2×2 or 3×3 of them is a large bite out of a plate. A part that draws nothing
does not avoid a brownout; it avoids the reactor that would have prevented one. So
the Reticle's three cells and 220 kg are frequently cheaper in total footprint
than the Abacus's one cell plus the reactor upgrade its 3 kW eventually forces.

That is a real correction to the rule F47 proposed. The sharper version:

> **A cost the completer repairs is not erased — it is converted.** Power becomes
> cells, heat becomes perimeter, and the part that avoids the original cost still
> avoids the conversion. What *is* erased is only the failure state, not the price.

Which also means F41's `U-DRIVE` reading — 7 uses, and 2 of 101 close builds —
should not be re-explained by the same argument I used there. It is drafted
modestly for its own reasons, and the "completer erases the axis" story is now the
weaker half of that finding.

**Other movement at this hash, unattributable and untuned:** `ram-bore` climbs
again to 29 from 21; `U-RAD` and `P-CAP` appear in `deadParts` for the first time
in this pass; `W-SR`, `W-BR` and `U-SHELL` land in `neverOffered`. Gallery 249,
four empty cells including `close/heavy/redliner` which has not been empty before.

## F50 — `salvoCount` is a real saturation mechanic, and two caveats found while checking

**Hypothesis, and it was wrong.** Two of the three `salvoCount` sites multiply it
straight into a damage total (`simulation.ts:625, 665`), which reads like a
"salvo" that is really a damage multiplier — the same class as `overkillCarry`
(F43) and `idleHeatKw` (F46), where a field's name promises more than its
implementation delivers. Reading further shows it is not: `resolveShot` loops
`salvo` times with an **independent `hitRoll` and an independent
`applySpatialHit` per projectile**, at `damagePerProjectile` un-multiplied. The
rocket pod really does throw six six-damage projectiles that each hit or miss on
their own, and the diversity note's "saturation vs a hammer" is accurate.

No double-application either: the multiplied `totalDamage` on the shot event is
consumed only by `derivedStats`'s burst-dps readout, never to apply damage.
`estimateExpectedDps` multiplying by salvo is likewise correct — expected dps is
`pHit × damage × salvo / cycle`.

**Caveat 1, and it is a trap for this file.** `stats.shotsFired++` is inside the
salvo loop, so a salvo weapon reports **six shots per cycle**. Every `hit%` in
this pass is safe — numerator and denominator both count projectiles — but the
`shots` and `shots/fight` columns in F40, F41 and F49 are per-*projectile*, not
per-trigger-pull. None of those tables includes `W-RKT`, so nothing published here
is wrong, and a future comparison that mixes a salvo weapon with a single-shot one
would be. **Compare shot counts only within the same salvo size.**

**Caveat 2, latent.** The charged path (`simulation.ts:632`, i.e.
`chargedEnergyPerShotKj` — the laser, the ion, and now the Lance) pushes
`totalDamage` **without** the salvo multiplier, while the continuous and
mechanical paths include it. No shipped weapon is both charged and a salvo, so
nothing is wrong today; the first one authored will under-report its burst dps in
the workshop readout while fighting correctly. Recorded rather than fixed, because
fixing it changes a number no current part produces.

**Verdict.** A negative result: the lever works, and one of the three "declared
but not delivered" cases this pass turned up is not one. Worth the check — the
two that were real (F43, F46) were found by exactly this reading, and the cost of
confirming the third was ten minutes.

## F51 — The support layer is four parts serving a constraint that binds 0.84% of the time

docs/20 §4 sells height and forward clearance as a real spatial game: *"a gun can
be blocked by its own hull — that is where risers and gimbals earn their place."*
Measured rather than assumed.

**`clearsForward` has no runtime consumer.** Its only reader is `spatial.ts:323`,
returning `blocks-firing-lane` at placement time. Nothing in combat asks whether a
gun's lane is clear; the rule shapes what you may build and never fires again.
That is legitimate — placement rules are a real design surface — but it means the
whole system is a builder constraint, not a battle one.

**And it barely binds.** Every enabled weapon, at every origin and rotation, on
every canonical build — 14,336 attempted placements:

```
out-of-mask          7263   50.66%
footprint-mismatch   3283   22.90%
out-of-region        1539   10.74%
core-occupied        1525   10.64%
incompatible-stack    200    1.40%
blocks-firing-lane    120    0.84%   <- the entire height/clearance game
ceiling-exceeded       85    0.59%
```

The firing-lane rule is the **second-rarest** reason a placement is refused. Shape
and region account for 85% of refusals between them; height and clearance together
account for 1.4%.

**Four parts serve it.** `U-RISE2`, `U-RISE3`, `U-RISEL` — which `diversity.ts`
already flags as `overlap-watch`, "three risers doing one job... they separate
only on footprint" — plus `U-TUR`, whose only differentiator is arc and is
therefore dead (F28). That is four of roughly thirty-six catalog parts, an ninth
of the catalog, aimed at a constraint that arises under one placement in a
hundred. **No canonical template fits any of them.** Zero of seven.

**Verdict, and it is a recommendation not to author.** The support layer is not
broken — the rule works, the parts do lift things, and `U-VENT` and `U-MANTLE`
both showed this pass that geometry constraints are where content lands well. But
it is over-provisioned relative to the problem it solves, and the honest reading of
"risers are `overlap-watch` and the gimbal is dead" is not *"author a better
riser"* — it is that a fifth part here would serve the same 0.84%.

**What would change it is a rules question, not a content one:** whether
`clearsForward` should have a runtime effect — a gun firing over its own hull
paying accuracy rather than being refused outright — which is a new rule and the
owner's. Recorded rather than asked, because unlike the three questions already
outstanding this one has no content blocked behind it. It is a reason *not* to
build, and that is worth as much as a reason to.

### F49 addendum — the Lance is the most-drafted weapon in the sweep and fills both heavy/redliner cells

`artifacts/lance-12lock.json`, hash `1f115c99`.

```
W-LNC coverage 48, in 31 of 283 gallery builds   <- most-drafted weapon in the run
gallery      283   (previous run 249, the largest of this pass)
emptyCells   ["long/heavy/cold"]   — one, down from four
```

**Build-level attribution, which is the only kind F22 permits, and it is
affirmative:**

```
mid/heavy/redliner    1 build, fitness 0.99, CARRIES W-LNC
                      CH-2  R-C40 W-LNC W-MG + 5 plates
long/heavy/redliner   1 build, fitness 0.99, CARRIES W-LNC
                      CH-2  R-C40 W-LNC + 7 plates
mid/heavy/cold        1 build, no Lance (a CH-5 Culverin build)
close/heavy/redliner  5 builds, no Lance
```

**Both heavy/redliner cells — empty through almost this entire pass — are filled,
and both builds carry the Lance.** That is the design working end to end and it is
worth naming why, because it was not the stated goal. The Lance was authored for
*reach without lead error* (F49) and paid in heat because F47 said a power cost
gets repaired away. Heat is what made it fill a **redliner** cell: a build carrying
two of them runs a negative margin by construction, and armour ballast on a
Vulture supplies the *heavy*. The part reached a cell it was not aimed at, through
the cost it was given rather than the benefit it was designed for.

That is the opposite of `U-DRIVE` (F41), which was aimed squarely at `close/heavy`
and never landed there. **Costs place a part in the archive at least as much as
benefits do** — the axes are range, weight and heat, and two of those three are
costs.

**What it displaced, and the caveat.** The other long guns all fall at this hash:
`W-KL` 37 → 21, `W-CV` 51 → 27, `W-LAS` 34 → 16. The hash moved, so none of that
is attributable — but a new gun taking 48 draws in the band the other three share
is the obvious reading and I will not pretend it is not. `cold-bore` enters
`deadMods`; `U-VENT` and `P-CAP` enter `neverOffered`. Recorded, not tuned.

**Verdict on `W-LNC`: keep, and it is the best content outcome of this pass.**
Most-drafted weapon, largest gallery on file, and the only part all session with
affirmative build-level attribution into a previously empty cell.

## F52 — The last empty cell holds a 99% build, so the archive is closed as a content target

After `W-LNC`, `emptyCells` is one: `long/heavy/cold`. Applying gate 9 — the check
this pass added to docs/20 §7, *score the best build the cell can hold before
authoring for it* — before writing anything.

**49 builds land in `long/heavy/cold` using parts that already ship.** The best,
at 20 seeds against the whole roster:

```
CH-5 W-CV x2 + 8 plates    99%
CH-9 W-SR x3               99%
CH-5 W-KL x2 + 16 plates   94%
CH-9 W-SR x2               93%
CH-5 W-CV x1 + 16 plates   81%
...
CH-5 W-LNC x2 + 16 plates   0%
```

**A 99% build sits in the only empty cell in the game.** So it is not a content
gap by any definition — it is reachable, it is strong, and the breeder does not
propose it. Same shape as F34, where `long/heavy/redliner` held a 95% build, and
F24 before that.

**Verdict: do not author for it.** By this pass's own gate, a part spent here is
wasted.

### The larger consequence: retire "fill the empty cells" as the goal function

docs/20 §2 defines interesting operationally as *"a part is interesting if it fills
a cell that was empty, or lets a filled cell be won a different way"*, and §3 makes
the empty-cell list the backlog. **That backlog is now closed**, and closed in a
way that says the metric has stopped being useful rather than that the work is
done:

- Of the four cells empty for most of this pass, **three held builds of 71–99%
  that the search never proposed** (F34, F52).
- The fourth, `mid/heavy/cold`, held a 19% build and was the only honestly empty
  one — and it filled anyway, without a part aimed at it.
- Meanwhile **filled cells hold 21–29% builds** (F40): `close/heavy/*` is occupied
  by things that lose three fights in four.

**Occupancy measures neither reachability nor quality.** An empty cell can hold a
99% build and a filled one a 21% build, so "fill the empty cells" selects for
neither interest nor strength — it selects for what the search happened to
propose. The two parts this pass that landed best (`W-CV` at 53 coverage, `W-LNC`
at 48 and both heavy/redliner cells) were aimed at *mechanisms* — recoil paid in
mass, reach paid in heat — and reached the archive as a side effect. The one aimed
directly at a cell (`U-DRIVE` at `close/heavy`) never landed there.

**What to use instead**, in rough order of how well it worked this pass:

1. **A lever that is live but unpriced.** Reach and lead error were both dominant
   and both had exactly one shape available (F40, F45). Both produced a
   heavily-drafted part.
2. **A cost no part currently pays.** Costs place a part in the archive as much as
   benefits do (F49 addendum) — the Lance filled a redliner cell through its heat,
   not its hitscan.
3. **A dead lever, checked first.** Half the ones examined turned out to be dead
   *fields* rather than dead content (F43, F46), which is worth knowing but yields
   no part.

Empty cells are last, not first.

## F53 — `W-SER`, and suppression that lengthens the fight can let the enemy shoot *more*

First idea taken under F52's replacement ordering: **a live-but-unpriced lever.**

**Hypothesis.** `enemyHeatKj` is a system attack whose target always exists —
unlike `capDrainKj`, which six of seven panel templates have no capacitors to lose
(F37) — and it is priced onto exactly one gun: a 3-damage flamer with a 20 m band.
The lever is unpriced at range, not absent.

**Measured before authoring.** Three Scalds against three Stitchers, same chassis,
same close band, 15 seeds, watching the *enemy's* heat:

```
gun     enemy meanC  peakC  >115%   win%
W-SC           62.6    178   9.38%    26
W-MG           40.0    102   0.00%    72
```

The mechanism is real and strong — 9.4% of the fight held over the fire-hold
threshold, peaks past the 150 °C damage line — and the gun carrying it wins 26%.

**Authored.** `W-SER`, "Sear (induction beam)": `line(3)`, 240 kg, tier 3, energy,
hitscan, **4 damage on a 0.8 s cycle** — 5 dps, the lowest in the catalog — ideal
40–100, max 180, `enemyHeatKj` 9 (11.25 kJ/s), and 6 kJ/shot of its own heat. It
does not kill, it disables: past 115 °C the struck part holds fire, past 130 it
shuts down, past 150 it takes damage. And it cooks itself doing it, spending its
own thermal headroom to spend the enemy's.

**Reachability.** Alone on all three chassis, order-independent `[1,1,1]`. Six
registrations; `weaponClass` and the part count failed loudly first.

**Measured, 15 seeds, whole roster:**

```
build          enemy meanC  >115%  >130%  enemy shots  own dealt  win%
CH-5 W-SER x3         73.2   5.84   2.16        18008        369     50
CH-5 W-SC  x3         62.6   9.38   4.25        15937        219     26
CH-5 W-MG  x3         40.0   0.00   0.00        14274        408     72
CH-9 W-SER x3         72.9   5.75   1.92        20428        349     48
CH-5 W-LNC x2         33.6   0.00   0.00         5595        452     99
```

**It works and it nearly doubles the flamer**: 50% against 26%, cooking opponents
to a *higher mean* than the flamer does (73.2 against 62.6) from 40–100 m instead
of inside 20.

**And it loses to simply killing things.** The machine gun is 72% and the Lance
99%. Disabling is worse than damage here, and the numbers say something sharper
than that:

> **Enemy shots fired go *up*, not down.** 18,008 against the machine gun's
> 14,274 — the Sear suppresses 5.84% of enemy ticks and still lets the enemy fire
> 26% more shots, because 5 dps makes the fight far longer. Suppression measured
> per-second is not suppression measured per-fight.

That is a genuine trap in the design of any disabling weapon in this sim, and it
is not visible from the mechanism: the flamer shows the same shape more sharply
(9.38% suppression, 15,937 enemy shots, 26% win). **A weapon that wins by turning
the enemy off has to turn them off faster than its own low damage extends the
fight**, and neither of these two does.

**Verdict.** Keep. It takes a live lever from an unusable range to a usable one and
doubles the win rate of the only other gun that carries it, which is what the
ordering in F52 said to look for. It is mid-tier and honestly so: 50% is a real
weapon and not a good one.

**Cost elsewhere.** `verify` green (447 / 36 / 209), `game:audit` clean, nothing
tuned or re-baselined.

## F54 — Fights happen at 85 m, and three guns have ideal bands the game spends 0.3% of its time in

Measured while sizing a dead zone for an artillery piece: the engagement-range
distribution across every canonical pairing, three seeds, 145,338 frames.

```
p05 36 m   p25 48 m   p50 85 m   p75 144 m   p95 192 m   max 234 m

under  20 m:  0.3% of fight time
under  40 m: 17.1%
under  60 m: 30.8%
under  80 m: 47.7%
under 100 m: 55.5%
under 140 m: 73.4%
```

**The median fight is at 85 m and true knife range essentially does not happen** —
three tenths of one percent of fight time inside 20 m.

Now the authored ideal bands of the close weapons:

```
W-BR  Maul    ideal  0-15   max 45
W-SC  Scald   ideal  0-20   max 45
W-AV  Anvil   ideal  0-30   max 60
```

**All three are tuned to a band the game occupies 0.3–17% of the time**, and their
full-damage plateau sits almost entirely inside the part of the range axis that
never gets used. They still fire — `max` reaches 45–60 m and under-40 is 17% — but
they fire on the *fading* part of their own curve almost always, at a fraction of
their printed damage.

**This is the mechanism behind F40.** That finding measured `W-BR` hitting 94.9%
of its shots and winning 29%, and attributed it to time under fire while closing.
That is half of it. The other half is that a Bastion carrying a 0–15 m gun is
walking toward a band it will rarely reach, and being paid the falloff ramp rather
than the plateau when it gets there. Both readings are the same underlying fact —
**the close band is authored for a fight that is not happening** — and the second
is more actionable than the first.

**Not fixed, deliberately.** Re-banding three shipped weapons moves every number
attached to them, which is a balance pass and explicitly not this one's job. The
observation is what is owed here.

**What it does license**, and is the reason it was measured: a dead zone is a real
cost. A gun that does nothing inside 60 m gives up 30.8% of current fight time —
and, because the pilot picks its standing range off the exchange curve and that
curve reads zero inside the zone, an artillery piece should *change where the
fight happens* rather than merely suffer. That is docs/20 §2's first and strongest
signal, and `falloff.min` is a live, consumed lever that exactly one gun pays —
`W-MG`, at 10 m, where its ideal band starts anyway, so it pays nothing at all.

### F53 addendum — the Sear is drafted into builds that lose, and median carrier fitness is how you see that

`artifacts/sear-12lock.json`, hash `abfb5a05`. `W-SER` coverage 14, in 11 builds —
which on its own reads like a modest success. It is not, and the number that shows
it is not coverage:

```
part     builds   best   median fitness of builds carrying it
W-LNC        30   1.00   0.98
W-CV          7   1.00   0.99
W-MG         53   1.00   0.66
W-SC         23   0.99   0.33
W-SER        11   0.99   0.02
```

**The Sear's median carrier scores 0.02.** It is drafted, and drafted into builds
that lose essentially everything — the archive keeps them because they are the only
occupant of their cell, not because they are good. That matches the hand-built
measurement exactly (50% against a machine gun's 72%) and it is invisible in the
coverage column, which counts draws and says nothing about what happened next.

**This is the fix for F43's complaint.** That finding showed `coverage` cannot
distinguish a good mod from a harmless one, because a no-op is drafted as often as
chance offers it. **Median fitness of the builds carrying a part is the missing
discriminator**, and it separates cleanly here: 0.98 for the Lance, 0.66 for the
machine gun, 0.33 for the flamer, 0.02 for the Sear. Coverage says all four are
used; the median says only two are used *well*.

**Read every coverage number in this file with that caveat.** The claims that
survive it are the ones where a fitness or win-rate measurement sits alongside —
`W-LNC` (median 0.98, both heavy/redliner cells), `W-CV` (0.99) — and the ones that
do not are weaker than they looked, including `ram-bore`'s 21→29→40 climb, which
was never checked this way.

**Verdict on `W-SER`, revised down.** Keep, but as a *filler*: it occupies cells
rather than winning them, and the honest description is a weapon that works — the
suppression is real and measured — attached to builds that do not. F53's "mid-tier
and honestly so" was generous; the archive says the search cannot find a good home
for it.

**Also at this hash, unattributable:** `U-MANTLE` and `U-ACT` enter `deadParts`,
`W-SC` falls 35 → 26 (the Sear plausibly displacing the flamer, same band, same
mechanism), gallery 263 against 283.

## F55 — A dead zone does not push the fight outward, because the pilot chooses where it *stands* and spends 93% of the fight travelling

Second idea under F52's ordering, item 2: **a cost no part currently pays.**
`falloff.min` is live and consumed — `falloffAt` returns a hard 0 below it — and
exactly one weapon authors it, `W-MG` at 10 m, where its ideal band starts anyway.

**Hypothesis.** A real dead zone should make the pilot *stand off*: it picks its
standing range by scanning the exchange curve, and that curve reads exactly zero
inside the zone, so an artillery piece should change where the fight happens
rather than merely suffer up close. That is docs/20 §2's first and strongest
signal and nothing had tested it.

**Authored.** `W-BMB`, "Bombard (siege artillery)": 3×2, 1000 kg, tier 4,
ballistic, 95 damage on a 7 s cycle — **13.6 dps, the best of any long gun**
against the Culverin's 11.7 — ideal 100–190, max 300, and **`falloff.min` 60**,
where fights currently spend 30.8% of their time (F54). Charged for twice: the
dead zone, and 200 m/s, which is 0.95 s of flight at 190 m, so it eats the lead
error the Lance was authored to escape.

**Reachability.** Alone on CH-5 and CH-9, order-independent `[1,1,1]`; refused on
CH-2, where a 3×2 does not fit a Vulture region. All six registrations —
`weaponClass`, `powerBudget` and the enabled-part count all needed hand edits.

**Measured, 15 seeds, whole roster — and the hypothesis is false:**

```
build          median range  % under 60 m   hit%  dealt  taken  win%
CH-5 W-BMB x2           127        11.0     55.6    400     51     95
CH-5 W-CV  x2           195         0.0     50.1    401     20    100
CH-5 W-KL  x2           116         5.3     72.0    429     73     96
CH-9 W-BMB x2           112        27.7     49.7    389    162     87
CH-9 W-CV  x2           164         2.3     52.1    391     85     95
```

**The Bombard fights *closer* than the Culverin, not further** — median 127 m
against 195 — and spends **11% of its fight on CH-5 and 27.7% on CH-9 inside its
own dead zone**, where it does literally nothing. On the Bastion that costs it
162 damage taken against the Culverin's 85, nearly double, for the same damage
dealt.

**The mechanism is F38.** The exchange scan chooses where the mech wants to
*stand*, and standing is 7.2% of the fight; the other 92.8% is transit, during
which the mech passes through its own dead zone and the *enemy* decides how close
to come. A cost keyed to range is therefore a cost the pilot cannot avoid paying,
because it does not control range — it controls a preference it acts on for one
tick in fourteen.

**This is the second falsified premise about steering the pilot.** F35: a reward
cannot make a build run hot, because heat is set by the gun, frame and cooling. F55:
a cost cannot make a build stand off, because range is set by transit and the
enemy. Together:

> **Weapon economics do not steer pilot behaviour.** Both attempts to change what
> the autopilot does by pricing a part failed, in opposite directions. docs/20 §2
> ranks "it changes what the autopilot does" as the strongest signal a part can
> have — and on this evidence a *part* cannot produce it at all. That is a
> statement about the four verbs, not about the two parts.

**Verdict.** Keep, with the premise struck out. It is a real weapon — 95% and 87%,
the best printed dps of the long guns — but it is *worse* than the Culverin at both
chassis it fits, and it is worse for exactly the reason it was supposed to be
interesting. The dead zone is a pure cost with none of the positioning payoff the
design was built on.

**Cost elsewhere.** `verify` green (447 / 36 / 209), `game:audit` clean, nothing
tuned or re-baselined.

## F56 — The salvo variance hypothesis is untestable this way, and the rocket pod is the worst gun in the catalog for unrelated reasons

**Hypothesis.** `applySpatialHit` samples independently per projectile with its own
RNG draw (F50), so a salvo converts one all-or-nothing `pHit` roll into N partial
outcomes. Damage dealt should therefore vary *less* fight to fight, and that should
matter most where `pHit` is low — making a long-range salvo a distinct answer to
the accuracy problem, different from the Lance's hitscan, which removes lead error
outright rather than averaging over it.

**Measured — coefficient of variation of per-fight damage dealt, 20 seeds, whole
roster:**

```
gun     salvo   dps   hit%   mean dmg    sd     cv    win%
W-RKT       6   2.4   47.4         67    93  1.389       1
W-AV        1  18.8   83.5        236   269  1.141      30
W-BR        1  20.0   95.2        320   208  0.652      54
W-MG        1  15.0   82.9        341   287  0.842      45
W-CV        1  11.7   50.6        395   179  0.452      99
W-LNC       1  10.8   76.0        456   210  0.460      99
```

**The only salvo weapon has the *highest* variance, not the lowest** — 1.389
against the single-shot Culverin's 0.452. The hypothesis is dead, and so is the
measurement: **per-fight damage variance is dominated by fight duration and
outcome, not by per-shot roll variance.** A gun that wins 99% of its fights
produces consistent damage because its fights are consistent; a gun that wins 1%
produces wild damage because sometimes it lands a rocket and mostly it dies. The
instrument answers a different question from the one asked, and I built it before
noticing.

Isolating the salvo's variance contribution would need per-*trigger-pull* damage
sampled at fixed range against a fixed target — a bench measurement, not a battle
one. Not built, because the answer would be a subtle property and F55 has just
finished showing what happens when a part is authored on a reasoned mechanism
rather than a measured effect.

### What the table does say, clearly

**`W-RKT` is the worst weapon in the game and it is not close.** 2.4 dps — less
than half the Sear's 5, which was authored deliberately as the lowest-damage gun
in the catalog — 67 mean damage, and a **1% win rate**. Two authored numbers cause
it and neither is the salvo:

- **`cycleS` 15** against a 36-damage payload. Nothing else in the catalog waits
  more than 13 s, and that one (`W-SR`) delivers 110.
- **An ideal band 10 m wide**, 30–40 m, against a median engagement range of 85 m
  (F54). Even the close guns get a 15–30 m plateau.

So the rocket pod is mis-costed and mis-banded, in the same way F54 found for the
close-range trio, and the salvo mechanic it carries is fine. **Recorded, not
fixed** — it is three authored numbers on a shipped weapon, which is a balance
pass.

**Verdict.** No part authored. A hypothesis killed by measurement, a measurement
killed by its own confounds, and a pre-existing weapon identified as the catalog's
weakest by a factor of two. The middle one is the finding worth carrying: **a
battle-level statistic cannot isolate a shot-level mechanism.**

## F57 — The pass scored by median carrier fitness, and two of my own verdicts were wrong

`artifacts/bombard-12lock.json`, hash `975ee813`, gallery 261. Read with the
discriminator from F53's addendum rather than coverage alone:

```
part       coverage  builds  best  median          verdict
W-BMB            39      27  1.00   0.99   strong
U-VENT           55      20  1.00   0.99   strong
W-LNC            28      17  1.00   0.99   strong
U-SIGHT           5       4  0.99   0.97   strong but rarely drafted
W-SER            30      22  0.99   0.02   drafted into losing builds
U-MANTLE          1       1  0.01   0.01   drafted once, into a losing build
U-DRIVE           0       0     —      —   deadParts
W-CV              0       0     —      —   neverOffered (draw luck)

for reference: W-KL 49/0.98 · W-MG 107/0.66 · W-SR 2/0.51
```

**Correction 1 — the Bombard is a good weapon whose premise was false.** F55
struck out its design story (a dead zone does not make the pilot stand off) and
recorded it as "worse than the Culverin on both chassis it fits". By the metric I
now trust it is among the best things this pass produced: 39 draws, 27 builds,
median **0.99**. Those are separate claims and both hold — **the positioning
premise is dead and the gun is strong anyway**, on reach and 13.6 dps. I was right
to strike the premise and wrong to let that colour the verdict on the part.

**Correction 2 — `U-MANTLE` is weak.** F29 kept it on +8 to +11 build-level
attribution at 30 seeds, and that measurement stands. But across the whole pass it
has never exceeded 2 gallery builds, and here it is 1 build at median **0.01**. A
part that improves a hand-built probe and is drafted once into a losing build is
not a part that works; the honest verdict is that the armour *assembly fix* was the
value (F29's real finding) and the part was the occasion for it.

**What the scorecard says overall.** Of eight parts shipped, four are drafted into
winning builds (`W-BMB`, `U-VENT`, `W-LNC`, `U-SIGHT`), one is drafted into losing
ones (`W-SER`), and three are effectively absent (`U-MANTLE`, `U-DRIVE`, and
`W-CV` only for draw luck at this hash — it read 53 coverage and median 0.99 two
sweeps ago). The four that work share a property worth naming: **each buys a live,
dominant thing — cooling that fits, reach without lead error, reach with damage,
leading accuracy — and each pays in a currency the completer cannot refund.** The
three that do not were aimed at cells, at conditions the completer repairs, or at
pilot behaviour.

**And `emptyCells` is five here**, all heavy, against one two sweeps ago. That
volatility across hashes is F52's point restated: the cell list is a property of
the draw domain, not of the catalog, which is why it was retired as a target.

## F58 — Smaller is more placeable; a different shape of the same size is not. Reactor choice is settled and I shipped a dominated part before catching it

**Where the idea came from.** Reading the gallery for what separates winning from
losing builds (`bombard-12lock`, top 93 builds at 0.95+ against 50 under 0.20,
share of builds containing each part):

```
R-C40  57% of winners, 14% of losers   +43   <- largest lift of any part
W-KL   26%  /  0%                      +26
W-BMB  25%  /  0%                      +25
...
W-SER   4%  / 24%                      -20
R-E60  10%  / 30%                      -20
```

**Power is the biggest separator in the game, and the reactor choice is already
settled.** Combustion gives 10.00 kW per cell against electric's 6.25–6.67, and
0.114 kW/kg against 0.080. Electric buys low waste heat and zero throttle lag —
`throttleLagS` *is* consumed (`simulation.ts:411`), so that is a real property —
and the gallery says it is not worth 37% of power density. `diversity.ts` calls
`R-E25 vs R-C40` a distinct choice; on this evidence it is not a choice.

**Hypothesis, and it was wrong in an instructive direction.** The best part of
this pass was `U-VENT` — a deliberately *worse* radiator whose whole value was
fitting where the Gill could not (median 0.99, coverage 55). Every reactor is a
square, so the same move should work on power: a 1×4 line reactor, deliberately
worse per cell (8.75 against 10.00), bought for fitting a strip instead of a block.

**Measured — legal placements for each reactor on a plate already carrying two
guns:**

```
CH-2, W-CB x2 down    R-C40 (2x2):  0    R-L35 (1x4):  0
CH-5, W-AC x2 down    R-C40 (2x2):  0    R-L35 (1x4):  0
CH-9, W-BMB x2 down   R-C40 (2x2): 60    R-L35 (1x4): 30
```

**The line fits in half as many places as the square, not more** — and on the Mule
it could not be fitted at all where the square could. Performance was identical
everywhere it did fit (74/73, 98/98, 86/86), so it was strictly dominated: harder
to place, no better, and worse per cell by design.

**The correction, which is the finding.** I read `U-VENT`'s lesson as *"a different
shape fits where the standard one cannot"*. It is not. The Vent went from **3 cells
to 1** — the Gill needs three *contiguous perimeter* cells and the Vent needs one,
so it fits strictly more places. `R-L35` went from four cells to four cells in a
different arrangement, which buys nothing and costs collinearity: a straight run of
four is rarer on these chassis than a 2×2 block, because the Vulture's regions are
narrow and the Bastion's hull is four wide.

> **Placeability is a function of footprint *size*, not footprint *shape*.**
> Fewer cells fits more places. The same cells rearranged fits fewer, because
> every additional constraint on arrangement is a constraint.

**Reverted.** docs/20 §2 says a part that changes nobody's decisions is not worth
shipping; a strictly dominated one is worse than that. Removed from the catalog,
the pool, the unlock route, the diversity table and both count guards — the same
five-place removal the six-place registration implies, which is worth noting as
its own small hazard.

**Not fixed, recorded:** the reactor lineup is a settled choice, not a choice.
Making electric competitive means moving `outputKw` or the density constants on
shipped parts, which is a balance pass.

## F59 — Adding the smallest part in a category silently changes the completer's default for every build in the game

**The idea, and it was a good one.** F58 established that placeability is a
function of footprint *size*, and that reactors — the category carrying the largest
winner/loser lift in the game (`R-C40`, +43) — have a four-cell minimum, with
**zero legal 2×2 placements on a Vulture or a Mule once two guns are down**. So: a
two-cell reactor, `R-C16`, deliberately the worst in the catalog on both densities
(8.0 kW/cell against 10.0, 0.080 kW/kg against 0.114) so that stacking never pays
and it earns its place only when two cells are what is left. That is `U-VENT`'s
trade exactly, in the category that matters most.

**It broke two unrelated tests, and the cause is not the part.**

```
armourAssembly   U-MANTLE could not be completed beside W-RKT on any chassis
coolantBath      tidecooler no longer cools a wading mech more (100.5 vs 98.7)
```

Neither test mentions reactors. Both changed because `assembleBuild` seeds a
reactor before anything else and picks **`REACTORS()[0]` — the smallest by
output**. Adding a 16 kW reactor made it the seed for *every assembled build in
the game*, replacing the 25 kW Whisper, and every probe in the suite shifted
underneath.

> **A part that is an extremum in its category does not join the catalog; it
> replaces a default.** The completer selects by `[0]` after sorting — smallest
> reactor, smallest capacitor — so shipping the smallest anything silently
> re-baselines every build the search or the tests produce. Nothing in docs/20 §6's
> six-place registration checklist asks about this, and no guard catches it: the
> two tests that failed did so for reasons that look nothing like the change.

**And it makes a known weakness worse.** F21 already records that the completer
under-sizes the reactor — *"it closes an energy gap with the smallest reactor that
helps and cannot upgrade when cells run out — worth 25 points on one build"*. A
smaller reactor is strictly more under-sizing. The part would have shipped a
measured instrument defect deeper into every build.

**Reverted**, second in a row, and for a better reason than the first: `R-L35` was
dominated content, `R-C16` is content whose side effect is an instrument change.
The distinction matters — the first should not exist, the second could, but not
until the completer stops choosing by extremum.

**A fourth question for the owner**, and it now blocks a real part rather than a
hypothetical one: should `assembleBuild` seed the *smallest* reactor, or the
smallest that covers the build's measured demand? F21 says the current rule costs
up to 25 points on a heavy build. Changing it moves every assembled build in the
game, which is why it is not mine — but until it changes, **no small reactor can be
added to this catalog**, and that is a content gap held shut by a search heuristic.

**Cost elsewhere.** None: reverted clean, 447 sim and 36 game tests green, enabled
parts back to 38.
