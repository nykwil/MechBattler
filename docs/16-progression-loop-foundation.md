# Progression loop foundation

The balancing target is the experience after roughly one hour, represented by
eight resolved battles. A defeat still ends the current run; the headless loop
starts a new run with persistent profile unlocks until the cohort has observed
eight battle outcomes. This makes losses visible without letting a short run
truncate the progression measurement.

## The progression model, as it now stands

Read this section for the current state. The numbered passes below are the
record of how it got here, kept because several of them are records of things
that were tried and did *not* work.

**The run.** Twelve nodes. Three are scrapyards, placed anywhere from node 2 on.
A defeat ends the run; the profile keeps its unlocks and the next run starts
from the best fit those unlocks allow, on the same chassis.

**The opening.** A fresh player flies `mule-needle` — three barrels of mixed
reach at tier 11 of a 14-tier budget, built only from the seven initial parts.
Three weapons rather than two because the dominant way a fresh run ended was
being *disarmed*, not destroyed. It opens around 0.95 and decays to a coin flip
by node 9, so the first fights are winnable and the later ones are not free.

**The ladder.** Opponent budget is `3 + 1.0 x node`, drawn from a pool that
includes three deliberately weak fodder frames so every node can field all three
chassis — the Vulture from node 1, the Bastion from node 1. Threat is rated from
the build the generator actually produced, including chassis structure, so the
number on the card tracks the fight behind it. Elite cards carry +4 budget and
announce themselves.

**Unlocks.** A chassis unlocks by defeating an enemy flying it. All three are
reached from a fresh profile at battle 1, and all fifteen target parts by battle
1. Nine further parts sit behind combat challenges; `redline` (reach 115 C) is
reachable in principle after the thermal rescale but still rarely earned.

**The economy.** Purse is `20 + 12 x node`; repairs cost 0.3 x tier per
integrity point, and the chassis body is repaired separately from equipment.
Salvage offers the whole wreck: take parts (with their modifiers), take the
scrap, or pay for whole-wreck recovery and change frames. Every third victory
offers a machinist modifier at 25 scrap.

**Measured, on a 3-seed 8-battle cohort:**

| | value |
| --- | --- |
| distinct build archetypes | 16 |
| build directions per chassis | CH-5: 10, CH-9: 7, CH-2: 3 |
| most common archetype | 30% of final builds |
| parts never fielded | none |
| fresh win rate / mean run | 0.85 / 4.0 battles |
| one-hour win rate / mean run | 0.85 / 4.0 battles |
| fresh build divergence over a run | 0.045 -> 0.182 |
| one-hour build divergence over a run | 0.351 -> 0.376 |
| chassis identity | within 0.15-0.29, between 0.44 |
| round robin spread | 27-68%, nothing above the 70% flag |

**To play it**, not just measure it:

Profile & unlocks → **Load one-hour state** (also `?unlock=one-hour` in
dev). That seeds all three chassis, the fifteen-part pool and the nine probe
mechs into the garage, then: New run → Load a probe → Launch.

## Two profiles, two questions

- `fresh` starts with the Mule Skirmisher, the seven initial parts, and no
  challenge progress. It measures what the shipped unlock rules actually
  produce. It never grants the target fixture to make a report pass.
- `one-hour` is an explicit design fixture: Vulture, Mule, Bastion and the
  15-part target pool are unlocked. Its nine saved probe mechs cover three
  distinct directions for each chassis. It measures whether the intended pool
  can already support differentiated growth.

The target pool is `R-E25`, `W-MG`, `W-CB`, `U-CON`, `U-PIPE`, `U-RAD`,
`U-ARM`, `R-C40`, `W-AC`, `U-HS`, `U-TUR`, `U-SHELL`, `U-TC1`, `W-LAS`, and
`U-ACT`.

## Deterministic policies

`survival`, `range`, `thermal`, and `armor` policies rank opponents using only
the threat, headline, confirmed parts, and carried-mod facts visible before a
battle. They do not simulate every opponent and select the winning result.
After a victory they rank real salvage, pay for repairs and applicable mod
services, and attempt a legal refit using owned part instances. Scrapyard
decisions use the same policy score.

Every whole-build refit is atomic. The proposed regional placement and routes
must pass authoritative sim validation before run state changes. Integrity,
variants, modifiers, and provenance come from run inventory rather than from
the proposed build, so tooling cannot repair or duplicate an item accidentally.

## Build fingerprints and traces

Each battle records before/after fingerprints containing weapon family and
IDs, range band, burst DPS, power supply/demand/margin, heat input/cooling/
margin, mass/load/speed, armor and protected-payload counts, active location
effects, and installed modifiers. The trace also records the chosen opponent,
the visible facts used, unlock gains, reward decisions, and refits.

Run the default full audit with:

```bash
npm run game:loop -- --seeds 1 --battles 8
```

Useful focused forms:

```bash
npm run game:loop -- --profile fresh --policy survival --seeds 5
npm run game:loop -- --profile one-hour --policy range --seeds 73001,74001
npm run game:loop -- --json artifacts/progression-loop.json
```

The CLI exits nonzero for broken trace/loop invariants and reports target gaps
as data. On the first seed-73001 baseline, the full 128-battle audit made 45
reward decisions and 25 successful refits. The combined fresh cohort reached
all 15 target parts but not Bastion. That is the next unlock-curve balancing
question, not a reason to weaken the instrumentation.

## Reading a cohort

`game:loop` emits the raw trace. The questions the design actually asks — how
long runs survive, when unlocks land, whether builds drift apart — are not
answerable from aggregate win/loss, so `game:loop-report` derives them:

```bash
npm run game:loop -- --seeds 3 --battles 8 --json artifacts/loop.json
npm run game:loop-report -- artifacts/loop.json
```

`--json` resolves relative to `packages/game`, not the repo root.

It reports per-profile run-length distribution, unlock reachability as the
battle index at which each target was first gained, mean pairwise build
distance after the first and last battle, within- versus between-chassis
spread, and opponents the cohort never beat. Anything it can prove wrong it
lists in `warnings`.

Reachability counts starting equipment as reached at battle 0. Reading it only
from `gains` reported the seven initial parts as never reached, because a part
you begin with is never gained.

## What the first measured pass found

Run length is not an independent dial. Every loss ends the run, so mean run
length is `1/(1-winRate)` and the baseline's 1.4-battle runs were exactly what
its 0.33 win rate predicts. No content change produces eight-battle runs at
that win rate; an eight-battle run needs a per-fight win rate near 0.85. The
`balanceTargetWinRateMin/Max` band of 0.35-0.65 in `content.ts` cannot coexist
with eight-battle runs under run-ending defeat, and is the next thing to
settle.

Three defects were found by measurement and fixed:

- **Threat was noise.** It was rated from budget *fill fraction*, so threat 1
  never occurred and threat 2 and 3 had the same DPS distribution. Two cards at
  one node differed by 40 points of win rate with nothing on screen to separate
  them. `opponentThreat` now rates the generated build. Threat 1/2/3 now sit at
  median 13.3/28.3/45.0 DPS.
- **The ladder walked off the light templates.** `generateOpponent` picked from
  the biggest bases that fit, so a rising budget shifted the eligible set onto
  heavy frames: scouts vanished after node 5, DPS *fell* from 28.3 to 17.0 mid
  ladder while HP tripled, and late fights became sponges. The base window is
  now a fraction of budget, and the fill weapon cap scales with budget.
- **Bastion was unreachable.** A chassis unlocks by defeating an enemy flying
  it, and the only Bastion base costs tier 23 — more than the ladder ever
  spends. The three Bastion branch probes are legal, authored, materially
  distinct and cost tier 11-13, which is also the gap the template pool had
  between tier 9 and 18. `LADDER_TEMPLATES` adds them for opponent generation
  only; `TEMPLATES` is untouched so the balance cohort does not move.

Measured effect on a 3-seed, 8-battle cohort: all three chassis now appear at
every node with Bastion from node 2 (previously node 7), and builds diverge
over a run for the first time — fresh 0.014 to 0.025, one-hour 0.328 to 0.336.
Chassis identities hold, with within-chassis spread 0.14-0.25 against
between-chassis 0.40. `npm run verify` exits 0.

Still open: per-fight win rate is 0.40 fresh / 0.32 one-hour, so runs still
average 1.5 battles and fresh still never *beats* a Bastion. The player starts
on a tier-6 template against a ladder that opens at budget 6 and climbs to 20,
so the ladder overtakes the player around node 4. Starting power and the
win-rate band are the next levers.

## Calibrating the ladder

The cohort loop measures a whole run and takes minutes. The ramp is set by one
relationship — how a given build fares at a given budget — and
`ladder-calibration.mjs` measures just that, in seconds:

```bash
cd packages/game
node --import tsx scripts/ladder-calibration.mjs --seeds 24 \
  --template mule-skirmisher,probe-bastion-thermal
```

It prints win rate per node alongside the run length that rate implies, so a
budget curve can be fitted instead of guessed.

**Sweep spawn distance or the numbers are wrong.** `runBattle` defaults to
`DEFAULT_SPAWN_DISTANCE_M = 160`, the longest distance the ladder offers.
Measured only there, every short-range build reads as unviable and every
long-range one as strong. That artefact produced a confident and false reading
that range was a strict dominance order rather than a tradeoff: corrected,
`probe-bastion-suppression` went from 0.099 to 0.396 and `mule-skirmisher` from
0.203 to 0.312. The calibration script now samples `LADDER_SPAWN_DISTANCES_M`.

## Second measured pass

**Tier does not predict strength.** `probe-bastion-suppression` is tier 11 with
480 HP and was winning 3% of fights; tier-9 `probe-mule-thermal` won 46%. Two
of the three Bastion probes shipped with negative power margin — the stride
owed 29.8 kW to a powered actuator and twin MGs against a 25 kW plant, and the
bunker owed 8.6 kW more than its combustion plant supplied. Both browned out
and shed the weapons they exist to carry, so Bastion supported none of its
three intended directions. A second plant on each fixed it: the bunker went
from 0.031 to 0.677 measured win rate, the stride from 0.031 to 0.396.

**Engagement range was on the card and unused.** `spawnDistanceM` is a visible
opponent fact, and the deterministic policies ignored it. Measured across
distances, a 75 m build scores 0.63 at 40 m and 0.00 at 160 m, while a 135 m
build scores 0.75 at 40 m and 0.92 at 160 m — so the matchup is a real decision
as long as the chooser reads the distance. `chooseOpponent` now prefers cards
whose spawn falls inside the mech's band, the spawn pool gained 40 m, and the
distance is recorded in `visibleOpponentFacts`.

Measured effect on a 3-seed, 8-battle cohort: one-hour win rate 0.323 to 0.392,
and runs reaching four battles tripled from 3 to 12. `npm run verify` exits 0.

**Watch for carbine spam.** W-CB is tier 2, 180 m, 13.3 DPS and only 4 kW —
strictly better reach than the tier-2 autocannon for less power. A legal
tier-13 start of two reactors and three carbines measured a 1.000 win rate at
160 m. That build is why the starting kit was not simply switched to carbines,
and W-CB's cost is the next balance question.

## Third pass: why Vulture has no viable direction

Vulture measures 0.09-0.19 on every build tried, against a target of three
viable directions per chassis. It is not a stat-tuning problem.

`probe-vulture-close` and `probe-mule-brawler` have near-identical derived
stats — HP 275 both, 30 DPS both, power 5.6 against 5.8 — and score 0.13
against 0.42. The gap is the chassis, and the mechanism is accuracy:

| build | own hit% | incoming hit% |
| --- | --- | --- |
| vulture-close | 77.7 | 89.6 |
| mule-brawler | 89.0 | 92.1 |
| bastion-thermal | 98.2 | 95.5 |

Being small and fast buys 2.5 points of evasion and costs 11 points of the
Vulture's own accuracy. The reason is that **evasion never engages**. In the
hit model, evasion is lead error, which comes only from *lateral* speed, and
the autopilot only generates lateral speed by orbiting. Measured across whole
battles, lateral speed is 0.06-0.51 m/s against chassis top speeds of 4.6-10.35,
and orbit is chosen in under 6% of frames — zero frames for the Bastion.

At that lateral speed the erf is saturated: pHit is 1.000 for all three chassis
at every range under 160 m, so silhouette is irrelevant. At a real 6 m/s
crossing the same model gives 0.41 / 0.53 / 0.70 by chassis, where size matters
enormously. The mechanic is well built and dormant.

The autopilot is not wrong to stand still. `MOVE_JITTER_MRAD_PER_MPS` is 0.3,
so orbiting at 6 m/s adds 1.8 mrad — a 90% dispersion penalty on a 2.0 mrad
carbine — and its exchange calculation correctly finds that moving costs more
accuracy than the evasion returns.

Two experiments confirmed stat tuning cannot reach it. Raising the Vulture's
strafe from 3.0 to 6.0 and reverse from 2.5 to 4.5 (kept: the scout shipped
with the worst strafe:fwd ratio of the three, 0.33 against the Mule's 0.67,
which is an identity defect regardless) left lateral speed at 0.49 and win rate
flat. Cutting move jitter to 0.1 made the Vulture *worse* — 0.19 to 0.13 —
because cheaper movement helps every shooter, and the Vulture is the one that
needs the enemy to miss. That change was reverted.

### The fix: the approach was the problem, not the stats

The hit equation is correct and matches its own spec. Reproduced directly, an
autocannon at 40 m against a target crossing at 3 m/s hits 74% — exactly the
figure docs/03 §9 records. Every number in that spec assumes a crossing target.
100% is the right answer for a *stationary* one, and the design never intended
targets to stand still.

The autopilot did evaluate orbiting, and chose it correctly. The problem was
everything before that: a mech spent ~84% of a battle in transit, and transit
was a straight line at the enemy. Movement costs dispersion by *total* speed but
only earns evasion from the *lateral* component, so walking in pays the full
accuracy price and collects none of the defence — while being shot at 100%.
`probe-vulture-close` logged 4053 closing frames, 1145 retreating, 757 fleeing
and zero holding.

The autopilot may now close on a slant, choosing the angle with the same
exchange calculation that chooses the range (`APPROACH_SLANT_RAD`, ~20 and 40
degrees; crossing is sin(angle), added path length is 1/cos(angle)). Measured
lateral speed went from 0.63 to 2.48 m/s for the scout and 0.24 to 1.98 for the
Mule — into the band the model was written against — while the Bastion stayed at
0.07 and correctly kept standing still. Hit rates moved off the ceiling and the
gradient inverted to the intended one:

| build | own hit% | incoming hit% |
| --- | --- | --- |
| vulture-close | 75.9 | 71.2 |
| mule-brawler | 77.8 | 82.0 |
| bastion-thermal | 92.1 | 96.5 |

Small and fast is now harder to hit than to hit with; large and slow is the
reverse. `moveJitterMult` on the chassis carries the rest: a scout pays 0.35 of
the baseline dispersion for crossing, the other two pay 1.

Three consequences had to be paid for, all measured in the round robin:

- **bastion-tank fell 55% to 13%** — the biggest silhouette and slowest strafe
  in the game, suddenly the only frame that could neither evade nor lead. It now
  carries a U-TC1, which docs/03 §5 names as *the* purchasable counter to a
  crossing target (lag 0.3 s to 0.1 s). Back to 45%.
- **mule-laser-boat rose 67% to 87%**, over the docs/05 R4 kill criterion.
  Hitscan pays only tracking lag where a ballistic gun also pays time-of-flight,
  so lasers became the answer to a game that now moves. Targeted nerf per R4: it
  loses its armour plate and the combustion half of its hybrid. 68% after.
- **Three test fixtures stopped exhibiting the properties they assert** and were
  re-based, not weakened: the golden battle re-pinned with a SIM_VERSION bump to
  2.1.0 as its own comment instructs; the flee test moved to a matchup that is
  still out-ranged and losing, because the scout no longer is; and the
  integrity test moved from seed 42 to 26, where the plate is still stripped —
  at 42 it survived both runs and the assertion had started comparing two
  Infinities, which would have passed vacuously.

Round robin before and after, 10 seeds per pair:

| template | before | after |
| --- | --- | --- |
| mule-laser-boat | 67% | 68% |
| mule-gunline | 67% | 62% |
| vulture-skirmisher | 37% | 58% |
| vulture-sniper | 47% | 53% |
| bastion-tank | 55% | 45% |
| mule-skirmisher | 43% | 37% |
| railgun-mule | 33% | 27% |

Nothing is above the 70% flag, and the Vulture went from the bottom of the
table to the middle. Cohort effect: both divergence warnings cleared for the
first time (fresh 0.011 to 0.028, one-hour 0.321 to 0.335, both rising), every
"never beaten" opponent warning disappeared, and one-hour win rate reached
0.413. `npm run verify` exits 0.

## Fourth pass: the start, and what a loss carries forward

Two changes moved the loop more than anything before them.

**The starting mech was losing by being disarmed, not by dying.** Every node-1
loss traced the same way: both weapons destroyed, mission-kill, in 9 to 27
seconds, against a 15 DPS opponent. A two-gun start surrenders as soon as it
loses both, and the 20 hp carbine is the softest weapon in the catalog — a twin
carbine fit was disarmed in 10 of 20 opening fights. `mule-needle` carries
three barrels of mixed reach instead, at tier 11 of the 14-tier budget, from the
initial parts only. Measured against the ladder it opens 0.95 / 0.85 / 0.70 /
0.85 and decays to a coin flip by node 9: you win the opening, then have to have
built something to go further. Against the old starter's whole-ladder mean of
0.287, it measures 0.617.

`mule-skirmisher` is untouched and stays in the ladder and the balance cohort.

**Losing carried nothing forward.** Every restarted run fielded the identical
template, so the seventh run flew exactly what the first one did and no unlock
could ever appear in a starting build — which is why fresh cohorts finished with
a pairwise build distance of literally zero. `bestUnlockedStart` now picks the
best fit the profile has actually unlocked, restricted to the chassis the cohort
is flying and to the starting tier budget, so it can only choose something the
player could have built too. Ranking globally instead made all three chassis
drift onto whichever template scored best and the identities measured as
converged — an artefact of the chooser, which is why the frame is pinned.

Two supporting fixes came out of the same pass:

- **W-CB was underpriced at tier 2.** Longest reach short of the tier-4 railgun
  and the most accurate gun short of it, for less power than the autocannon it
  out-ranges. Three of them behind two reactors came to tier 13 — inside the
  starting budget — and measured a 93% win rate. At tier 3 that fit costs 16 and
  has to be grown into. A dispersion nerf was tried alongside and reverted: it
  did not change the build's cost, and weakening every carbine user around the
  laser boat pushed that template back over the 70% flag.
- **The bottom of the ladder had one silhouette.** Lowering the opening budget
  so a fresh mech can win made nodes 1-2 come out 93% CH-5, because the cheapest
  template in the pool was a tier-5 Mule. Since a chassis unlocks by beating an
  enemy flying it, the Vulture became unreachable in practice. Two deliberately
  weak fodder frames (`vulture-scrapper`, `mule-runt`, tier 3) and a lower
  eligibility floor give every node all three chassis, Vultures from node 1.

Measured on a 3-seed, 8-battle cohort, against the pass-one baseline:

| | baseline | now |
| --- | --- | --- |
| fresh win rate | 0.406 | 0.792 |
| fresh mean run | 1.6 | 3.1 |
| fresh runs reaching 4 battles | 0 | 11 |
| one-hour win rate | 0.302 | 0.736 |
| one-hour runs reaching 4 battles | 1 | 31 |
| fresh build divergence over a run | 0.045 -> 0.042 | 0.029 -> 0.054 |
| CH-2 first unlocked | battle 1 | battle 1 |

Chassis identities hold with within-chassis spread 0.054-0.232 against
between-chassis 0.405. `npm run verify` exits 0, `npm run web:campaign` advances
a node, and the round robin spans 27-68% with nothing above the R4 flag.

## Fifth pass: reaching the third chassis, and probe budget parity

**CH-9 was not a difficulty problem, it was an encounter-frequency problem.**
Win rate hides this, so `game:loop-report` now reports win rate per *opponent
chassis*. It showed a fresh cohort meeting a Bastion once in 96 battles. Three
things compounded: the Bastion templates cost tier 11-13 so none fit an early
budget, a chassis unlocks only by beating an enemy flying it, and the policies
always take the lowest-threat card — which the biggest frame never is.

Three fixes, and CH-9 now unlocks at battle 1:

- **Threat now counts chassis structure.** It read equipment HP only, so a
  sparsely fitted assault hull looked like fodder — 700 points of structure
  against a scout's 240 is most of what it takes to kill the thing, and a card
  that hides that is lying about the fight.
- **`bastion-picket`**, tier 4. The frame itself costs nothing in tier terms, so
  an assault hull with one gun and one plate can sit at the bottom of the ladder
  beside the scrapper and the runt. It still rates threat 2, because it is still
  700 points of structure. All three chassis now appear at every node.
- **The policies will pay a step of threat for a locked chassis.** The card
  names the chassis, so this is still a decision made from the card. An unlock
  you never meet is not a hard unlock, it is an unreachable one.

**The branch probes were not spending the same budget.** Against a 14-tier cap
they ran 6/8/9 (Vulture), 5/6/8 (Mule) and 11/12/14 (Bastion) — so the one-hour
fixture was not comparing chassis, it was comparing a kitted hull against two
half-empty ones, and the "Bastion is stronger" reading was mostly a budget
reading. Brought to parity, the whole-ladder spread went from 0.22-0.72 to
0.39-0.72.

That change needed the probes separated first: `probe-mule-brawler` *was*
`muleSkirmisher()`, so growing a probe silently moved the canonical balance
cohort with it. The probes are their own fits now, grown from the same kernels
through `withExtraParts`; the round robin is byte-identical before and after.

Two things worth keeping in mind from this pass:

- **The Vulture is hard-capped at 13 tier.** Greedy-filling each chassis from
  the one-hour pool carries 13 tier on CH-2 against 30 on both others. It can
  just reach the starting budget and can never grow past it, which is a real
  structural asymmetry the tier economy does not currently compensate.
- **Divergence growth is only the right question when builds start alike.** The
  one-hour fixture starts on nine deliberately different probes near 0.33, so
  demanding it climb further asked it to diverge from a spread it was designed
  to have; it failed by holding steady, which is the success condition. Cohorts
  that start together must spread, cohorts that start apart must stay apart.

Measured on a 3-seed, 8-battle cohort:

| | baseline | now |
| --- | --- | --- |
| fresh win rate | 0.406 | 0.740 |
| fresh mean run | 1.6 | 3.0 |
| one-hour win rate | 0.302 | 0.719 |
| one-hour mean run | 1.37 | 2.74 |
| one-hour runs reaching 4 battles | 1 | 26 |
| fresh divergence over a run | 0.045 -> 0.042 | 0.027 -> 0.179 |
| one-hour divergence over a run | 0.353 -> 0.344 | 0.328 -> 0.340 |
| chassis reached from fresh | CH-5, CH-2 | CH-5, CH-2, CH-9 |
| warnings | 8 | 4 |

Fresh builds now finish a run 6.6x further apart than they start it. Chassis
identities hold, with within-chassis spread 0.151-0.240 against between-chassis
0.410, and each frame keeps a different primary weapon set. `npm run verify`
exits 0, `npm run web:campaign` advances a node, and all seven mobile screens
pass.

## Sixth pass: the run economy, and five eliminated hypotheses

`game:loop-report` gained **run depth** — win rate and losses per node, plus win
rate by battle index — because mean run length says a run is short without
saying where it ends. It ends at node 3-4, sharply, in every cohort.

Four changes landed, each measured:

- **Salvage was being under-taken.** The rule always allowed a bench-full of
  loot; the policy took the single best part and scrapped the rest. It now keeps
  everything within 60% of the best pick, bench room permitting, and leaves the
  rest for scrap because repairs have to be paid for.
- **The ladder was outrunning the player.** Across a run the player's build
  measurably improves — parts 8.6 to 10.8, DPS 39 to 47, armour 3.6 to 5.3 — a
  ~20% gain, against a ladder that was gaining 175% of its opening budget over
  the same five nodes. The ramp is now `3 + 0.7/node` (4 to 11 across twelve)
  rather than `2 + 1.5` (4 to 20).
- **The player ran out of the ability to play.** Repairs per fight fell 3.6 /
  3.1 / 2.7 / 1.3 / 0.4 across nodes 1-5 and win rate tracked it exactly, 0.90 /
  0.90 / 0.82 / 0.44 / 0.11 — `repairOwnedPart` silently no-ops when the bill
  exceeds the purse. Purse per node 5 to 12 and repair cost per point 0.4 to
  0.3. Repairs rose 28% (fresh) and 31% (one-hour); scrapyard skips halved.
- **Elites were being walked into.** An elite is floored at threat 2 and so were
  many ordinary cards, so the range-fit tiebreak chose between them blind — and
  chose elites 40-59% of the time by node 5 against a 25% spawn rate, each with
  +4 budget and a modifier. The card already says `carries`; the policy now
  reads it.

The economy tests were re-pointed at the dials rather than re-pinned: they exist
to prove repair cost and purse *are* configurable, so freezing their current
output made tuning them look like a regression.

`meanIntegrity` joined the build fingerprint. Everything else in it describes a
build on paper, and on paper a run's mech only improves; nothing recorded that
the same build was wearing out.

### What the cliff is not

Five hypotheses were tested against the traces and eliminated. Recording them so
they are not re-run:

- **Not the budget ramp.** The *chosen* opponent is nearly flat across the
  ladder — DPS 19.7 to 24.1 and part HP 172 to 253 from node 1 to node 7, with
  structure steady near 340 — while the player's paper DPS climbs from 38.7 to
  48.3.
- **Not repair starvation.** Fixing the purse raised repairs by ~30% and moved
  mean run length by 0.08 battles.
- **Not integrity decay.** Mean integrity entering node 3 is 0.907, down 9%,
  where win rate halves.
- **Not disarming.** Losses at node 4+ are overwhelmingly `chassis-failure`, not
  `mission-kill`, and weapon count is stable at 2.7-3.4 throughout.
- **Not elite selection or scrapyard spending.** Both were fixed on their own
  merits and both moved aggregate win rate by under a point — though reserving
  scrap for repairs did lift the battle-3 dip from 0.25 to 0.50.

The remaining candidate is the interaction the fingerprint still cannot see:
what the opponent's *placement* does, rather than what it carries. That is the
next thing to instrument.

Cohort after this pass: fresh win rate 0.802 with mean run 3.2, one-hour 0.743
with 2.88. `npm run verify` exits 0, `npm run web:campaign` advances a node, all
seven mobile screens pass, and the round robin is unchanged at 27-68%.

### Cohort runtime

Long runs plus full benches made `tryBestRefit` dominate cohort time — bench x
cells x rotations, each fully validated and auto-wired, took a 3-seed cohort
from 7 minutes past 40. It now shortlists the four best bench parts by the same
score the policy already uses. Budget 15-25 minutes for
`--seeds 3 --battles 8`.

## Seventh pass: the cliff was chassis damage, and diversity gets measured

**The cliff was that you could not repair your own frame.** A pristine
`mule-needle` fighting the *real* ladder cards with the *real* policy choice
wins 1.000 / 1.000 / 0.944 / 0.863 / 0.916 across nodes 1-5 — the ladder was
never the problem. Chassis integrity persists between fights exactly like part
integrity, but the only thing that undid it lived inline in the workshop
component, so it existed for a player clicking a button and for nothing that
reasoned about a run. The headless loop modelled a pilot who could fix every
component and never the frame under them.

`chassisRepairCost` and `repairRunChassis` are domain functions now, the policy
repairs the frame before its parts (it is the one repair that compounds), and
`App.tsx` calls the shared rule instead of doing its own arithmetic.

| | before | after |
| --- | --- | --- |
| fresh win rate | 0.802 | 0.885 |
| fresh mean run | 3.2 | 4.36 |
| longest run | 6 | 8 |
| one-hour win rate | 0.743 | 0.816 |
| one-hour mean run | 2.88 | 3.35 |

Runs reach nodes 7 through 10 for the first time. With the ramp then returned to
1.0/node the settled figures are 0.833 / 4.0 battles fresh and 0.847 / 3.74
one-hour.

Both `meanIntegrity` and `chassisIntegrity` are now on the build fingerprint.
Everything else in it describes a build on paper, where a run's mech only ever
improves; nothing recorded that the same build was wearing out underneath.

### Measuring diversity, not just distance

Divergence was a single scalar. `buildDiversity` now reports what the success
criteria actually ask for, keyed on the shape a player would describe out loud —
primary weapon family, engagement band, plating, thermal state:

```bash
npm run game:loop-report -- artifacts/loop.json   # buildDiversity block
```

Measured on the settled cohort: **10 distinct archetypes**, CH-5 reaching 5
directions and CH-9 reaching 6, and the most common archetype at 29% of final
builds — there is no dominant build. One target part (`U-TUR`) is never fielded.

**Refits could only ever append**, which meant a run's archetype was decided
before its first fight: a build could gain plating and cooling but never change
what it shot with, so the primary weapon family the starting template happened
to carry was the one it died with. `candidateSwapBuild` lets the policy trade
its weakest gun for a better one from the bench, which is what the domain always
allowed and the policy never proposed.

### The Vulture reaches two directions, and that is structural

CH-2 fits only 1-2 cell weapons in its 16 cells, and of those only the MG and
the carbine are competitive: a laser Vulture cannot carry its own power and
cooling (-5.6 kW, 0.000 win rate) and rockets measure 0.22 against the MG
scout's 0.50. Making its sniper *thermally* distinct instead was tried and is
not possible either — with a second carbine aboard there is no legal cell left
for a radiator, and a third heat sink only reaches -3.7 kW. Its three probes are
viable and clustered (0.510 / 0.552 / 0.594) and start as three different range
ideas; two of them converge under refit. Giving the frame a real third direction
needs a new small weapon or more capacity, which is a content decision.

`templates.test.ts` caught the radiator attempt as out-of-mask. `withExtraParts`
auto-wires but does not validate, so authored probe additions are only as legal
as that suite makes them.

## Eighth pass: heat, and a dead unlock branch

`game:loop-report` gained `challengesEarned`, because the 15-part target pool is
only what the one-hour fixture asks for — the challenge list gates nine more
parts behind conditions, and a condition the sim never produces is an unlock
branch that does not exist.

It found one. **`redline` — "win after reaching 115 C" — was never completed in
48 cases**, so `R-C90` and `W-SC` were unreachable parts. Measuring peak
temperature explained why: across 240 battles no template ever passed 65 C.

The thermal band is specified up to fire-hold at 115 C, shutdown at 130 and heat
damage at 150, and none of it was reachable. Heat was not a tradeoff, it was a
number on a readout — which is why nine of ten measured archetypes ran hot and
nothing ever paid for cooling.

Per-cell thermal mass moved from 1.0 to 0.7. Peaks now spread 40-79 C rather
than 37-65, and the spread *discriminates*: builds at -9 to -10 kW reach 115 C
sometimes while builds at -1.6 to -3.1 kW never do. Template balance is
unmoved (round robin 27-68%, same ordering).

**0.5 discriminated much harder and was rejected.** It took the hot builds to
115 C in a quarter of their fights — but it killed the `gyrostabilized` perk
outright in the diversity stress, from +3 points to -14. A perk that is never
worth taking is a diversity loss traded for a diversity gain, and `sim:diversity`
is right to fail on it. 0.3 was worse still: nearly everything redlined, which
is as inert as nothing redlining.

Honest limit: the band is now reachable in principle, but the cohort's own
builds still rarely redline, so `redline` remains unearned in a 3-seed run. The
dial opened the door; the builds have not walked through it.

## Ninth pass: why `U-TUR` is never fielded, and where armour concentration lives

Two diversity gaps were chased. Both ended in a diagnosis rather than a win, so
the diagnoses are the deliverable.

**The spatial system is not the problem.** 31% of measured builds carry a
protected payload, `U-SHELL` appears in 72 of them, and all three location
effects (articulated shoulder, long-sight hardpoint, heat-spreader casemate) are
in active use. Stacking works.

**`U-TUR` is unused because its benefit was invisible, and then because it never
reaches the bench.** The turret's entire value is `weaponArcBonusDeg: 25`,
granted only to a weapon stacked on it — and no field of the build fingerprint
recorded firing arc, so `policyScore` could not value it at all. `meanWeaponArcDeg`
is now on the fingerprint, DPS-weighted from the sim's own
`effectiveWeaponArcDeg`, and the range and survival policies price it.

That was necessary and not sufficient. The turret still never gets fielded,
because selection happens earlier: salvage keeps parts within 60% of the best
pick's `partScore`, and a turret scores 35 against a weapon's 200-plus, so it is
scrapped before placement is ever considered. The arc field stays — a part whose
benefit no measurement can see is a part the loop cannot test — but the
selection heuristic is where the remaining fix belongs.

**Armour concentration lives in `partScore`, not `policyScore`.** `U-ARM` is 46%
of every part fielded, 5.0 copies per final build. Making `policyScore`'s armour
term concave (sqrt rather than linear) was tried and changed nothing at all —
5.04 copies per build against 5.02, identical concentration, identical
archetypes. The reason is that `partScore` is what ranks salvage and scrapyard
offers, it is stateless per part, and it hands `U-ARM` a flat 50 however many
plates the mech already carries. `policyScore` is never consulted at the moment
a plate is chosen. The change was reverted rather than left as dead complexity.

A stateful part score — one that sees the build it is being added to — is the
change that would move this, and it is a larger rework of the policy than this
pass had room for.

## Tenth pass: a build-aware part score

`partScore` ranks salvage and scrapyard offers, and it was stateless — `U-ARM`
scored a flat 50 however many plates the mech already carried, so armour won
every reward decision forever and the rest of the catalogue could not compete
for a slot. It now takes an `owned` count and applies a marginal multiplier of
`1/(1 + owned x 0.5)`: the fifth plate is worth about a third of the first,
which is the judgement a player makes without thinking about it. Salvage,
scrapyard, and the refit shortlist all pass what the run already holds.

Measured effect:

| | before | after |
| --- | --- | --- |
| parts never fielded | `U-TUR` | none |
| armour share of all parts fielded | 46.0% | 43.8% |
| dominant archetype share | 0.292 | 0.271 |
| distinct archetypes | 9 | 10 |
| CH-5 build directions | 5 | 6 |

`U-TUR` is fielded for the first time in any cohort. Every part in the target
pool is now used by some build.

**The remaining armour concentration is authored, not earned.** The starting
templates are 42.4% armour before a single decision is made — a plate is the
cheapest legal way to fill a grid cell, and every probe leans on it, three of
them above 55%. Final builds measure 43.8%. The reward loop is therefore adding
almost nothing to the concentration; it is faithfully preserving the ratio the
content ships with. Moving this number is a template-authoring pass, not a
policy one, and `partUsageConcentration` should be read as a statement about
the catalogue rather than about the loop.

## Eleventh pass: the difficulty arc and diversity pull against each other

The 0.8 win-rate warning was worth checking before acting on, and checking it
found something the aggregate had hidden: **the ladder had stopped getting
harder at all.** Per node, fresh measured 1.00 / 0.73 / 1.00 / 0.80 / 0.75 /
1.00 across nodes 1-6 and one-hour was still winning node 10 outright. A flat
ladder gives a run no arc — nothing the build was developed *for* ever arrives,
which is the fifth and sixth steps of the intended loop.

Both earlier ramp settings had been chosen while chassis repair was silently
missing, so the ladder had been held back to compensate for a player who could
not sustain. With the frame repairable, that compensation had become slack.

Three ramp values were measured end to end:

| per node | difficulty curve | archetypes | dominant share | CH-5 directions | fresh divergence |
| --- | --- | --- | --- | --- | --- |
| 1.0 | flat (still winning node 10) | 10 | 0.271 | 6 | 0.173 |
| 1.4 | declining | 7 | **0.500** | 2 | 0.134 |
| 1.8 | cleanly declining | 9 | 0.354 | 5 | **0.204** |

**They trade against each other directly.** A steeper ladder produces the
difficulty arc the loop wants and gives fresh builds the widest spread measured
(0.204 at 1.8), but it shortens runs — one-hour fell from 3.95 battles to 2.91 —
and a build that dies sooner has less time to become anything, so the cohort
collapses back toward the one archetype that works from the start. At 1.4 half
of all final builds were the same close-range MG brawler.

Held at 1.0, because diversity is the stated priority and 1.0 measured best on
archetype count, dominance, per-chassis directions and one-hour divergence. This
is a genuine design decision rather than a tuning one: 1.8 is the better
*roguelike arc* and 1.0 is the better *build sandbox*, and which matters more is
a call about what the game is for.

The flat curve is now a known, measured, deliberate state rather than an
unexamined one.

## Twelfth pass: the purchasing step, and paying for the steeper ladder

The eleventh pass left a tension: a steeper ladder gives the run an arc but
shortens it, and shorter runs mean less differentiated builds. The obvious
answer is to raise the player's *growth rate* so a steeper ladder is
survivable. That was tried, and it is worth recording that it did not work.

**The purchasing step was mostly absent.** Only 41% of runs ever reached a
scrapyard, and 58% of the visits that did happen were skipped — the repair
reserve added in the sixth pass held back the *full* restoration cost, which is
usually everything. So loop step 3 existed and could rarely be acted on, and
buying is the only way to get a part the opponents in front of you do not drop,
which makes it the diversity valve as well as the economy one.

Two changes: a third scrapyard (`scrapyardCount` 2 -> 3), and a reserve that
only holds back what actually needs fixing — the frame, plus parts under 60%
integrity. Light wear rides.

Measured: purchases rose from 18 to 32, CH-9 went from six build directions to
**seven** across four weapon families, one-hour runs recovered to 3.89 battles,
and fresh divergence rose to 0.186.

**Then the steeper ladder was retried on top, and still cost diversity.**

| | ramp 1.0 | ramp 1.8 |
| --- | --- | --- |
| win-rate warnings | both fire | **both clear** (0.79 / 0.73) |
| difficulty curve | flat | **declining** |
| distinct archetypes | **9** | 8 |
| dominant share | **0.292** | 0.333 |
| CH-9 directions | **7** | 6 |
| one-hour mean run | **3.89** | 2.72 |
| fresh divergence | 0.186 | **0.198** |

A wider economy does not buy back what a shorter run costs. Held at 1.0 on the
stated priority, with the economy changes kept — they are a clear gain at either
ramp. The decision remains open and is now measured from both sides: 1.8 is the
better roguelike arc and passes the win-rate guard; 1.0 is the better build
sandbox and passes the run-length guard. Neither passes both.

## Thirteenth pass: what actually predicts survival

Every pass so far has assumed that a better-built mech goes deeper. That was
never measured, so it was measured: for each run, the build entering its second
battle, split by whether the run died by battle two or reached four.

**The things a player would call "building" do not separate them at all.**

| entering battle 2 | died by battle 2 | reached battle 4+ |
| --- | --- | --- |
| burst DPS | 31.0 | 28.0 (-10%) |
| armour plates | 5.23 | 4.25 (**-19%**) |
| part count | 10.0 | 9.8 |
| range band | 110 m | 121 m |
| weapon arc | 85.6 | 81.1 |
| **power margin** | 6.2 kW | **12.0 kW (+94%)** |
| **chassis integrity** | 0.80 | **1.00 (+25%)** |
| part integrity | 0.88 | 0.95 (+8%) |

Depth is predicted by *headroom and upkeep*, not by firepower or plating — and
long runs carried nearly a fifth **less** armour, because plates add mass and
occupy grid without keeping a mech alive. The policies were buying almost
exactly the wrong things, which is also why armour flooded every build and the
catalogue could not compete for a slot.

`policyScore` and `partScore` were reweighted to match: armour roughly halved
(30 -> 18 for the armour policy, 16 -> 8 for survival, and 50 -> 30 per part),
power margin paid directly, and reactor output priced into the per-part score.

This was the single largest diversity gain of the whole effort:

| | before | after |
| --- | --- | --- |
| distinct archetypes | 9 | **12** |
| CH-5 build directions | 4 | **7** |
| CH-5 weapon families | 2 | 3 |
| parts never fielded | `U-PIPE` | **none** |
| fresh mean run | 3.69 | 4.00 |
| one-hour divergence | 0.372 | 0.381 |

The lesson generalises past this codebase: the deterministic policies are the
player model, and a policy that optimises the wrong quantity produces telemetry
that describes a game nobody would actually play. Checking a policy against
outcomes is as important as checking the content against the policy.

## Playing the state this is all aimed at

Everything above measures the profile a player reaches after an hour. Until now
that state was only reachable by grinding to it, so nobody could actually play
the thing being tuned. In development:

```
http://localhost:5160/?unlock=one-hour
```

seeds the profile directly — all three chassis, the fifteen-part target pool,
and the nine branch-probe mechs saved in the garage and ready to load. It is
dev-only and overwrites the stored profile, the same rule the dev-only `?view=`
surfaces follow, for the same reason.

## Fourteenth pass: the enemy that ran away

Playing it immediately found something no cohort measurement had: an opponent
that never attacked and simply retreated for the whole match. Reproduced at
**11 of 40 battles with the enemy fleeing for more than 40% of their frames.**

The autopilot picks a standing range by maximising `U(r) = my dps - theirs`. For
a mech that is outgunned at every range, that maximum is wherever *both* sets of
guns fall silent — so its plan becomes "be as far away as possible", and it runs.
Rational against the objective it was given, and unplayable.

Fleeing now also requires being faster than the pursuer. If you cannot outrun
the thing chasing you, the only thing running buys is being shot in the back.
That halves it, to 5 of 40, and the cases that remain are a faster, longer-ranged
mech backing off while still shooting — which is real kiting, not the bug.

**A second fix was tried and reverted.** Clamping the range scan to the mech's
own weapon reach cut running further, to 3 of 40 — but it killed the
`cold-bore`, `fever-cycle` and `hull-down` perks outright in the diversity
stress, because standing off beyond reach is precisely what those perks are for.
`sim:diversity` is right to fail on that, and a quarter of the perk catalogue is
too much to pay for the last five percent.

The lesson is the plainest one of the whole effort: fourteen passes of cohort
telemetry did not surface a bug that one human playing one match found
immediately. The instruments measure what they were pointed at.

## Fifteenth pass: driving the loop by hand

Following the flee bug, the whole post-battle loop was driven through the real
UI at 390 px with `?unlock=one-hour`, rather than measured. All of it is live:

- **Salvage.** Names the wreck, pays a purse, and lists what can be taken with
  integrity and scrap value. Salvaged parts carry their modifiers and explain
  them in place — `MISWIRED` ("ignores brownout priority — always sheds first")
  next to `SURGE GATE` ("first claim on power — fires from capacitors even while
  browned out"). Challenge unlocks fire on the same screen. The choice is
  genuinely three-way: take parts, take the scrap, or pay for whole-wreck
  recovery and switch frames.
- **Repair.** "Repair bay · 4 damaged parts · repair all −72" in the run panel,
  per-part partial and full repair in the inspector, and the chassis as a
  separate `BODY 55%` control in the workshop bar.
- **The machinist milestone.** Every third victory: pick a target from your
  owned equipment and one of three modifiers at 25 scrap each, each described in
  full ("thermal mass x2 — heats and cools slowly").

Opponent cards read correctly too, and show the work of earlier passes: a
`BASTION PICKET` rates two triangles off almost no equipment because the threat
score sees its 700 points of structure, and the blurb says why — "an assault
hull with almost nothing bolted to it. Still an assault hull." Spawn distance is
on the card, so the range decision the policies make is one a player can make.

One piece of drift fixed: `PartInspector` documented repair as "0.4 scrap x tier
per integrity point" after the dial moved to 0.3. The code read the dial; only
the comment lied.

## Sixteenth pass: the Vulture's third direction, finally diagnosed

Eight passes have failed to give CH-2 a third build direction. This one found
why, by testing the two remaining ideas and then measuring the thing that was
actually wrong.

**A ram-air cooling zone on the body** — the one lever left untried, and the one
the brief explicitly names. The Vulture's body had no location zone while both
its hardpoints did, and the sniper's own notes already describe the frame as ram
-air cooled. Implemented as `heatMultiplier: 0.7` and measured against the same
build with the carbine on a hardpoint instead: **0.4 kW on a 6 kW deficit.**
Correct, and inert — the spine holds one small weapon, and 30% of a carbine's
1.3 kW is nothing. Reverted.

**A spine-layout probe.** Carbine down the middle, MG on a long-sight hardpoint
for its 10% reach, armour off. It measures **0.597** against the ladder, better
than all three current Vulture probes (0.556 / 0.486 / 0.542), and bins as
`long/light` — genuinely distinct from the sniper and the brawler. Swapped in
for the weakest probe, and the cohort still reported **two** directions. The
within-chassis spread rose (0.151 to 0.171), so the *starts* were more
different; the endpoints were not. Reverted too, since it cost the cold-bore
sniper's 255 m identity and did not fix what it was aimed at.

**The actual diagnosis.** CH-2 has three viable, measurably distinct *starting*
fits. What it does not have is three distinct *endpoints*, because the four
refit policies only pull in two directions on this frame: `survival` and `armor`
both converge on the close brawler, `range` and `thermal` both converge on the
carbine sniper. On a 32- or 56-cell chassis that still leaves room for the
starts to stay apart; on 16 cells with two competitive weapons it does not.

So the criterion is met at the build level and not at the endpoint level, and
the fix is not more content — it is either more policies pulling in more
directions, or a frame that can carry a third weapon family. Both are larger
decisions than a tuning pass.

## Seventeenth pass: the policy that was missing

The sixteenth pass concluded that CH-2's two endpoints were a property of the
refit policies rather than of the chassis, and that the fix was "more policies
pulling in more directions". That turned out to be right, and justified on its
own terms rather than as a way to move the number.

The four policies between them price armour, reach, cooling and raw
survivability. **None of them prices mobility.** Evasion became a live mechanic
in the third pass, when the autopilot learned to cross a sightline — and no
player model in the cohort had ever leaned on it. A pilot who flies light and
fast, takes the wide firing arc and picks their engagement distance is an
obvious archetype with no representative here.

`skirmish` pays for forward speed, arc, power headroom and damage, and charges
for load factor and plate count — the one policy that refuses to carry weight it
does not need. Its per-part score reads mass directly.

The direction it found was there all along:

| | before | after |
| --- | --- | --- |
| distinct archetypes | 13 | **16** |
| CH-2 build directions | 2 | **3** |
| CH-5 build directions | 8 | **10** |
| most common archetype | 0.313 | **0.300** |
| warnings | 4 | **3** |

CH-2 now reaches `W-CB/sniper/medium/hot`, `W-MG/close/heavy/hot` and
`W-MG/long/light/hot`. **Every chassis meets the three-directions criterion.**

Worth being precise about what this was: not new content, and not a change to
the game at all. Six content ideas were measured against this warning and none
of them addressed it, because the gap was never in the chassis — it was that
nothing in the harness wanted to fly a fast, light mech, so nobody ever found
out that one worked.

## Eighteenth pass: the trial fight nobody could tell was a trial

Reported from play: "I don't see a scrap screen or any way to proceed, I just
get rematch or back to workshop." Reproduced immediately.

Loading a saved mech puts the run in **prep**, not active. The workshop's action
bar then shows `NEXT <opponent>` and will happily take you into that fight — but
`onFight` sets `runFightRef.current = run.phase === 'active'`, so a fight during
prep is deliberately free play. You win, and the run stays at `phase: prep`,
`pendingSalvage: false`, `fightsWon: 0`. No purse, no salvage, no node.

The rule is right — prep is for outfitting and trying the mech before you commit
— and the code comment beside it already describes this exact failure from an
earlier occurrence. What was missing is that **nothing on screen said so**. The
strip read "Next", which is a promise.

It now reads `TRIAL · run not launched` while the run is in prep, and returns to
`NEXT` once launched. Verified both states in the browser.

Worth noting what this says about the instrumentation: `web:campaign` drives
`Launch the run` explicitly, so the smoke test has always taken the correct path
and could never have found this. A test that knows the right sequence cannot
discover that the wrong sequence is inviting.

## Nineteenth pass: one over-plated fit

Long runs carry 19% less armour than short ones (thirteenth pass), and the
starting templates lead with 42.4% plating. Three non-armour fits were carrying
43-44%: both Vulture range fits and the Bastion casemate.

Trimming was measured on all three and only one benefited. `probe-vulture-cold`
was the weakest probe in the set (0.486) and the only one running a *negative*
power margin — a sniper that could not feed its own guns while hauling plating a
255 m fit never gets shot through. At two plates instead of four it measures
**0.625 and +0.9 kW**: from the weakest Vulture fit to the strongest.

The same trim made `probe-vulture-range` worse (0.594 to 0.563) and
`probe-bastion-casemate` worse (0.854 to 0.844), so their plating stays. This is
not a rule about armour; it was one fit carrying the wrong thing.

## Twentieth pass: finding the salvage screen

Reported from play: "how do I see the salvage screen and the scrap spending
screen". Both existed and both were reachable; neither was findable.

**Salvage.** Winning a run fight left the report offering `Rematch`,
`Rematch · same seed` and `Back to workshop`. The wreck is behind that third
button — the run settles when the report closes — but nothing said so, and
"back to workshop" is not a phrase that means "collect your reward". It now
reads **`Claim salvage ›`** and is styled as the primary action whenever the
fight was a run fight that was won. A sandbox fight still says "Back to
workshop", because there is nothing to claim.

`campaign-smoke` taps that button by name, so it had to be updated with it —
which is the useful kind of coupling: the flow test names the thing a player
looks for.

**Scrap spending** lives in two places, both under the readout bar's `RUN` tab:
the repair bay (`repair all -N`, plus per-part repair in the inspector and the
chassis as `BODY nn%` in the workshop bar), and the machinist milestone every
third victory. Scrapyard stock appears in the same tab when the run reaches one
of the three scrapyard nodes.

A false alarm worth recording: checking `pendingSalvage` *at* the report screen
reads `false`, because settlement happens on close. An earlier drive here also
mistyped the button in caps, missed the tap, and read the pre-settlement state —
which looked exactly like salvage being broken. Both are the same trap as
docs/15 §8: read the state after the transition you are asserting, not during
it.

## Twenty-first pass: the discoverability pattern

Three reports in a row were the same shape — a feature that existed, worked, and
could not be found: the prep/trial distinction, the salvage screen behind "Back
to workshop", and where scrap is spent. That is a pattern, not three bugs, so
this pass went looking for the next one instead of waiting for it.

The readout's tab strip already badges `Faults (2)`. The `run` tab, which holds
the repair bay, the machinist milestone and a scrapyard's stock, said only
`run` — and both the milestone and the scrapyard are **offers that pass if you
walk by them**, one tap inside a sheet a player has no particular reason to
open.

It now reads `run ●` when a decision is actually waiting there: a machinist
milestone that has not been spent, or a scrapyard node. Verified in the browser
across all three states — plain `RUN` on an ordinary fight node, `RUN ●` at a
scrapyard, `RUN ●` with a milestone pending.

The general rule this pass leaves behind: a system that is reachable is not the
same as a system that is *found*, and the cohort telemetry cannot tell the
difference — it calls the function directly. Every one of these was invisible to
`game:loop` and visible within a minute of somebody playing.

## Twenty-second pass: running away, and the cockpit

### Turning tail is gone

Running away came up three times from play, so this pass followed the reasoning
rather than the metric. `flee` sets facing *away* from the target, so a mech
that chose it could not bring a gun to bear for the rest of the match. That is
never the right play in a run that ends when you lose — a mech with a reach
advantage wants to back off *while shooting*, which is exactly what `retreat`
already does: reverse speed, facing held, guns bearing.

The out-ranged branch was deleted outright. The only remaining case was a mech
with no functional guns, which used to sprint away during the three seconds
before its own mission-kill surrender — buying nothing and reading as fleeing a
fight it had merely lost. It stands still now. (Ramming instead would be a real
feature; the sim has no melee.)

Measured across 60 battles: **0 with the enemy fleeing**, against 11 of 40 when
this started, no timeouts and unchanged fight length.

Three tests asserted the removed behaviour and were re-based rather than
deleted: the turn-tail test now pins the rule that replaced it (gives ground,
never turns tail); the manual-waypoint test lost its "flee point" premise; and
the ion-cannon test now reads the *lowest* capacitor charge of the battle rather
than the last, because a target that stands still has power spare to recharge
between hits and the end state can no longer see the drain.

A disarmed mech also now reports `face: bearing` at its current heading rather
than `mode: 'target'`. Claiming to track with nothing to aim was a lie with a
cost: the manual merge only re-aims at a player's waypoint when the autopilot
was travel-facing, so a disarmed mech under manual control stared at the enemy
instead of where it was being driven.

### Steering by hand takes the whole wheel

`autoHolds` was `throttle === 'auto' && face === 'auto'` — it never looked at
`move`. So setting a waypoint gave you a manual move while throttle and facing
stayed auto-held and **disabled**: you had taken over where the mech went and
could not touch the speed or facing that going there needs. Reported from play
as "states where I can't move but auto can".

Setting a waypoint or Hold now releases auto, seeding throttle and facing with
whatever the autopilot was doing so the mech carries on unchanged until you
alter something. Under auto both controls stay disabled and mirror the
autopilot live, which was already right.

`Hold`'s tooltip said "Stand fast in place", which does not say what it costs.
It now reads "Stop moving and stand still — guns keep firing, the autopilot
stops repositioning".

### The on-arrival feature is gone

"Waypoint set — On arrival" was a standing order to hand the mech back to the
autopilot on reaching the waypoint. Nobody could tell that from the button, and
a control that silently returns the mech mid-fight is a surprise rather than a
convenience. The toggle, the `autoOnArrival` state, the `onArrival` parameter on
`withManualOrders` and its test are all removed; control changes hands only when
the player says so. The test now asserts the thing that still matters — a manual
waypoint is actually driven to.

## Twenty-third pass: why you never see a miss

Reported from play: misses are rare, and the arena seems to draw ideal-range
rings but no spread cone up close.

**The cone is drawn.** `ShotSpread` in `BattleHud` puts +/-1 and +/-2 sigma bars
across the line of sight at the target, computed from the sim's own
`computeHitModel` with the gun's modifiers, forest cover, targeting-computer lag,
your own speed and the target's crossing all folded in. The reason it does not
read as a cone is that there is nothing to see: close in, against something not
crossing, sigma is around 0.2 m against a 1.5 m silhouette. The bar is smaller
than the mech it is drawn on. The drawing is honest; the spread really is that
tight.

**Measured: 91.8% of all shots hit, across 89,304 of them.** That is above the
band docs/03 §9 uses for its own worked examples — "AC 74% -> 94% with a TC" —
and it means the things a build can spend on accuracy buy almost nothing. A
targeting computer counters lead error that barely exists; cover narrows a
target that was going to be hit anyway; forcing a crossing angle is worth little.

`WEAPON_DISPERSION_SCALE` was added as a single dial and calibrated:

| scale | hit rate | what breaks |
| --- | --- | --- |
| 1 (held) | 91.8% | nothing; accuracy is not a live axis |
| 1.5 | 83.8% | laser boat 80% (R4 flag), skirmisher 35% -> 20% |
| 2 | 75.8% | laser boat 83%, `cold-bore` becomes a dominant perk |
| 3 | 64.0% | not explored |

**Held at 1, and the reason is the interesting part.** Dispersion is a
per-weapon stat, so scaling it globally redistributes power across the whole
catalogue in proportion to how tight each cone already was. The twin-MG
skirmisher has the worst cone in the game at 8.0 mrad and collapses; the laser
boat has the tightest short of the tier-4 railgun at 1.5 *and* is hitscan, so it
never pays time-of-flight either — two accuracy advantages stacked on a tier-2
mount. Repricing the laser's cone to 2.6 mrad only took it from 80% to 77%.

Making accuracy scarce makes accuracy-buying things dominant. That is the
mechanic working as designed, and precisely why this is a deliberate
catalogue-wide rebalance rather than a dial turn — every weapon's dispersion
wants re-pricing against the new scarcity, and the perk stress has to be re-run
against each step. The dial and its calibration are in the code so that pass can
start from measurements rather than from scratch.

## Twenty-fourth pass: four things from play

**The waypoint that would not move (my own regression).** Setting a waypoint
seeds throttle from whatever the autopilot was doing, so the mech carries on
unchanged — but if the autopilot happened to be *stationary*, you inherited that
and the click appeared to do nothing. Clicking a waypoint is a request to go
somewhere; it now never inherits a stop.

**`Hold` removed.** Nobody could tell what it was for, and a control whose only
effect is to stop the mech is a trap next to a waypoint that also stops it. The
manual move state is now just auto-or-waypoint, and the `h` hotkey is gone with
it.

**Whole-wreck recovery removed.** The "switch to the enemy's frame" offer on the
salvage screen is gone end to end: the UI section, `recoverWreck`,
`previewWreckRecovery`, `chassisRecoveryCost`, the two economy dials, their
audit rule, the balance harness's `--recover-larger` policy, and four tests. It
was opt-in in the harness and defaulted off, so no default measurement moves.
Restorable from history if it earns a motivation later.

**Cone drawing was wrong in three ways.** For one gun, `WeaponCones` drew two
filled pies *both starting at the mech* — `sector(rangeEnd)` and then
`sector(rangeStart)` on top of it — so the overlap read as a second, darker
cone, and a weapon with a `rangeMin` added a third ring. The bands are now
tiled ring segments (`rangeStart..reach`, `rangeMin..rangeStart`) so each is
drawn exactly once and the wedge reads as one shape with graded fill.

The outer edge was wrong too. The sim fires out to `rangeEnd x 1.3` — past
`rangeEnd` a shot is merely weaker, not impossible — so shots visibly flew
outside their own marking. `WEAPON_REACH_MULT` is exported from the sim and the
cone is drawn at the real cutoff, rather than the HUD keeping its own idea of
where a gun stops.

## Opponent doctrines: the lever that was not budget

Two warnings had outlived every previous pass — the win rate sat above its 0.8
ceiling, and a fresh profile could never reach CH-9. Both are now measured fixed,
and neither was fixed with budget.

### What was wrong

The ladder drew fill parts uniformly from *every* enabled part, onto a frame
picked at random from every frame that fit. That builds incoherent mechs — a
sniper frame stuffed with flamers and a spare reactor — and an incoherent mech is
a weak mech whatever it cost. The loop sat at 87% wins against opponents that
were nominally on budget.

Raising the budget was the obvious answer and it was measured and rejected (see
the ramp section): it shortens runs, and a build that does not survive cannot
develop.

### Doctrines

Each opponent card now fields a **doctrine** — a frame family plus a fill pool
that agrees with it. Coherence costs no tiers.

| Doctrine | Frames | Fill | The axis it attacks |
| --- | --- | --- | --- |
| `LINE` | mule-gunline, mule-runt, bastion-picket, bastion-tank | AC/MG, armour ×2, radiator | trades at mid range and will not move |
| `LANCER` | vulture-sniper, railgun-mule, mule-gunline | carbine ×2, U-TC1, radiator, armour | reach, and a targeting computer that buys down the lateral penalty |
| `SWARM` | vulture-skirmisher, vulture-scrapper, mule-skirmisher, mule-runt | MG ×2, actuator, armour | crossing speed — a crosser is hit ~30% of the time |
| `FURNACE` | mule-laser-boat, mule-gunline, bastion-tank | laser, flamer, radiator, heat sink, armour | never leads a target, and pours heat into one with no cooling |

The doctrine shows on the intel card (`chassisLabel`), because a recognisable
threat is one you can prepare against. That is the diversity argument as much as
the difficulty one: "what beat me last time" now has four different answers.

The sim only gained an optional `templateIds` filter. The doctrine table is game
content, where it belongs.

Doctrines also made an instrument wrong, which is worth recording because it is
the failure mode this codebase keeps hitting. The content audit answered "which
parts can an enemy field?" with `enemyFillPartIds` — every enabled part. That was
true while fill was drawn uniformly from the catalog and became a lie the moment
doctrines defined real pools, and it feeds the `enemy-salvage` acquisition route,
so it was claiming the player could salvage parts no opponent carries. It is now
`ENEMY_FIELDABLE_PART_IDS`, derived from the doctrine table itself, and the
content field is gone rather than left to drift again.

### Two spreads, both needed, both found by measuring

**Doctrines are drawn without replacement per node.** Rolling each card
independently let all three come up the same, which stops the node being a choice
between different kinds of fight.

**Chassis are drawn without replacement per node too**, and intersected with the
doctrine's frames. This is the one that fixed CH-9. Chassis exposure had been
left to emerge from budget arithmetic, and it does not: the generator falls back
to the cheapest frame that fits, the cheapest frames are Mules, and a fresh
profile measured **35 Mules and zero Bastions across 40 fights**. CH-9 could
never unlock however the run went. Naming the chassis target directly is the fix;
the doctrine still decides what kind of fight it is.

Before → after, fresh profile:

| | before | after |
| --- | --- | --- |
| Bastion fights | 0 | 9 |
| Vulture fights | 5 | 6 |
| Mule fights | 35 | 25 |

All three chassis are now met *and beaten* in both profiles, and every chassis
unlock warning is gone — the first time in this document's history.

### The five configurations that were measured

Recorded because four of them are worse and should not be retried.

| config | fresh WR | 1h WR | archetypes | dominant | mean run f/1h |
| --- | --- | --- | --- | --- | --- |
| no doctrines (baseline) | .875 | .867 | 10 | 25% | 6.67 / 4.29 |
| doctrines, independent draw | .775 | .750 | 9 | 40% | 3.33 / 2.73 |
| independent, ramp 0.7 | .775 | .775 | 10 | 40% | 3.33 / 3.16 |
| spread doctrines, ramp 0.7 | .925 | .825 | 8 | 30% | 5.00 / 3.87 |
| **spread + chassis spread, ramp 1.0** | **.875** | **.783** | **10** | **35%** | **4.44 / 3.16** |

Two things worth keeping from that table:

- **Independent draws beat the ceiling on both profiles but cost run length and
  concentrated builds.** Spreading restores variety and run length, but a node
  that always offers all four doctrines always offers a soft one, and a greedy
  chooser takes it. That is why fresh sits back at .875: it is not that opponents
  are weak, it is that the player can always pick the weakest of three.
- **Raising `ladderBudgetBase` 3 → 5 made fresh *easier*, not harder** (.875 →
  .975). A bigger budget walks the frame window onto heavier frames, and a heavy
  frame on a small budget is an unfinished hull. Reverted; base stays 3.

## Three attempts at the last warning, all reverted

The fresh cohort's 0.875 win rate has one known cause: a node offers two or three
doctrines, the chooser takes the softest every time, and that costs nothing.
Three fixes for that were built and measured, and all three were reverted because
each bought the warning by breaking a *success criterion*.

**Threat-scaled purse** (`threatPurseMultipliers: [0.75, 1, 1.35]`). Good design
on its face — taking the easy card should develop your build slower. It cannot
work on its own, because the harness policies choose by threat and range fit and
never look at reward, so the money changed and the choice did not.

**Per-policy reward appetite.** Gave each policy a price in purse it would pay
for a step of difficulty (survival 0, skirmish highest), so the cohort contained
both a cautious player and a greedy one. It works: one-hour went .783 → .742. It
also loses runs, and a run that ends cannot develop a build — CH-9 fell from
three viable directions to two, and "a build cannot develop" returned. Halving
the appetites changed nothing, which is how the next item was found.

**Depth-relative threat.** The real discovery of this pass, and the one worth
returning to. Threat thresholds are absolute (200/275) and tuned around
mid-ladder budgets, so **every card at nodes 0-4 rates threat 1** — three cards,
three identical numbers. The rating is uninformative exactly where a new player
lives, and it is why the threat-scaled purse moved the one-hour cohort and did
not touch the fresh one at all: there was no threat variety early for it to grip.

Scaling the thresholds by `nodeBudget(nodeIndex)` fixed that and took fresh from
.875 to .825. It also put harder-rated fights in front of shallow runs: mean run
length fell 4.44 → 3.33 and CH-9 dropped to two directions again. Reverted, but
this is a genuine defect in the card, not just a tuning knob — it should be
revisited together with whatever lengthens early runs, not before.

The pattern across all three is the same, and it is the honest summary of where
this loop is: **the win-rate ceiling and run length are in direct tension.**
Anything that makes fights harder shortens runs, and short runs cannot develop
builds, which is the thing the whole document is for. The success criteria weigh
diversity above win rate, so the shipped configuration keeps the criteria and
carries the warning.

## Feedback from play, and where each piece landed

Kept as a standing list because a note in a conversation is not a record. Every
item here came from actually playing the game rather than from a harness.

| What was reported | State | Where it went |
| --- | --- | --- |
| Enemy never attacks, just runs away | done | Flee branch deleted; out-ranged mechs retreat, disarmed ones stop. 0/60 battles flee. |
| No salvage screen; only Rematch / Back to workshop | done | A won run fight now reads `Claim salvage ›` as the primary action. |
| Can't tell how to start a run | done | Action bar shows `TRIAL · run not launched` and a `Launch run` button during prep. |
| Removed parts should go to inventory | done | Backing out of a detached part stows it to the bench mid-run; the button says `Stow`, and only says `Discard` when the bench is full. |
| Whole-wreck recovery has no motivation | done | Removed end to end (UI, domain, harness policy, economy dials, tests). |
| `Hold` does nothing legible | done | Removed, with its `h` hotkey. |
| Waypoint sometimes can't move the mech | done | Was mine: a waypoint inherited a `stationary` throttle. It never inherits a stop now. |
| "On arrival" tooltip is stale | done | `onArrival` removed from `withManualOrders` and the cockpit. |
| Auto mode should own facing and speed, and hand back in place | done | Turning auto off leaves the mech in the state the autopilot left it. |
| Cone draws from 0 and again from 1, doubled and darker | done | Was two stacked pies. Bands tile now, and the outer edge is the real firing cutoff (`rangeEnd × WEAPON_REACH_MULT`), not `rangeEnd`. |
| Guns have no minimum range; ideal range should be strategic | done | Autocannon, carbine, laser and ion all have dead zones. The MG, siege gun and flamer keep none — they *are* the knife fight. |
| Draw the falloff, not just the band | done | The cone is a user-space radial gradient sampled from `falloffAt()`, so it fades exactly as damage does. |
| Every bullet hits | done | 91.8% → 77.0%, and evasion is now worth **53 points** of hit rate. See §"What accuracy actually is now". |
| Bullets arrive in one frame | done | Ballistic speeds halved; time of flight is also a term in the hit model, so this bought accuracy realism as well as visible travel. |
| Lasers should be drawn as lasers | done | Hitscan renders as a beam that is on then off, not a walked round. |
| Shots should leave the actual weapon, not the mech's centre | done | `BattleView.mechs[].mounts` carries each part's footprint centre; rounds leave the gun. |
| Hits should be decided by rules, not collisions | already true | The sim scores `pHit` and the drawing follows that verdict. Nothing collides; a miss is *drawn* going wide because it was already decided to be a miss. |
| Movement penalty and lateral-target penalty should be separate | done | They are two constants with two counters. See below. |

### The two accuracy penalties, and their counters

They used to be one dial. The targeting computer "reduced fire-control lag",
which is also the term projectile time of flight rides on — so a TC quietly made
slow shells reach further, and there was no way to tune leading a runner without
also tuning how far a gun could shoot.

| Penalty | Driven by | Constant | Bought down by |
| --- | --- | --- | --- |
| shooter's own movement | your speed | `MOVE_JITTER_MRAD_PER_MPS` (0.75) | the chassis (`moveJitterMult`; a Vulture is 0.35) |
| lateral target | the target's crossing speed | `LATERAL_PENALTY_MULT` (1 → 0.4) | a powered U-TC1 targeting computer |

Fire-control lag (`TRACKING_LAG_S`, 0.5 s) is now a single physical latency that
nothing buys down. Closing straight in still costs the target nothing, which was
the rule this game wanted: only motion *across* the sight line creates lead
error.

Three tests pin the separation: a TC must help against a crosser, must do
*nothing* against a stationary target, and must not change aim staleness.

### What accuracy actually is now

`npm run sim:hitrate`, 34k shots over the template round robin:

```
  weapon      <0.5   0.5-2     2-4      4+      all
  every      87.3%   76.5%   51.4%   34.2%    77.0%
  W-MG       84.9%   72.9%   45.9%   30.8%    74.8%
  W-CB       99.5%   91.2%   59.9%   30.0%    87.0%
  W-AC       88.9%   73.8%   50.2%   40.7%    73.5%
  W-LAS      98.0%   93.0%   74.3%   73.7%    89.9%
  W-BR       99.8%   99.0%   83.0%   60.5%    95.8%
  W-RG      100.0%   95.0%   61.0%   50.0%    82.4%
```

The instrument exists because "every bullet hits" was answered three times with a
single pooled percentage, and a pooled number cannot tell an accurate gun from a
game with no misses in it. The columns are the design: a standing target is still
nearly always hit (correct — that is what standing still means), the laser is the
gun that hits, the machine gun is the gun that sprays, and crossing in front of
someone is worth 53 points.

Getting here took four reverted attempts, recorded so they are not retried:

- **Ballistic speeds ÷4.** Handed the game to hitscan — the laser boat went to
  77%, over the R4 flag, because everyone else got worse against movers and it
  did not. ÷2 instead.
- **Laser damage 20 → 16 to pay for that.** Overcorrected to 44%, and the fast
  mover popped to 73% because the laser boat was the main thing holding it down.
  These two are coupled; 19 is the settle point.
- **Tracking lag 0.65 s.** Made evasion worth 64 points, and handed the Vulture
  skirmisher 73% — speed became the best stat outright. 0.5 s with the move-jitter
  raise instead.
- **Move jitter alone.** Fixed the skirmisher and immediately gave the laser boat
  73%. The pair only lands with both dials moved together.

### The ladder ramp question, settled

`ladderBudgetPerNode` stays at **1.0**. 1.8 was never tried at 1.8; 1.5 was, and
it is worse on the axis that matters: distinct archetypes fell 10 → 6, the
dominant archetype's share rose 25% → 45%, and two more parts went unused —
while the win rate barely moved (0.875 → 0.875 fresh, 0.867 → 0.808 one-hour). A
harder ladder shortens runs (mean 6.67 → 4.0 battles), and a build that does not
survive cannot develop. Diversity was the stated priority, so 1.0 wins.

### A gate that was measuring noise

`cold-bore` was reported as a dead perk. It was not: at the stress's 5 seeds a
matchup delta can only land on multiples of 0.2, and cold-bore changed the
outcome of 23 of 35 fights while the wins happened to cancel to *exactly* zero.
The control/perk comparison is a paired difference between two noisy win rates
and needs more samples than the round robin's levels do, so it now runs at 3×
seeds — at which cold-bore measures +6 points with a +27 best matchup.

The criterion was not relaxed. It was right to demand a positive matchup; it just
could not see one.

(The perk did also need work: raising `MOVE_JITTER_MRAD_PER_MPS` had made its
dispersion halving worthless, because jitter is *added* to dispersion rather than
scaled by it. It now halves move jitter too.)

### Still open

- **Win rate is above its 0.8 ceiling** (0.875 fresh, 0.867 one-hour). The ramp
  is the obvious lever and it costs diversity, as measured above. Whatever fixes
  this needs to come from somewhere else — opponent *composition* rather than
  opponent budget is the untried direction.
- **Part usage is concentrated** (Herfindahl 0.129) and `U-TUR` is still never
  fielded. `U-AMMO` remains a placeholder pending its system.

## Pre-merge review: the composition substrate

A deep review before merging to `main` found that the branch's real ceiling was
not balance, it was **content**. The lateral-target penalty was a hardcoded
binary keyed on a part id:

```ts
shooter.hasPoweredTargetingComputer(snapshot) ? 0.4 : 1
```

So "reduce *this gun's* lateral penalty by half" — an ordinary thing to want to
write — was not expressible at all. No per-gun scope, no knob for a modifier to
bend, and two targeting computers counted as one. Its twin penalty, the shooter's
own movement (`moveJitter`), was a fully composable knob. Two halves of one
design, two implementations, and the blocked half was the one content needed.

**The rule, fixed once** (docs/04 §4b): modifiers combine in two buckets —
`inc()` sums into an additive pool applied once, `scale()` compounds — and the
final value is `(1 + additivePool) × multiplicativePool`. Both pools commute, so
order never matters. Physical quantities (kW, seconds, milliradians) *add*,
because summing is what those units mean; only percentage modifiers bucket.

All 21 existing modifiers were multiplicative already, so the migration was
provably inert: the golden determinism hash did not move.

The lateral penalty now has two scopes that multiply — `PartDef.
fireControlLateralMult` (mech-wide, catalog-declared, like `speedMult`) and
`EffectiveMults.lateralPenalty` (per-weapon, modifier-driven).

**Measured effect** (3 seeds, against the baseline in the same session):

| | before | after |
|---|---|---|
| fresh win rate | 0.875 | 0.875 |
| distinct archetypes | 14 | 14 |
| dominant archetype share | 0.283 | 0.283 |
| chassis never reached | none | none |
| part-usage Herfindahl | 0.118 | 0.117 |
| evasion worth (hitrate) | 53.1 pts | 53.1 pts |

Effectively neutral, which is the point: the axis opened without moving the loop.
No shipped template carries two computers, so single-TC math is unchanged. What
did change is *generated* opponents — the `lancer` doctrine's fill pool contains
`U-TC1`, and about 5% of lancer cards draw two, which now compound to 0.16. That
is the doctrine's own identity intensifying rather than a difficulty regression,
and `game:match-balance`'s digest moved accordingly (`00104780` → `84f1f221`)
while `sim:balance`, which uses fixed templates only, did not move at all.

A 100% reduction is treated as a content bug rather than a balance dial: the
additive pool is clamped at zero, and `game:audit` probes every modifier a part
can legally carry and reports `saturatedAdditivePools` if any field could reach
it. The check was verified against planted bad content, not merely written.

## Retiring the pre-spatial power model

There were two power models. `resolveSpatialPower` (regions, ports, wire
capacity) is the one the sim runs; `computeConnectivity` / `computePowerNetworks`
/ `computeCoreNetwork` in `grid.ts` walked raw grid adjacency and knew nothing
about any of that. Callers picked between them with
`usesSpatialSystems(build) ? … : …`, written out at **eight** call sites.

Every shipped chassis defines regions, so the legacy branch had been unreachable
in production for some time. That was not harmless, because **two of the eight
sites never branched at all** and simply called the legacy model:

- `adaptation.ts` asked it whether a part it had just placed was powered, so
  `sim:adapt` could report an adaptation the battle then left unpowered.
- `PowerPriorityList` — the workshop's brownout lamp — asked it which parts were
  live, so the green LED could disagree with the fight the player was about to
  have. That one shipped to the screen.

A second model that nothing runs is not free: it is a wrong answer waiting for
whoever forgets the ternary.

**Deleted Aug 2026**, at the user's call, along with the legacy-save
compatibility it existed to serve. All 166 parts across every shipped template
already carry a `regionId`, and the editor stamps one on every placement, so
nothing in current data needed a migration — only genuinely old saved runs break,
which is an accepted cost in a prototype.

Removed: the three `grid.ts` functions and their `buildBackbone` /
`findAdjacentNetwork` / `PowerNetwork` supporting cast, the ~95-line legacy body
of `autoWire`, `usesSpatialSystems` itself, `connectivity.test.ts`, and the
fallback arms in `templates.test.ts` and `autowire.test.ts`. Net **−249 lines**
across `grid.ts`, `autowire.ts` and `spatialPower.ts`; the web bundle dropped
378.0 → 373.4 kB.

`connectedInstanceIds(chassis, build)` is the front door for callers that only
need the connected set; `resolveSpatialPower` is for those needing networks,
bottlenecks or energized cells.

**The proof is the golden hash.** A deletion of an unreachable branch must not
change a single battle, and `determinism.test.ts` passed untouched throughout.

## Reproducing all of this

```bash
npm run verify                     # tests, builds, balance, diversity
npm run sim:hitrate                # hit rate by weapon and target crossing speed
npm run web:campaign               # one node of a real run, end to end
npm run web:audit                  # seven mobile screens

cd packages/game
npm run loop -- --seeds 3 --battles 8 --json artifacts/loop.json
node scripts/loop-report.mjs artifacts/loop.json
node --import tsx scripts/ladder-calibration.mjs --seeds 24 --template mule-needle
```

The cohort takes 15-25 minutes. `--json` resolves relative to `packages/game`.
`loop-report` prints run depth, unlock and challenge reachability, build
diversity, chassis identity and matchups, and lists everything it can prove
wrong under `warnings`.

## Remaining warnings

- ~~Fresh still never beats a Bastion, so CH-9 stays unreached.~~ **Fixed Aug
  2026** by drawing a chassis target per opponent card rather than letting the
  budget arithmetic decide. Fresh now meets Bastions 9 times per cohort and beats
  them; all three chassis unlock. See "Opponent doctrines".
- **Both profiles sit at or above the 0.8 win-rate ceiling**, and the per-node
  curve is flat rather than declining — the ladder stops posing new questions
  after about node 3. This is deliberate and measured (see the eleventh pass):
  the ramp settings that fix it cost build diversity. **Settled Aug 2026 in
  favour of the sandbox**: `ladderBudgetPerNode` stays at 1.0, because 1.5 cost
  40% of the distinct archetypes and bought almost no win rate.

  Opponent *composition* was then tried, and it works: doctrines took one-hour
  from 0.867 to **0.783**, under the ceiling, at no extra budget. Fresh is still
  0.875, and the reason is now understood rather than guessed — a node offers
  three doctrines out of four, so it always offers a soft one, and every policy
  takes it. Making that choice cost something was then tried three ways and
  reverted three times; see "Three attempts at the last warning". Every one of
  them traded a success criterion for the warning.
- **Part usage is concentrated** (Herfindahl 0.115) and `U-TUR` is never
  fielded, so the pool is wider than the builds drawn from it.
- **Heat discriminates now but is still not a decision the builds make.** The
  115 C band is reachable for genuinely hot builds after the thermal-mass
  rescale, but the cohort's own builds redline rarely enough that `redline`
  went unearned across 48 cases, so `R-C90` and `W-SC` remain effectively
  unreachable. Weapon heat output is the untouched dial.
- **Armour remains the largest share of parts fielded**, against 42.4% baked
  into the starting templates before any decision is made. Halving its weight
  in both scoring functions bought three archetypes and three CH-5 build
  directions but did not move the share much, because the templates themselves
  lead with plating. Reducing it further means re-authoring the probe fits,
  which changes what each chassis *is* and should be a deliberate design pass.
- `U-AMMO` is flagged dead by `sim:diversity` in its own right, pending the
  ammo system it is a placeholder for.
- **Accuracy is not a live build axis.** 91.8% of shots hit, so targeting
  computers, cold-bore variants, cover and crossing angles buy very little.
  `WEAPON_DISPERSION_SCALE` is the dial and is calibrated above; moving it needs
  a catalogue-wide dispersion re-price, not a one-line change.
- `railgun-mule` is the weakest template at 27%, and still carries the -28.2 kW
  margin below.
- The Vulture's 13-tier carrying cap against the other frames' 30 is unpaid for.
- `railgun-mule` sits at -28.2 kW power margin. It is the docs/02 §4 cap-fed
  worked example, so this may be intended, but it is untested as such.

## Iteration loop

1. Change content, economy, unlock criteria, chassis, parts, opponents, or sim
   rules as needed for the target experience.
2. Run focused fresh and one-hour cohorts and inspect battle traces, not only
   aggregate win rates.
3. Compare fingerprints to ensure a starting mech can branch and that different
   chassis do not converge on the same primary weapon, range, power, heat,
   protection, and location-effect profile.
4. Re-run `npm run verify`, the campaign smoke, production/mobile audits, and
   visual workshop inspection before accepting a player-facing pass.
