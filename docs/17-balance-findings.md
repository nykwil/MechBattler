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
