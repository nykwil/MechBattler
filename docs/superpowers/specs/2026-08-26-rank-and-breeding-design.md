# Rank, and a tool that breeds mechs to test it

**Design, 26 Aug 2026.** Written before a long content-generation pass, because
the pass needs something to author *against*.

## Why

The game is about to gain a lot of gear. Today there is no way to answer "is
this new gun any good, and does it make anything interesting possible" except by
hand-authoring a build in `templates.ts` and running a four-minute cohort. The
workbench (`sim:try`, 25 Aug) made a single trial cheap. This makes the *question*
cheap: given the gear that exists, what is the best mech you can build at a given
power level on a given chassis, what else is competitive, and what gear does
nobody want?

Three claims should hold once the content is good. They are the deliverable —
not a gallery, not a vibe, three falsifiable statements:

1. **A higher-rank mech should almost always beat a lower-rank one.**
2. **At the same rank, every chassis should be about as good.**
3. **No gear should be dead** — everything should appear in some build worth
   fielding.

All three are currently **unknown or known-false**. `docs/17` F2 measures the
budget-to-win-rate correlation at **−0.637**: today spending more buys a *worse*
mech, with `railgun-mule` at tier 19 winning 49% while `vulture-skirmisher` at
tier 8 wins 71%. So claim 1 is a target being adopted, not a regression being
guarded.

## What this is not

- Not a balance pass. It measures; `sim:balance` and `balance:report` still
  decide whether anything moved.
- Not opponent generation. Shipping bred archives as the ladder's opponent pool
  is a later phase, sketched in §8.
- Not content. It authors no gear. It tells you which gear to author.

---

## 1. Rank

**Rank is a single number, and it is the sum of the tiers of everything a mech
carries.**

```
rank(build) = Σ tier(part)  +  Σ tier(modifier)
              excluding conduits and heat pipes, which are free routing
```

Half of this already exists. `computeBudget` (harness.ts) and `buildTierBudget`
(ladder.ts) both sum part tiers today, and the ladder generates opponents from
that sum. **What is missing is mods: they contribute zero.** A build carrying
Fever cycle, Cold bore and Gyrostabilized has the same budget as the same build
with none — and an elite currently receives `eliteBudgetBonus` *plus* a free mod
that costs nothing at all. Pricing mods into rank closes that.

### 1a. Tier is the one authored number on a mod

`ModifierDef.rarity` and `ModifierDef.scrapCost` (added 25 Aug) are **replaced by
`ModifierDef.tier`**. Everything else derives:

| Derived | Formula | Why |
|---|---|---|
| Draw weight, at both roll sites | `2 ^ (1 − tier)` | Higher tier is scarcer. Reproduces roughly the 4:2:1 spread the named rarities had. |
| Machinist price | `tier × machinistTierCost` (15) | 15 / 30 / 45, which is within a few scrap of every price authored by hand. |
| Rank contribution | `tier` | §1. |

This makes a mod the same kind of object as a part, where `tier` already drives
budget, salvage value, repair cost and shop price. The migration is mechanical:
`common → 1`, `uncommon → 2`, `rare → 3` reproduces the current values almost
exactly.

**Known cost of this simplification:** tier now does three jobs, so making a mod
scarcer necessarily makes it cost more rank and more scrap. "Rare but weak" and
"common but strong" stop being expressible. Parts already live with this exact
coupling; it is accepted knowingly.

### 1b. Rank is a hypothesis, and the tool tests it

An armour plate is tier 1, the same as a machine gun, so a Mule with nine plates
carries nine rank points of armour. "High rank" can therefore mean "heavily
plated and weak", which is a plausible mechanism for F2's inverted correlation.

The sweep reports **the ceiling at each rank**. If it rises smoothly, Σ-tiers is
a sound rank function. If it plateaus or dips, rank is counting the wrong things
and wants weighting — and that finding is worth more than any single content fix.
Do not weight it pre-emptively; measure first.

### 1c. Where rank comes from, for each side

- **Enemy rank** is the ladder curve: `ladderBudgetBase + ladderBudgetPerNode × node`.
- **Player rank** is starting gear, plus loot, plus whatever the purse can buy —
  because the machinist converts scrap into mods, and mods now cost rank.
  `purseBase` and `pursePerNode` are therefore power-curve dials, not merely
  economy ones.
- **The design target is that correct building covers the gap between them.**
  §2d makes that a number.

---

## 2. The invariants

**One definition first.** The **ceiling** at `(rank, chassis)` is the highest win
rate the search found against the frozen reference panel, using only gear the
lock allows, at or below that rank. Every invariant below is stated in terms of
it.

Each is stated with a threshold so it can pass or fail. **Thresholds are
provisional and the first sweep sets them**; they are written down so the first
sweep has something to disagree with.

### 2a. I1 — Rank monotonicity

> The best build at rank `R+2` beats the best build at rank `R` at least **75%**
> of the time. At `R+1`, at least **60%**.

Best-versus-best, not every pairing: an individual high-rank sniper losing to a
low-rank brawler that starts inside its minimum range is the range game working
correctly. Measured across the full seed set and every spawn distance in
`LADDER_SPAWN_DISTANCES_M`, both spawn sides.

Checked within a chassis, and across chassis for the same rank pair.

### 2b. I2 — Chassis parity

> At the same rank, the ceilings of any two chassis differ by no more than
> **8 percentage points** — but only below each chassis's saturation rank.

**Saturation rank** is a first-class output: the rank at which a chassis stops
being able to spend more, defined as the lowest rank where the ceiling fails to
improve for two consecutive ranks, or where no legal build exists at all. The
Vulture has 16 cells against the Bastion's 56, and `docs/16` already suspects
"the Vulture's 13-tier carrying cap against the other frames' 30 is unpaid for".
Asserting parity above saturation would be asserting something impossible; the
number itself may be the most useful thing the first sweep produces.

### 2c. I3 — No dead gear

> Every enabled part and every mod appears in at least one archive elite,
> somewhere in the sweep.

Anything appearing nowhere is dead content and is named. `U-AMMO` is excluded by
declaration — it is a deliberate placeholder (`docs/19`).

### 2d. The measurement: what is correct building worth?

Not an invariant, the headline number.

> Take the best build at rank `R`. Fight it against the best builds at
> `R+1, R+2, R+3…`. Report the smallest `k` at which its win rate falls to
> **0.5 or below**.

That `k` is how many ranks of enemy a well-built mech is worth, and it is exactly
what `ladderBudgetPerNode` should be set from — a dial `docs/16` has argued over
four times with no way to settle it.

**Caveat that must appear in the report:** both sides are flown by the same
autopilot, so this measures correct *building*, not correct *piloting*. A human
who kites better than the autopilot is worth more than `k`; a human who does not
is worth less.

---

## 3. The search

### 3a. Genome and development

The genome is a **wish** — the input `assembleBuild` already takes:

```
{ chassisId, parts: [{ partId, count, modifiers }], budget }
```

`assembleBuild` is the developmental step: it places parts by the workshop's own
rules, wires the build, and reports what would not fit. **Illegal genomes cannot
exist**, so no evaluation is ever wasted on something the game would reject.

Two changes to the workbench are required:

- **Armour becomes a gene.** `fillArmour` must be off: weight is an archive axis
  and the automatic fill would flatten it to one value. Plate count is evolved.
- **Completion must be restricted to the locked pool.** Today it reaches into
  the whole catalog for a reactor or a radiator, which would silently give every
  search the same reactor and make the lock meaningless.

### 3b. The tier ladder is the search structure

Fitness costs ~205 ms a battle; everything else is under 25 ms. Cost is therefore
*number of evaluations*, and the largest saving available is not a cleverer
algorithm but a warm start:

- **Rank `R` seeds from rank `R−1`'s archive.** A rank-6 build is usually a
  rank-5 build plus a part. This also mirrors the invariant being tested: the
  ladder is constructed, then checked.
- **Exhaustive at the bottom.** At low ranks the space is small enough to
  enumerate completely, which yields a *guaranteed* ceiling rather than a lucky
  one — and that is precisely where I1 is anchored.
- **Mutation and hill-climbing above it**, once enumeration is too wide.
  Mutation adds, drops or swaps a part; nudges a count; adds, moves or removes a
  mod within the one-mod-per-part and copy-limit rules. Crossover splices two
  part lists.

Whether the result is called a genetic algorithm is a naming question. The
structure that matters is the ladder.

### 3c. The archive

For coverage and variety (not for the ceiling, which is a max):

- **Grid per chassis:** engagement range (close / mid / long) × weight class
  (light / medium / heavy), each cell holding **two** elites — the best cold
  build and the best redliner. Eighteen slots per chassis, readable as a 3×3.
- **Descriptors are free** (3 ms, no battles), and their buckets are:

  | Descriptor | Source | Buckets |
  |---|---|---|
  | Range | midpoint of `computeIdealRangeBand`'s `bandStart..bandEnd` | close < 45 m, mid 45–100 m, long > 100 m |
  | Weight | `computeSpeedProfile().massT ÷ chassis.ratedMassT` | light ≤ 0.5, medium ≤ 0.8, heavy > 0.8 |
  | Heat | `computeHeatBalance().marginKw` | redliner < 0 (generates more than it can shed), cold ≥ 0 |
  | Kill method | weapon fields | `enemyHeatKj` → heat, `capDrainKj` → power, else damage |

  Range buckets follow the catalog's own bands: the Maul is full damage to 15 m
  and dead at 45; the Longshot's sweet spot starts at 50. Weight and heat splits
  are provisional in the same way the invariant thresholds are.
- **Kill-method and exact heat are labels, not dimensions.** They are shown on a
  gallery entry and in the compare view; the search does not have to fill a cell
  for each.

A cell filling with one build means that lock supports one mech; six cells at
comparable fitness means it supports six. **The archive is the anti-convergence
measurement** — no separate metric is needed.

### 3d. Fitness, rationed

- **Screen:** win rate against a small frozen panel (3 opponents), 1 seed — about
  0.6 s. Most candidates never cost more than this.
- **Confirm:** anything that claims an archive cell is re-fought against the full
  panel at high seeds for the report.

**The panel must be frozen, and this is the one thing that cannot be made fully
honest.** Fitness is measured against opponents built from the catalog being
edited, so when a gun changes the yardstick changes with it. Mitigation: the
panel is a fixed set of build definitions, and **every report records
`simContentHash()`**. Results are comparable while the catalog holds still, and
when it moves the report says so. Cross-content-version comparisons are
indicative, not measurements.

### 3e. Determinism and parallelism

The search runs on a seeded `Pcg32`. Each candidate's battle seeds derive from
the candidate itself, never from the order it was evaluated, so a sweep
reproduces exactly *and* parallelises across worker threads — the sim is pure and
holds no global state (`docs/11` §3).

---

## 4. Locks

A **lock** is a randomly drawn subset of gear, standing in for the fact that a
run hands you a fraction of the catalog rather than all of it.

- **Uniform random** from the midgame pool: **8 part types plus 3 mods**, seeded.
  Three mods because that is what a run actually grants — one machinist service
  after each of wins 3, 6 and 9 — so a lock stays inside the envelope a player
  could reach. Eight parts is a starting figure for the first sweep to argue with.
  Uniform rather than loot-weighted on purpose — this measures whether any *gear*
  is bad, not whether the loot tables are bad. (Loot-realistic draws are a later
  variant; see §8.)
- **Every chassis runs the same lock**, separately. That is what makes I2 a
  controlled comparison rather than an observation.
- A lock that produces no legal build on some chassis is a finding, recorded, not
  an error.

The **midgame pool** is declared, not harvested: there is no meta-endgame yet, so
`MIDGAME_POOL` is a design statement of what midgame is meant to contain. It sits
beside `ONE_HOUR_PART_IDS`, which is the same kind of fixture.

---

## 5. What comes out

One sweep, five outputs.

1. **Invariant report.** I1, I2, I3 with their numbers, pass or fail, per chassis
   and per rank pair. This is the file that gets read after every content change.
2. **Saturation ranks.** Per chassis, with the rank at which the ceiling stops
   climbing.
3. **The ceiling curve.** Best win rate achievable at each rank, per chassis —
   the graph that says whether rank means anything (§1b).
4. **Gallery.** Archive cells with their elites: the build, its four descriptors,
   its rank, what it beat. Empty cells are shown as empty, because "no hot heavy
   brawler exists" is the finding.
5. **Coverage.** Every part and mod, and how many archive elites wanted it.
   Zero is dead gear.

Plus a separate command, **compare**: two builds side by side on all four
descriptors, their part and mod overlap, and a single distance number. For
answering "is this new gun actually different from that one".

---

## 6. Shape of the code

| Where | What |
|---|---|
| `packages/sim/src/rank.ts` | `computeRank`, mod-tier derivation, the migration of `computeBudget`/`buildTierBudget` call sites |
| `packages/sim/src/archive.ts` | Descriptors, bucketing, the cell grid, insertion |
| `packages/sim/src/breeding.ts` | Locks, genome operators, the tier-laddered search |
| `packages/sim/src/panel.ts` | The frozen reference panel and its hash stamp |
| `packages/sim/scripts/breed.ts` | `npm run sim:breed` — the sweep and its reports |
| `packages/sim/scripts/compare.ts` | `npm run sim:compare` |
| `packages/sim/src/workbench.ts` | Lock-restricted completion; armour as a gene |

Changing `computeBudget` to include mod tiers **changes generated opponents**,
because the ladder generates by budget. Existing saved runs are unaffected —
opponents are generated once and stored verbatim (`docs/13`) — but the ladder's
difficulty curve will shift, and `game:balance` must be re-run against the
per-depth target bands afterwards to see where it landed.

---

## 7. Risks

- **A search finds *a* ceiling, not *the* ceiling.** Every invariant result is a
  lower bound: failing to find a strong rank-3 build is not proof that none
  exists. Reports must say "best found", and I1 failing is stronger evidence than
  I1 passing.
- **Panel circularity** (§3d). Named, mitigated by the content hash, not solved.
- **Σ-tiers may be the wrong rank function** (§1b). The tool is built to expose
  that rather than to assume it.
- **The autopilot is the pilot** (§2d). This measures building, not playing.
- **Cost.** A 20-lock sweep across three chassis is minutes-to-an-hour depending
  on rationing and worker count. It is a "kick it off and come back" tool, and
  the implementation plan should size it before building the whole thing.

## 8. Later phases, deliberately not now

- **Bred opponents.** Ship per-rank archives as the ladder's opponent pool,
  sampling a cell by *target difficulty* rather than by maximum strength — an
  optimiser pointed at win rate produces twelve min-maxed monsters in a row. The
  archive already stores each elite's measured strength, so this is a sampling
  rule, not another search. A cell is also a ready-made intel description ("hot
  heavy brawler") which beats today's random epithet.
- **Loot-realistic locks**, drawn from what opponents at nodes 6–12 actually
  carry, to measure the game as it is rather than the gear in the abstract.
- **Rank re-weighting**, if §1b says Σ-tiers is wrong.
