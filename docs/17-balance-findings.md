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
| railgun-mule | 49% | 49% | -4 |
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

Not re-baselined. Per the working agreement the baseline is only ever re-cut
during a deliberate balance pass, and this was a feature pass.

## Non-findings, recorded so they are not re-investigated

- **`sim:diversity` is green.** Its only failure was a mismeasurement: the
  harness tested hull-down at 0.5 m/s where the perk fires at 1.5, reporting 2%
  activation instead of 37% and listing a live perk in `deadPerks`. Fixed by
  declaring `ModifierDef.isActive` beside `apply`. Do not cite diversity output
  from before 2026-08-18 as evidence of a balance problem.
- **Body collision (`fe265c3`) is innocent.** Measured, not assumed.
