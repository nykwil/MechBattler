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

**Corroborated independently, 29 Aug 2026.** `sim:breed` searches for the best
build at each rank rather than reading a fixed roster, and finds the same thing
from the other direction: the ceiling peaks at rank 10 on all three chassis and
declines after it. See **F6**. Two instruments with no shared method now agree,
so this is a property of the content and not of the template set.

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

## F6 — Rank stops buying anything at 10, and then starts costing

**Status:** open. Measured 29 Aug 2026 by `sim:breed`, 2 locks x 3 chassis x
ranks 6/10/14/18, budget 120, content hash `5e2b472e`. Report in
`artifacts/breed-report.json`.

Best win rate found at each rank, against the canonical roster:

| Chassis | rank 6 | rank 10 | rank 14 | rank 18 |
|---|---|---|---|---|
| CH-2 | 57% | **86%** | 81% | 81% |
| CH-5 | 95% | **100%** | 95% | 95% |
| CH-9 | 67% | **71%** | 62% | 57% |

**Every chassis peaks at rank 10 and is worse at 18 than at 10.** Not flat —
declining. CH-9 loses 14 points between them. Since the ladder generates
opponents as `budget = f(node)`, a run gets *easier* as it goes, which is the
same fact `F2` measured from the template roster by a completely different
method. Two independent instruments now say it.

The invariants, stated in `packages/sim/src/invariants.ts`:

- **I1 rank monotonicity: 16/30 pass.** The clean failures are all above rank
  10 — e.g. CH-5 rank 18 beats CH-5 rank 14 only 50% of the time, where a
  one-step gap is supposed to win 60%.
- **I2 chassis parity: 0/4 pass.** At rank 6, CH-5 is **81 points** ahead of
  CH-2. At rank 10, CH-9 is 43 ahead of CH-2. Cell count is not paid for; the
  Mule's 32 cells simply carry more gun than the Vulture's 16.
- **I3 dead gear:** of the 19 ids the two locks offered, **`W-RG` was never
  wanted by any elite** — the tier-4 railgun, the dearest weapon in the game.
  Three offered mods (`tidecooler`, `coil-sprung`, `gyro-flywheel`) also went
  unused.

**Eleven of the archive's eighteen cells were never filled by anything.** No
long-ranged build at any rank on any chassis, nothing in the heavy weight class,
and nothing thermally cold outside one cell. Every elite is a close-to-mid
redliner. Some of that is the bucket edges being provisional (`docs/19`), but
"no long-range build is worth fielding" is not an artefact of a threshold — the
long bucket starts at 100 m and `W-RG` reaches 220.

**What is correct building worth:** k = **4** on all three chassis. A best-built
rank-6 mech falls to a coin flip against a best-built rank-10 one. That is the
number `ladderBudgetPerNode` should be argued from — but not yet, because it is
measured on a curve that peaks at 10, so it says as much about the peak as about
the player.

**Caveats, which matter here more than usual.** A search finds *a* ceiling, not
*the* ceiling, so each figure is a lower bound and the failures are the load-
bearing half: I1 failing is evidence, I1 passing would not have been. Budget 120
per (chassis, rank) is modest and two locks is a small sample. Both sides are
flown by the same autopilot, so this measures correct *building* only. And the
panel is built from the catalog being measured — `bastion-tank` is rank 25 and
loses to rank-6 builds, which is F2 again, in the yardstick.

**Not acted on.** Balance is its own pass and does not gate feature work. This
is the record, and the first thing the content pass should re-run.

---

## Non-findings, recorded so they are not re-investigated

- **`sim:diversity` is green.** Its only failure was a mismeasurement: the
  harness tested hull-down at 0.5 m/s where the perk fires at 1.5, reporting 2%
  activation instead of 37% and listing a live perk in `deadPerks`. Fixed by
  declaring `ModifierDef.isActive` beside `apply`. Do not cite diversity output
  from before 2026-08-18 as evidence of a balance problem.
- **Body collision (`fe265c3`) is innocent.** Measured, not assumed.
