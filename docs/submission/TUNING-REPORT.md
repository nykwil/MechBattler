# Build Week tuning report

## Controlled experiment

- Frozen starting point: annotated tag `build-week-pre-final-tuning`, peeled commit `f37b044e7e143f6fdb3500d3039330396c11807a`.
- Acceptance cohort: 8 canonical archetypes, all 28 unordered pairs, 10 deterministic seeds per pair, 280 battles.
- Controls: base seed 1, alternating spawn sides, identical engine and global combat rules before and after.
- Screening: 5 seeds per pair for cheap roster experiments; targeted telemetry used seeds 9000–9004 for the same before/after matchups.
- Guardrails: no build above 70% overall; stock matchup target 35–65%; no generalist below 30%.
- Stock-roster scope: fitting/content only. No weapon, chassis, terrain, simulation, or autopilot constants changed in the Mule pass. The later diversity stress is documented separately below.

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

## Final reframing: build diversity and perk stress

The final submission pass deliberately stopped broad damage-number equalization. Arbitrary legal layouts do not need to be viable; the acceptance question became whether each chassis supports at least two coherent identities and whether rare perks create costly, situational build decisions without dominant stacks.

### Method and fixed cohort

- Representative roster: the 8 canonical templates plus 4 perk builds, all 66 unordered pairs, 5 deterministic seeds per pair, 330 battles, base seed 1.
- Perk attribution: each perk build and its unmodified control fought all 8 canonical opponents on identical seeds. Activation was sampled over that complete cohort, not a selected favorable opponent.
- Dominance gate: no representative build above 70% overall.
- Dead-perk gate: the condition must be active for at least 5% of recorded frames and improve at least one fixed-seed matchup.
- Stacking gate: one mod per part; high-leverage perks declare a per-build copy limit.
- Canonical safety rail: the separate 10-seed/280-battle stock audit must remain unchanged and below the 70% dominance limit.

Final deterministic stress result:

| Perk identity | Control | Perk | Aggregate delta | Condition active | Best fixed matchup delta |
|---|---:|---:|---:|---:|---:|
| Vulture Cold Bore ambusher | 60% | 57% | −3 | 100% | +40 vs Mule Gunline |
| Mule Fever Cycle laser boat | 45% | 40% | −5 | 15% | +20 vs Mule Skirmisher |
| Widow gyrostabilized AC gunship | 70% | 63% | −7 | 84% | +20 vs Mule Skirmisher |
| Bastion Hull-down suppression bunker | 50% | 53% | +3 | 25% | +20 vs Bastion Tank |

Headline: 12 builds, 330 battles, 19 / 66 matchups inside 35–65%, no build above 70%, no dead representative perk, and the duplicate-Fever test rejected with `fever-cycle appears 2 times; build limit is 1`. The negative aggregate deltas are intentional evidence that these are not automatic upgrades; each pays for a matchup niche.

Representative standings:

| Build | Win rate | Record |
|---|---:|---:|
| Mule Gunline | 67% | 37–18–0 |
| Widow Gyro Gunship | 64% | 35–20–0 |
| Vulture Skirmisher | 56% | 31–24–0 |
| Widow Orbiter | 56% | 31–24–0 |
| Vulture Sniper | 55% | 30–24–1 |
| Mule Skirmisher | 49% | 27–28–0 |
| Railgun Mule | 47% | 26–29–0 |
| Vulture Cold Bore | 44% | 24–30–1 |
| Mule Fever Cycle | 44% | 24–31–0 |
| Bastion Hull-down | 40% | 22–33–0 |
| Mule Laser Boat | 38% | 21–34–0 |
| Bastion Tank | 38% | 21–34–0 |

### Accepted build-defining perks

| Perk | Conditional payoff | Explicit cost or drawback |
|---|---|---|
| Cold Bore | Dispersion ×0.5 below 40°C | Damage ×0.9 at every temperature; the representative Vulture spends a cell on extra thermal mass. |
| Fever Cycle | Cycle time accelerates above 50°C, scaling with heat | Weapon draw ×1.25 at every temperature; requires a Hot-running setup and risks thermal/power collapse. |
| Gyrostabilized | Own-motion aim jitter ×0.5 | Weapon mass ×1.25, worsening chassis load and CoG pressure. |
| Hull-down suspension | Target profile ×0.7 below 1.5 m/s | Requires a connected, powered two-cell Stride, adds 25% servo mass, and switches off while moving. |
| Marsh pistons | Ignores water/forest speed penalties | Stride draw rises from 4 to 6 kW; unique per build. |

The pass also repaired Stride's catalog contract: it previously occupied two cells and drew 4 kW while its documented +15% speed never entered derived stats or combat movement. The effect is now connected/powered/functional, capped at the best installed copy, and non-multiplicative. Dynamic modifier effects now feed the autopilot's expected-DPS calculation as well as shot resolution, so the planner no longer evaluates a different weapon than the arena resolves. These are substrate correctness fixes, not global damage, chassis, terrain, or autopilot-constant tuning.

### Chassis identity and fitting audit

| Chassis | Coherent identities represented |
|---|---|
| CH-2 Vulture | Hybrid range skirmisher; ram-air carbine sniper; overcooled Cold Bore ambusher |
| CH-5 Mule | Combustion gunline; armored twin-MG brawler; hybrid laser boat; capacitor railgun; Fever redline laser |
| CH-7 Widow | Carbine orbit skirmisher; gyrostabilized autocannon gunship |
| CH-9 Bastion | Armored close siege specialist; Hull-down suppression bunker |

All four chassis therefore clear the two-identity requirement. The small CH-2 has 16 usable cells. Its weapon-plus-reactor kernels leave 8–10 cells for fittings, while the coherent Vulture builds finish with only 2–4 free cells. That is tight enough to force meaningful choices without preventing a second or third identity. The railgun Mule is actually the tightest representative finished layout at one free cell.

### Overlapping-part audit

- Heat sink versus radiator is meaningful: one cell of burst thermal mass versus three perimeter cells of sustained dissipation.
- Armor versus heat sink is meaningful: 60 HP and 150 kg of lane protection versus sixfold thermal mass at 60 kg.
- Electric versus combustion reactor is meaningful: cool instant 25 kW versus hot lagged 40 kW at the same tier.
- Machine gun versus autocannon is meaningful: cheap two-cell close saturation versus a six-cell midrange recoil platform with large damage packets.
- Targeting computer versus Gyrostabilized is meaningful: target-motion tracking for 3 kW versus own-motion stability paid in weapon mass.
- Carbine versus laser remains an overlap watch: both occupy precision bands, but the carbine pays tracking/recoil while the laser pays charge spikes, hitscan premium, and heat.
- Ammo is a dead placeholder in the current simulation: it adds cook-off risk, but ballistics do not consume ammunition. It is not presented as a positive fitting choice until the ammo system lands.

### Rejected diversity experiments

| Experiment | Evidence | Decision |
|---|---|---|
| Empty-frame Bastion rail/AC anchors | Screened at 90–100% overall before the perk while Hull-down was active only about 3–4%. The large 56-cell silhouette influenced hit probability, but empty entry cells let shot rays pass through without paying real fitted mass or systems. | Rejected as chassis-specific empty-grid abuse, not a perk identity. Replaced with a densely fitted one-MG suppression bunker. |
| Fever Cycle above 60°C | Only 2–3% activation across all canonical opponents; the carrier peaked near 67°C, so the advertised payoff was effectively dead. | Rejected threshold. The onset moved to 50°C while retaining the permanent 25% draw tax and heat-scaled payoff. |
| Remove the Fever build's radiator | Activation remained about 3%; aggregate performance did not improve and one matchup regressed by 40 points. | Reverted. It removed coherent thermal plumbing without making the perk function. |
| Single-opponent activation benchmark | It reported Fever at 0% and Hull-down near 5% even though both gained elsewhere. | Rejected as benchmark bias. Activation now covers every canonical opponent on fixed seeds. |
| Duplicate Fever on both lasers | The combination invites a copy loop before rarity or cost can constrain it. | Rejected mechanically: the build-level audit and machinist UI enforce Fever's one-copy limit. |

Powerful roguelike synergies remain welcome when setup, rarity, geometry, heat, power, mass, or a declared copy limit makes them interesting. The harness rejects automatic dominance and dead text; it does not flatten a rare payoff merely because one prepared matchup swings sharply.

## Remaining limitations

- Only 8 / 28 stock matchups are inside the target band; polarization is still visible rather than averaged away.
- Mule Gunline still beats Mule Skirmisher 100–0 and remains HARD in the five-seed fitting sweep. Fixing it likely needs a new light-mech access fitting or a later kernel-level experiment—not a global rule change rushed into this pass.
- The final five-seed adaptation sweep reports 12 HARD directed matchups. Its separate base-9000 screening seeds expose seed sensitivity and are diagnostic, not a widened acceptance guardrail.
- Bastion's 29% overall rate is intentionally bimodal. It should be judged by its 100–0 sniper-counter results and refit identity, not forced toward 50% overall.
- Budgets still range from 8 to 29 among most archetypes; budget-matched confidence intervals remain future work.
- The 12-build perk cohort is representative, not an exhaustive combinatorial search. Future content should expand it with generated legal fits and rarity-weighted acquisition paths.
- U-AMMO is not a meaningful positive choice until ammunition consumption exists; W-CB versus W-LAS remains the closest catalog overlap.

## Reproduce

```bash
npm run sim:test
npm run sim:build
npm run sim:balance -- 10
npm run sim:diversity -- 5
npm run web:build
```

Expected headline: 153 tests across 19 files; canonical 280 battles with 0 dominance flags, 8 / 28 healthy matchups, 37-point spread, Mule Skirmisher 50%, and Bastion Tank 29%; diversity 330 battles with 0 dominant combinations and 0 dead representative perks.
