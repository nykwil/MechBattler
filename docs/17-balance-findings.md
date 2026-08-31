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

## Non-findings, recorded so they are not re-investigated

- **`sim:diversity` is green.** Its only failure was a mismeasurement: the
  harness tested hull-down at 0.5 m/s where the perk fires at 1.5, reporting 2%
  activation instead of 37% and listing a live perk in `deadPerks`. Fixed by
  declaring `ModifierDef.isActive` beside `apply`. Do not cite diversity output
  from before 2026-08-18 as evidence of a balance problem.
- **Body collision (`fe265c3`) is innocent.** Measured, not assumed.
