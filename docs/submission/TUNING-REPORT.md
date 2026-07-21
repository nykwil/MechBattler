# Build Week tuning report

## Controlled experiment

- Frozen starting point: annotated tag `build-week-pre-final-tuning`, peeled commit `f37b044e7e143f6fdb3500d3039330396c11807a`.
- Acceptance cohort: 8 canonical archetypes, all 28 unordered pairs, 10 deterministic seeds per pair, 280 battles.
- Controls: base seed 1, alternating spawn sides, identical engine and global combat rules before and after.
- Screening: 5 seeds per pair for cheap roster experiments; targeted telemetry used seeds 9000–9004 for the same before/after matchups.
- Guardrails: no build above 70% overall; stock matchup target 35–65%; no generalist below 30%.
- Scope: fitting/content only. No weapon, chassis, terrain, simulation, or autopilot constants changed.

## Frozen pre-final baseline

Reproduced from the tag rather than copied from prose:

| Standing | Win rate | Tier budget |
|---|---:|---:|
| Vulture Skirmisher | 69% | 9 |
| Mule Gunline | 64% | 8 |
| Widow Orbiter | 64% | 8 |
| Vulture Sniper | 63% | 8 |
| Railgun Mule | 47% | 21 |
| Mule Laser Boat | 36% | 14 |
| Mule Skirmisher | 29% | 7 |
| Bastion Tank | 29% | 29 |

Headline: 280 battles, 0 dominance flags, 6 / 28 healthy matchups, and a 40-point roster spread. Mule Skirmisher was the weakest generalist. Its 10-seed row included 0–100 losses to Vulture Skirmisher, Mule Gunline, and Widow Orbiter.

The earlier controlled pass that produced this frozen state moved the original untuned roster from 4 to 6 healthy matchups, reduced spread from 52 to 40 points, removed the lone dominance flag, retuned Vulture Skirmisher from 76% to 69%, and retuned Widow Orbiter from 24% to 64%. That history remains reproducible in the frozen tag; this report's final comparison starts from the frozen state above.

## Diagnosis before tuning

The fitting-only sweep (`npm run sim:adapt -- 5`) found cheap recovery paths for four of Mule Skirmisher's five losing screening matchups: front armor against Vulture, Widow, and Vulture Sniper, plus a radiator against the Laser Boat. Mule Gunline remained HARD at 0%; no standard fitting op improved it.

Battle-level telemetry rejected a thermal diagnosis. Across seeds 9000–9004, stock Mule Skirmisher had zero shutdowns and zero brownout sheds against Gunline. Instead it was range-gated for 44% of recorded ticks, lost both MGs in all five fights, fired 945 shots at 62% accuracy, and dealt only 61.5 average damage. The failure was surviving the approach, not sustaining fire after arrival.

Bastion required no buff. In the acceptance cohort it beat both sniper kernels 100–0 and lost to the brawlers/generalists, exactly the intended armored counter/refit specialist pattern. Inflating its overall 29% would make the table prettier while erasing that identity.

## Rejected five-seed experiments

Every roster comparison below used the same five base-1 seeds. The frozen five-seed control was Mule 34%, 8 / 28 healthy matchups, and 40-point spread.

| Experiment | Mule | Healthy | Spread | Decision |
|---|---:|---:|---:|---|
| One front plate | 40% | 8 / 28 | 37 | Rejected: helped survival but did not improve matchup health. |
| One radiator | 34% | 8 / 28 | 40 | Rejected: no aggregate gain; telemetry had already shown no shutdowns. |
| Add a rocket pod | 40% | 7 / 28 | 37 | Rejected: reduced healthy matchups and still lost 0–5 to Gunline and Widow in the targeted cohort. |
| Two plates + radiator | 0% | 6 / 28 | 69 | Rejected overcorrection: added mass crossed the locomotion power threshold; the Mule was shed, range-gated, and fired zero shots in the targeted cohort. |
| Two front plates | 54% | 10 / 28 | 34 | Advanced to the evidence cohort. |

An earlier Vulture/Widow experiment also remains part of the tuning history: removing Vulture's MG while adding a third Widow weapon inverted them to 20% and 71%, so it was reverted. It proved the causal levers but was too coarse.

## Accepted change

**Mule Skirmisher:** add two tier-1 armor plates to the open outer cells of its front row. Budget 7 → 9.

This is a fitting-only change. The Mule remains a twin-MG electric brawler; it gains no new range band, damage source, cooling system, reactor, or doctrine. On targeted seeds 9000–9004, the plates moved Vulture from 1–4 to 2–3, Widow from 0–5 to 3–2, and Vulture Sniper from 1–4 to 2–3. Gunline stayed 0–5 and is documented below. Against Gunline, the armored Mule nevertheless doubled shots fired to 1,932, more than doubled average damage to 140.3, and reduced range-gated time from 44% to 26%—evidence that the chosen lever addressed access even where it did not erase the counter.

The separate targeted five-seed Laser Boat cohort regressed from 1–4 to 0–5, while the complete base-1 evidence cohort finished 5–5. Both results are disclosed: small cohorts remain seed-sensitive, and the mandated unmodified 10-seed roster cohort is the acceptance gate.

## Final 10-seed result

| Guardrail | Frozen pre-final | Final pass | Delta |
|---|---:|---:|---:|
| Global dominance flags | 0 | 0 | 0 |
| Healthy matchups | 6 / 28 | 8 / 28 | +2 (+33%) |
| Roster spread | 40 points | 37 points | −3 |
| Mule Skirmisher | 29% | 50% | +21 |
| Bastion Tank | 29% | 29% | Preserved specialist |

Final standings:

| Standing | Win rate | Tier budget |
|---|---:|---:|
| Vulture Skirmisher | 66% | 9 |
| Mule Gunline | 64% | 8 |
| Vulture Sniper | 60% | 8 |
| Widow Orbiter | 54% | 8 |
| Mule Skirmisher | 50% | 9 |
| Railgun Mule | 44% | 21 |
| Mule Laser Boat | 33% | 14 |
| Bastion Tank | 29% | 29 |

Mule Skirmisher's final row is 20% Vulture Skirmisher, 0% Mule Gunline, 50% Laser Boat, 60% Railgun Mule, 70% Widow Orbiter, 50% Vulture Sniper, and 100% Bastion. Compared with the frozen cohort, two of its three 0–100 losses softened to 20–80 and 30–70, while three stock matchups now sit inside the 35–65% band.

The roster retains multiple distinct viable plans: long-range Vulture kiting, combustion Gunline fire support, Widow orbiting, twin-MG Mule brawling, and high-budget railgun alpha. Bastion remains a specialist sniper counter rather than a generalist.

## Remaining limitations

- Only 8 / 28 stock matchups are inside the target band; polarization is still visible rather than averaged away.
- Mule Gunline still beats Mule Skirmisher 100–0 and remains HARD in the five-seed fitting sweep. Fixing it likely needs a new light-mech access fitting or a later kernel-level experiment—not a global rule change rushed into this pass.
- The final five-seed adaptation sweep reports 12 HARD directed matchups. Its separate base-9000 screening seeds expose seed sensitivity and are diagnostic, not a widened acceptance guardrail.
- Bastion's 29% overall rate is intentionally bimodal. It should be judged by its 100–0 sniper-counter results and refit identity, not forced toward 50% overall.
- Budgets still range from 8 to 29 among most archetypes; budget-matched confidence intervals remain future work.

## Reproduce

```bash
npm run sim:test
npm run sim:build
npm run sim:balance -- 10
npm run web:build
```

Expected headline: 139 tests across 18 files, 280 battles, 0 dominance flags, 8 / 28 healthy matchups, 37-point spread, Mule Skirmisher 50%, and Bastion Tank 29%.
